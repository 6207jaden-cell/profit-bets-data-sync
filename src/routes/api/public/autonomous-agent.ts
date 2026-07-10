import { createFileRoute } from "@tanstack/react-router";
import { buildContext, detectMarketRegime, fetchBars, fetchQuotePrice, isCryptoSymbol, isMarketOpen } from "@/lib/indicators";

const UNIVERSE = {
  large_cap: ["AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","JPM","V","XOM","WMT","JNJ","HD","BAC","PG","DIS","NFLX","AMD","CRM","UBER"],
  small_mid_cap: ["PLTR","SOFI","RIVN","HOOD","COIN","RBLX","SNAP","LYFT","ABNB","ROKU","DKNG","OPEN","IONQ","SMCI","MSTR"],
  etfs: ["SPY","QQQ","IWM","GLD","TLT","XLF","XLK","XLE","ARKK","SOXL"],
  crypto: ["BTC-USD","ETH-USD","SOL-USD"],
};
const ALL_SYMBOLS = [
  ...UNIVERSE.large_cap, ...UNIVERSE.small_mid_cap, ...UNIVERSE.etfs, ...UNIVERSE.crypto,
];
const MAX_POSITION_PCT = 35;
const MIN_CASH_PCT = 20;

const SECTOR: Record<string, string> = {
  AAPL:"tech",MSFT:"tech",NVDA:"tech",GOOGL:"tech",AMZN:"tech",META:"tech",TSLA:"tech",
  AMD:"tech",CRM:"tech",NFLX:"tech",PLTR:"tech",SMCI:"tech",IONQ:"tech",MSTR:"tech",
  JPM:"finance",V:"finance",BAC:"finance",SOFI:"finance",HOOD:"finance",COIN:"finance",
  XOM:"energy",XLE:"energy",WMT:"consumer",JNJ:"health",HD:"consumer",PG:"consumer",
  DIS:"consumer",UBER:"consumer",LYFT:"consumer",ABNB:"consumer",RBLX:"consumer",
  SNAP:"consumer",ROKU:"consumer",DKNG:"consumer",OPEN:"consumer",RIVN:"consumer",
};

type AiTrade = {
  symbol: string;
  direction: "long" | "short";
  instrument: string;
  conviction: number;
  allocation_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  hold_duration: "intraday" | "swing" | "position";
  rationale: string;
  options_details?: unknown;
};
type AiResponse = {
  market_assessment: string;
  regime: string;
  cash_deployment_pct: number;
  trades: AiTrade[];
  message_to_user: string;
};

