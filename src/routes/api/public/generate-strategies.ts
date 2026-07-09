import { createFileRoute } from "@tanstack/react-router";
import { sma, ema, rsi, evalGroup, fetchBars, type IndicatorContext } from "@/lib/indicators";

/**
 * AI Strategy Lab. Called hourly by pg_cron.
 * Generates one novel strategy via Lovable AI, saves it as source='ai_lab',
 * then immediately backtests it and auto-disables poor performers.
 */

type StrategyJSON = {
  indicators: Array<{ name: string; params?: Record<string, number> }>;
  entry: { conditions: string[]; logic: "AND" | "OR" };
  exit: { conditions: string[]; logic: "AND" | "OR" };
  timeframes: string[];
  universe?: string[];
  notes?: string;
};

const SEED_PROMPTS = [
  "Generate a momentum strategy using RSI and SMA crossover on large-cap tech stocks",
  "Generate a mean-reversion strategy for oversold crypto using RSI and EMA",
  "Generate a breakout strategy using price above SMA(200) for ETFs",
  "Generate a volatility strategy using EMA crossover for mid-cap stocks",
  "Generate a trend-following strategy using EMA(12) and EMA(26) for S&P 500 stocks",
  "Generate a contrarian strategy for oversold blue-chip stocks using RSI < 25",
  "Generate a crypto momentum strategy using BTC, ETH, and SOL",
];

const SYSTEM_PROMPT = `You are a senior quantitative strategist. Generate a novel, diverse trading strategy. Vary across: momentum, mean-reversion, breakout, RSI-based, moving-average crossover, and volatility strategies. Pick a random liquid universe of 2-5 stocks or crypto. Return STRICT JSON only — no prose, no fences.

JSON shape:
{
  "name": "short title (max 60 chars)",
  "description": "1-2 sentence summary",
  "market_type": "stocks" | "crypto" | "both",
  "risk_level": "low" | "medium" | "high",
  "style": "momentum" | "mean_reversion" | "breakout" | "volatility",
  "strategy_json": {
    "indicators": [ { "name": "RSI"|"MACD"|"VWAP"|"SMA"|"EMA"|"BBANDS"|"ATR", "params": { ... } } ],
    "entry": { "conditions": ["RSI < 30", "price > SMA(50)"], "logic": "AND" },
    "exit":  { "conditions": ["RSI > 70", "price < entry * 0.97"], "logic": "OR" },
    "timeframes": ["1h", "1d"],
    "universe": ["AAPL","MSFT"],
    "style": "momentum",
    "notes": "optional"
  }
}`;

type Bar = { t: number; c: number };


function backtest(bars: Bar[], sj: StrategyJSON): { roi: number; win_rate: number; drawdown: number; sharpe: number; trade_count: number; equity_curve: Array<{ t: string; equity: number }> } {
  const closes = bars.map((b) => b.c);
  const rsiArr = rsi(closes, 14);
  const sma20Arr = sma(closes, 20);
  const sma50Arr = sma(closes, 50);
  const sma200Arr = sma(closes, 200);
  const ema12Arr = ema(closes, 12);
  const ema26Arr = ema(closes, 26);

  let cash = 10000;
  let position = 0;
  let entry_price: number | null = null;
  const equity_curve: Array<{ t: string; equity: number }> = [];
  const returns: number[] = [];
  let peak = cash;
  let maxDrawdown = 0;
  let wins = 0;
  let totalClosed = 0;

  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const ctx: IndicatorContext = {
      price: b.c,
      prev_price: bars[i - 1].c,
      rsi: rsiArr[i],
      sma20: sma20Arr[i],
      sma50: sma50Arr[i],
      sma200: sma200Arr[i],
      ema12: ema12Arr[i],
      ema26: ema26Arr[i],
      entry_price,
    };
    const tIso = new Date(b.t).toISOString().slice(0, 10);
    if (position === 0) {
      if (evalGroup(sj.entry.conditions, sj.entry.logic, ctx)) {
        position = cash / b.c;
        entry_price = b.c;
        cash = 0;
      }
    } else if (evalGroup(sj.exit.conditions, sj.exit.logic, ctx)) {
      const proceeds = position * b.c;
      const pnl = proceeds - entry_price! * position;
      cash = proceeds;
      if (pnl > 0) wins++;
      totalClosed++;
      position = 0;
      entry_price = null;
    }
    const newEquity = cash + position * b.c;
    const prevEquity = equity_curve.length ? equity_curve[equity_curve.length - 1].equity : 10000;
    returns.push((newEquity - prevEquity) / prevEquity);
    peak = Math.max(peak, newEquity);
    const dd = (peak - newEquity) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
    equity_curve.push({ t: tIso, equity: newEquity });
  }
  if (position > 0) {
    const last = bars[bars.length - 1].c;
    const pnl = position * last - entry_price! * position;
    if (pnl > 0) wins++;
    totalClosed++;
    cash = position * last;
  }
  const roi = (cash - 10000) / 10000;
  const win_rate = totalClosed > 0 ? wins / totalClosed : 0;
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(returns.length, 1);
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(returns.length, 1);
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  return {
    roi: Number((roi * 100).toFixed(2)),
    win_rate: Number((win_rate * 100).toFixed(2)),
    drawdown: Number((maxDrawdown * 100).toFixed(2)),
    sharpe: Number(sharpe.toFixed(3)),
    trade_count: totalClosed,
    equity_curve,
  };
}