export const Route = createFileRoute("/api/public/autonomous-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body = (await request.json().catch(() => ({}))) as { session?: string };
        const session = body.session === "midday" ? "midday" : "morning";
        const sessionType = session === "midday" ? "midday_scan" : "morning_scan";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: activeUsers } = await supabaseAdmin
          .from("user_settings")
          .select("user_id, autonomous_execution_mode")
          .eq("autonomous_mode", true);
        if (!activeUsers || activeUsers.length === 0) {
          return Response.json({ ok: true, reason: "autonomous_mode_disabled" });
        }

        const marketOpen = isMarketOpen();
        // SPY regime once per run
        const spyBars = await fetchBars("SPY", 220);
        const regime = spyBars ? detectMarketRegime(spyBars.closes) : "sideways";
        let vixLevel: number | null = null;
        try {
          const finKey = process.env.FINNHUB_API_KEY;
          if (finKey) {
            const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${finKey}`);
            if (r.ok) { const j = (await r.json()) as { c?: number }; vixLevel = j.c ?? null; }
          }
        } catch { /* ignore */ }

        // Build candidate universe once (shared across users)
        const symbolsThisRun = marketOpen ? ALL_SYMBOLS : UNIVERSE.crypto;
        const candidateMap = new Map<string, {
          symbol: string; price: number; rsi: number | null;
          sma20: number | null; sma50: number | null; ema12: number | null; ema26: number | null;
          momentum_pct: number; atr_pct: number | null; regime_aligned: boolean;
        }>();
        const batchSize = 10;
        for (let i = 0; i < symbolsThisRun.length; i += batchSize) {
          const batch = symbolsThisRun.slice(i, i + batchSize);
          await Promise.all(batch.map(async (sym) => {
            const bars = await fetchBars(sym, 220);
            if (!bars || bars.closes.length < 60) return;
            const ctx = buildContext(bars.closes);
            if (!ctx) return;
            const sma50 = ctx.sma50 ?? ctx.price;
            const momentum = ((ctx.price - sma50) / sma50) * 100;
            // ATR% approximation using ranges
            const n = Math.min(14, bars.highs.length - 1);
            let sumTr = 0;
            for (let k = bars.highs.length - n; k < bars.highs.length; k++) {
              sumTr += Math.max(
                bars.highs[k] - bars.lows[k],
                Math.abs(bars.highs[k] - bars.closes[k - 1]),
                Math.abs(bars.lows[k] - bars.closes[k - 1]),
              );
            }
            const atrPct = n > 0 ? (sumTr / n) / ctx.price * 100 : null;
            const aligned = (regime === "bull" && momentum > 0) || (regime === "bear" && momentum < 0) || regime === "sideways";
            candidateMap.set(sym, {
              symbol: sym, price: ctx.price, rsi: ctx.rsi,
              sma20: ctx.sma20, sma50: ctx.sma50, ema12: ctx.ema12, ema26: ctx.ema26,
              momentum_pct: momentum, atr_pct: atrPct, regime_aligned: aligned,
            });
          }));
        }

        const allCandidates = Array.from(candidateMap.values());
        const sorted = session === "midday"
          ? allCandidates.filter((c) => c.rsi != null && c.rsi >= 40 && c.rsi <= 65)
              .sort((a, b) => Math.abs(b.momentum_pct) - Math.abs(a.momentum_pct)).slice(0, 10)
          : allCandidates.sort((a, b) => Math.abs(b.momentum_pct) - Math.abs(a.momentum_pct)).slice(0, 20);

        let totalOpened = 0;
        for (const u of activeUsers) {
          try {
            const opened = await runForUser({
              userId: u.user_id,
              executionMode: u.autonomous_execution_mode ?? "paper",
              session, sessionType, regime, vixLevel,
              candidates: sorted, supabaseAdmin,
            });
            totalOpened += opened;
          } catch (e) {
            console.error("[autonomous-agent] user", u.user_id, e);
          }
        }

        return Response.json({ ok: true, session, regime, users: activeUsers.length, trades_opened: totalOpened });
      },
    },
  },
});

async function runForUser(args: {
  userId: string;
  executionMode: string;
  session: "morning" | "midday";
  sessionType: string;
  regime: string;
  vixLevel: number | null;
  candidates: Array<Record<string, unknown>>;
  supabaseAdmin: Awaited<ReturnType<typeof getAdmin>>;
}): Promise<number> {
  const { userId, session, sessionType, regime, vixLevel, candidates, supabaseAdmin, executionMode } = args;
  const { data: portfolio } = await supabaseAdmin
    .from("paper_portfolios").select("*").eq("user_id", userId).maybeSingle();
  if (!portfolio) return 0;
  const totalEquity = Number(portfolio.equity) || Number(portfolio.balance) || 0;
  const cash = Number(portfolio.balance) || 0;
  const cashPct = totalEquity > 0 ? (cash / totalEquity) * 100 : 100;

  const { data: openTrades } = await supabaseAdmin
    .from("paper_trades").select("*").eq("user_id", userId).eq("is_open", true);
  const openList = openTrades ?? [];

  const { data: learnings } = await supabaseAdmin
    .from("agent_learnings").select("analysis, key_insights, adjustments")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(4);
  const learningsSummary = (learnings ?? []).map((l, i) =>
    `Week ${i + 1}: ${l.analysis?.slice(0, 300)} | Adj: ${JSON.stringify(l.adjustments).slice(0, 200)}`
  ).join("\n") || "No prior learnings yet.";

  if (cashPct < MIN_CASH_PCT) {
    await supabaseAdmin.from("agent_messages").insert({
      user_id: userId, role: "assistant", is_autonomous: true, session_type: sessionType,
      content: `Held off on new positions — cash is at ${cashPct.toFixed(0)}%, below the ${MIN_CASH_PCT}% minimum reserve.`,
    });
    await supabaseAdmin.from("agent_decisions").insert({
      user_id: userId, session_type: sessionType, regime, trades_opened: 0,
      payload: { skipped: "min_cash" },
    });
    return 0;
  }

  const userMessage = {
    session, regime, vix_level: vixLevel,
    portfolio: { cash, equity: totalEquity, cash_pct: cashPct, open_positions_count: openList.length },
    candidates, current_positions: openList.map((t) => ({
      id: t.id, asset: t.asset, side: t.side, entry_price: t.entry_price,
      hold_duration: t.hold_duration, instrument: t.instrument,
    })),
    learnings_summary: learningsSummary,
    margin_available: false,
  };

  const systemPrompt = `You are an autonomous portfolio manager with deep expertise in equities, ETFs, crypto, and options (calls, puts, vertical spreads, iron condors). You manage a ring-fenced trading account. Your only goal is to maximize risk-adjusted returns over time.

HARD RULES — never violate these:
- Always maintain at least ${MIN_CASH_PCT}% cash. Never deploy more than ${100 - MIN_CASH_PCT}% of the portfolio.
- Never allocate more than ${MAX_POSITION_PCT}% to a single position.
- For SHORT positions: only recommend if margin_available is true in the context. If not, use puts instead.
- Never trade assets with earnings within 48 hours.
- For options: choose the structure that best fits the situation. Low IV → buy options. High IV → sell spreads. Neutral outlook → iron condor. Always specify expiry (2-5 weeks out for swings, 1-3 days for intraday), strike, and number of contracts.
- Session "midday" is for intraday opportunities only — set hold_duration to "intraday" for all midday trades.
- If you see nothing compelling, return an empty trades array and hold cash. Doing nothing is always valid.

Respond with ONLY valid JSON matching this exact schema — no prose, no markdown fences:
{
  "market_assessment": "2-3 sentence market overview",
  "regime": "bull|bear|sideways",
  "cash_deployment_pct": <0-80 number>,
  "trades": [ { "symbol": "NVDA", "direction": "long|short", "instrument": "stock|etf|crypto|call|put|call_spread|put_spread|iron_condor", "conviction": <0-100>, "allocation_pct": <1-${MAX_POSITION_PCT}>, "stop_loss_pct": <number>, "take_profit_pct": <number>, "hold_duration": "intraday|swing|position", "rationale": "2-3 sentence explanation", "options_details": { "expiry_days_out": 21, "strike_type": "atm|otm_1|otm_2|itm_1", "contracts": 1, "spread_width": null } } ],
  "message_to_user": "Friendly 2-4 sentence summary."
}`;

  const ai = await callGateway(systemPrompt, JSON.stringify(userMessage));
  if (!ai) {
    await supabaseAdmin.from("agent_decisions").insert({
      user_id: userId, session_type: sessionType, regime, trades_opened: 0,
      payload: { ai_error: true },
    });
    return 0;
  }

  const sectorCount = new Map<string, number>();
  for (const t of openList) {
    const s = SECTOR[String(t.asset).toUpperCase()] ?? "other";
    sectorCount.set(s, (sectorCount.get(s) ?? 0) + 1);
  }

  let opened = 0;
  let cashRemaining = cash;
  for (const raw of ai.trades ?? []) {
    let t = raw;
    // Enforce short→put fallback (margin_available: false)
    if (t.direction === "short" && !userMessage.margin_available) {
      t = { ...t, instrument: "put", direction: "long", rationale: `${t.rationale} [converted from short to put — margin unavailable]` };
    }
    const allocPct = Math.min(t.allocation_pct, MAX_POSITION_PCT);
    const allocCash = (cash * allocPct) / 100;
    if (allocCash > cashRemaining * 0.99) continue;
    // Sector guard: max 40% of open slots in same sector
    const sect = SECTOR[t.symbol.toUpperCase()] ?? "other";
    if ((sectorCount.get(sect) ?? 0) >= Math.max(2, Math.floor(openList.length * 0.4))) continue;

    const price = await fetchQuotePrice(t.symbol);
    if (!price || price <= 0) continue;
    const qty = allocCash / price;

    const { error } = await supabaseAdmin.from("paper_trades").insert({
      user_id: userId,
      portfolio_id: portfolio.id,
      asset: t.symbol,
      side: t.direction === "long" ? "buy" : "sell",
      quantity: qty,
      entry_price: price,
      is_open: true,
      hold_duration: t.hold_duration,
      stop_loss_pct: t.stop_loss_pct,
      take_profit_pct: t.take_profit_pct,
      instrument: t.instrument,
      options_details: (t.options_details ?? null) as never,
      rationale: t.rationale,
    });
    if (error) { console.error("[autonomous] insert trade", error); continue; }
    cashRemaining -= allocCash;
    sectorCount.set(sect, (sectorCount.get(sect) ?? 0) + 1);
    opened += 1;
  }

  if (opened > 0) {
    await supabaseAdmin.from("paper_portfolios").update({ balance: cashRemaining, updated_at: new Date().toISOString() }).eq("id", portfolio.id);
  }

  const newCashPct = totalEquity > 0 ? (cashRemaining / totalEquity) * 100 : 0;
  await supabaseAdmin.from("agent_messages").insert({
    user_id: userId, role: "assistant", is_autonomous: true, session_type: sessionType,
    content: `${ai.message_to_user}\n\n📊 **Positions opened:** ${opened} | **Cash remaining:** ${newCashPct.toFixed(0)}%`,
  });
  await supabaseAdmin.from("agent_decisions").insert({
    user_id: userId, session_type: sessionType, regime,
    market_assessment: ai.market_assessment, payload: ai as never,
    trades_opened: opened,
  });
  // Note execution_mode influence (paper-only for now; live path would call broker)
  if (executionMode === "live") {
    console.log("[autonomous] live mode requested but paper execution used until broker integration.");
  }
  return opened;
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function callGateway(system: string, user: string): Promise<AiResponse | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.4,
      }),
    });
    if (!r.ok) { console.error("[gateway]", r.status, await r.text()); return null; }
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = j.choices?.[0]?.message?.content ?? "";
    const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
    return JSON.parse(cleaned) as AiResponse;
  } catch (e) {
    console.error("[gateway] parse", e);
    return null;
  }
}