export const Route = createFileRoute("/api/public/generate-strategies")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        if (!anon || apikey !== anon) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return Response.json({ ok: false, error: "missing_lovable_api_key" }, { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Cap active AI Lab strategies at 10.
        const { count: activeCount } = await supabaseAdmin
          .from("strategies")
          .select("id", { count: "exact", head: true })
          .eq("source", "ai_lab").eq("active", true);
        if ((activeCount ?? 0) >= 10) {
          return Response.json({ ok: true, generated: 0, reason: "lab_full" });
        }

        // Pick an owner: elite > pro > any user.
        let ownerId: string | null = null;
        for (const t of ["elite", "pro"] as const) {
          const { data } = await supabaseAdmin
            .from("user_tiers").select("user_id").eq("tier", t).limit(1).maybeSingle();
          if (data?.user_id) { ownerId = data.user_id; break; }
        }
        if (!ownerId) {
          const { data } = await supabaseAdmin
            .from("user_tiers").select("user_id").order("created_at", { ascending: true }).limit(1).maybeSingle();
          ownerId = data?.user_id ?? null;
        }
        if (!ownerId) return Response.json({ ok: false, error: "no_user_to_assign" }, { status: 500 });

        // Optional context: retired strategy name to steer diversity
        let retiredName = "";
        try {
          const body = await request.clone().json() as { retired_name?: string };
          retiredName = String(body?.retired_name ?? "").slice(0, 80);
        } catch { /* body optional */ }

        // Generate via Lovable AI gateway.
        const seed = SEED_PROMPTS[Math.floor(Math.random() * SEED_PROMPTS.length)];
        const userMsg = retiredName
          ? `${seed}\n\nContext: The strategy named "${retiredName}" was retired for poor performance. Generate something with a different approach and different universe.`
          : seed;
        let text = "";
        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Lovable-API-Key": apiKey,
              "X-Lovable-AIG-SDK": "direct",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userMsg },
              ],
              response_format: { type: "json_object" },
            }),
          });
          if (!res.ok) {
            return Response.json({ ok: false, error: `gateway_${res.status}` }, { status: 500 });
          }
          const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
          text = j.choices?.[0]?.message?.content ?? "";
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : "gateway_failed" }, { status: 500 });
        }

        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(text); } catch {
          return Response.json({ ok: false, error: "parse_failed" }, { status: 500 });
        }

        const sjRaw = parsed.strategy_json as StrategyJSON | undefined;
        if (!sjRaw || !sjRaw.entry || !sjRaw.exit || !Array.isArray(sjRaw.indicators)) {
          return Response.json({ ok: false, error: "invalid_shape" }, { status: 500 });
        }
        const mt = String(parsed.market_type ?? "stocks");
        const rl = String(parsed.risk_level ?? "medium");
        const strategy_json: StrategyJSON = {
          indicators: sjRaw.indicators.slice(0, 8),
          entry: {
            conditions: (sjRaw.entry.conditions ?? []).slice(0, 8).map(String),
            logic: sjRaw.entry.logic === "OR" ? "OR" : "AND",
          },
          exit: {
            conditions: (sjRaw.exit.conditions ?? []).slice(0, 8).map(String),
            logic: sjRaw.exit.logic === "OR" ? "OR" : "AND",
          },
          timeframes: (sjRaw.timeframes ?? ["1d"]).slice(0, 4).map(String),
          universe: (sjRaw.universe ?? []).slice(0, 10).map((u) => String(u).toUpperCase()),
          notes: sjRaw.notes ? String(sjRaw.notes).slice(0, 400) : undefined,
        };
        const validStyles = ["momentum", "mean_reversion", "breakout", "volatility"];
        const styleTop = typeof parsed.style === "string" && validStyles.includes(parsed.style) ? parsed.style : null;
        const styleInner = typeof (sjRaw as { style?: unknown }).style === "string" && validStyles.includes(String((sjRaw as { style?: unknown }).style)) ? String((sjRaw as { style?: unknown }).style) : null;
        const style = styleTop ?? styleInner;
        if (style) (strategy_json as StrategyJSON & { style?: string }).style = style;
        const name = String(parsed.name ?? "AI Lab Strategy").slice(0, 60);
        const description = String(parsed.description ?? "").slice(0, 400);
        const market_type = (["stocks", "crypto", "both"].includes(mt) ? mt : "stocks") as "stocks" | "crypto" | "both";
        const risk_level = (["low", "medium", "high"].includes(rl) ? rl : "medium") as "low" | "medium" | "high";

        // Insert strategy.
        const { data: inserted, error: insErr } = await supabaseAdmin
          .from("strategies")
          .insert({
            user_id: ownerId,
            name,
            description,
            market_type,
            risk_level,
            strategy_json,
            style,
            source: "ai_lab",
            execution_mode: "paper",
            active: true,
          })
          .select("id").single();
        if (insErr || !inserted) {
          return Response.json({ ok: false, error: insErr?.message ?? "insert_failed" }, { status: 500 });
        }


        // Backtest first symbol.
        const symbol = strategy_json.universe?.[0] ?? "AAPL";
        const raw = await fetchBars(symbol, 365);
        const bars: Bar[] | null = raw ? raw.times.map((t, i) => ({ t, c: raw.closes[i] })) : null;
        let roi = 0, win_rate = 0, active = true;
        if (bars && bars.length >= 50) {
          const bt = backtest(bars, strategy_json);
          roi = bt.roi;
          win_rate = bt.win_rate;
          const from = new Date(bars[0].t).toISOString().slice(0, 10);
          const to = new Date(bars[bars.length - 1].t).toISOString().slice(0, 10);
          await supabaseAdmin.from("strategy_performance").insert({
            user_id: ownerId,
            strategy_id: inserted.id,
            win_rate,
            roi,
            drawdown: bt.drawdown,
            sharpe: bt.sharpe,
            trade_count: bt.trade_count,
            equity_curve: bt.equity_curve.filter((_, i) => i % Math.max(1, Math.floor(bt.equity_curve.length / 200)) === 0),
            backtest_from: from,
            backtest_to: to,
          });
          if (roi < -15 || win_rate < 30) {
            active = false;
            await supabaseAdmin.from("strategies").update({ active: false }).eq("id", inserted.id);
          }
        }


        // Auto-generate strategy explanation (best effort)
        try {
          const exPrompt = "You are a quantitative trading educator. Given a trading strategy's rules, write a clear 4-paragraph explanation: (1) What market inefficiency or pattern this strategy exploits, (2) Why the chosen indicators work together for this purpose, (3) What market conditions will cause this strategy to fail, (4) What a trader should watch for to know if the strategy is working as intended. Be specific, honest about risks, and avoid hype. Max 200 words total.";
          const exRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "direct" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: exPrompt },
                { role: "user", content: JSON.stringify({ name, description, rules: strategy_json }) },
              ],
            }),
          });
          if (exRes.ok) {
            const ej = (await exRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
            const explanation = (ej.choices?.[0]?.message?.content ?? "").trim();
            if (explanation) await supabaseAdmin.from("strategies").update({ explanation }).eq("id", inserted.id);
          }
        } catch { /* best-effort */ }

        return Response.json({ ok: true, generated: 1, strategy_name: name, style, roi, win_rate, active });

      },
    },
  },
});
