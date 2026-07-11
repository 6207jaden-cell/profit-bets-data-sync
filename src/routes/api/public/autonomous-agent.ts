import { createFileRoute } from "@tanstack/react-router";
import { buildContext, detectMarketRegime, fetchBars, fetchQuotePrice, isMarketOpen } from "@/lib/indicators";
import { scanCatalystsInternal } from "@/lib/catalysts.functions";

const UNIVERSE = {
  large_cap: ["AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","JPM","V","XOM","WMT","JNJ","HD","BAC","PG","DIS","NFLX","AMD","CRM","UBER"],
  small_mid_cap: ["PLTR","SOFI","RIVN","HOOD","COIN","RBLX","SNAP","LYFT","ABNB","ROKU","DKNG","OPEN","IONQ","SMCI","MSTR"],
  etfs: ["SPY","QQQ","IWM","GLD","TLT","XLF","XLK","XLE","ARKK","SOXL"],
  crypto: ["BTC-USD","ETH-USD","SOL-USD"],
};
const ALL_SYMBOLS = [
  ...UNIVERSE.large_cap, ...UNIVERSE.small_mid_cap, ...UNIVERSE.etfs, ...UNIVERSE.crypto,
];

const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  max_position_pct: 35, min_cash_pct: 20, stop_loss_pct: 7, take_profit_pct: 15, extra_symbols: [],
};

const SECTOR: Record<string, string> = {
  AAPL:"tech",MSFT:"tech",NVDA:"tech",GOOGL:"tech",AMZN:"tech",META:"tech",TSLA:"tech",
  AMD:"tech",CRM:"tech",NFLX:"tech",PLTR:"tech",SMCI:"tech",IONQ:"tech",MSTR:"tech",
  JPM:"finance",V:"finance",BAC:"finance",SOFI:"finance",HOOD:"finance",COIN:"finance",
  XOM:"energy",XLE:"energy",WMT:"consumer",JNJ:"health",HD:"consumer",PG:"consumer",
  DIS:"consumer",UBER:"consumer",LYFT:"consumer",ABNB:"consumer",RBLX:"consumer",
  SNAP:"consumer",ROKU:"consumer",DKNG:"consumer",OPEN:"consumer",RIVN:"consumer",
};

type AgentSettings = {
  max_position_pct: number;
  min_cash_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  extra_symbols: string[];
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

type UserRow = {
  user_id: string;
  autonomous_execution_mode: string | null;
  agent_settings: unknown;
  autonomous_paused_until: string | null;
};

function parseSettings(raw: unknown): AgentSettings {
  const s = (raw ?? {}) as Partial<AgentSettings>;
  return {
    max_position_pct: clamp(Number(s.max_position_pct ?? DEFAULT_AGENT_SETTINGS.max_position_pct), 5, 50),
    min_cash_pct: clamp(Number(s.min_cash_pct ?? DEFAULT_AGENT_SETTINGS.min_cash_pct), 10, 50),
    stop_loss_pct: clamp(Number(s.stop_loss_pct ?? DEFAULT_AGENT_SETTINGS.stop_loss_pct), 2, 15),
    take_profit_pct: clamp(Number(s.take_profit_pct ?? DEFAULT_AGENT_SETTINGS.take_profit_pct), 5, 30),
    extra_symbols: Array.isArray(s.extra_symbols) ? (s.extra_symbols as string[]).map((x) => String(x).toUpperCase()).slice(0, 20) : [],
  };
}
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export const Route = createFileRoute("/api/public/autonomous-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body = (await request.json().catch(() => ({}))) as { session?: string };
        const session: "morning" | "midday" | "weekend_prep" =
          body.session === "midday" ? "midday"
          : body.session === "weekend_prep" ? "weekend_prep"
          : "morning";
        const sessionType = session === "midday" ? "midday_scan"
          : session === "weekend_prep" ? "weekend_prep"
          : "morning_scan";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Auto-clear expired pauses so they take effect on next run.
        await supabaseAdmin
          .from("user_settings")
          .update({ autonomous_paused_until: null })
          .not("autonomous_paused_until", "is", null)
          .lt("autonomous_paused_until", new Date().toISOString());

        const { data: rawUsers } = await supabaseAdmin
          .from("user_settings")
          .select("user_id, autonomous_execution_mode, agent_settings, autonomous_paused_until")
          .eq("autonomous_mode", true);
        const activeUsers = (rawUsers ?? []) as UserRow[];
        // Skip users whose pause is still in the future.
        const eligibleUsers = activeUsers.filter((u) => {
          if (!u.autonomous_paused_until) return true;
          return new Date(u.autonomous_paused_until).getTime() <= Date.now();
        });
        if (eligibleUsers.length === 0) {
          return Response.json({ ok: true, reason: "no_eligible_users", paused: activeUsers.length - eligibleUsers.length });
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

        // Build candidate universe once (shared across users). Per-user extras added later.
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
        const skipped: Array<{ user: string; reason: string }> = [];
        for (const u of eligibleUsers) {
          try {
            const settings = parseSettings(u.agent_settings);
            const result = await runForUser({
              userId: u.user_id,
              executionMode: u.autonomous_execution_mode ?? "paper",
              session, sessionType, regime, vixLevel,
              candidates: sorted, supabaseAdmin, settings,
            });
            if (result.skipped) skipped.push({ user: u.user_id, reason: result.skipped });
            totalOpened += result.opened;
          } catch (e) {
            console.error("[autonomous-agent] user", u.user_id, e);
          }
        }

        return Response.json({
          ok: true, session, regime, vix: vixLevel,
          users: eligibleUsers.length, trades_opened: totalOpened, skipped,
          paused_users: activeUsers.length - eligibleUsers.length,
        });
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
  settings: AgentSettings;
}): Promise<{ opened: number; skipped?: string }> {
  const { userId, session, sessionType, regime, vixLevel, candidates, supabaseAdmin, executionMode, settings } = args;

  const { data: portfolio } = await supabaseAdmin
    .from("paper_portfolios").select("*").eq("user_id", userId).maybeSingle();
  if (!portfolio) return { opened: 0, skipped: "no_portfolio" };

  const startBal = Number(portfolio.starting_balance) || 0;
  const cash = Number(portfolio.balance) || 0;

  // Batch open trades once.
  const { data: openTrades } = await supabaseAdmin
    .from("paper_trades").select("*").eq("user_id", userId).eq("is_open", true);
  const openList = openTrades ?? [];

  // ---- Compute total unrealized P&L on open positions ----
  let unrealized = 0;
  const quotes = new Map<string, number>();
  await Promise.all(openList.map(async (t) => {
    const p = await fetchQuotePrice(String(t.asset));
    if (p) quotes.set(String(t.asset), p);
  }));
  for (const t of openList) {
    const q = quotes.get(String(t.asset));
    if (!q) continue;
    const qty = Number(t.quantity), entry = Number(t.entry_price);
    unrealized += (q - entry) * qty * (t.side === "buy" ? 1 : -1);
  }
  const currentEquity = cash + openList.reduce((s, t) => {
    const q = quotes.get(String(t.asset)) ?? Number(t.entry_price);
    return s + q * Number(t.quantity);
  }, 0);

  // ---- Today's realized P&L (for circuit breaker) ----
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const { data: closedToday } = await supabaseAdmin
    .from("paper_trades").select("pnl")
    .eq("user_id", userId).eq("is_open", false)
    .gte("closed_at", dayStart.toISOString());
  const realizedToday = (closedToday ?? []).reduce((s, t) => s + Number(t.pnl ?? 0), 0);
  const dayPnl = realizedToday + unrealized;
  const dayPnlPct = startBal > 0 ? (dayPnl / startBal) * 100 : 0;

  // ---- Circuit breaker: down >5% today → block entries, close intraday only ----
  if (dayPnlPct < -5) {
    let closedIntra = 0;
    for (const t of openList) {
      if (t.hold_duration !== "intraday") continue;
      const q = quotes.get(String(t.asset));
      if (!q) continue;
      const qty = Number(t.quantity), entry = Number(t.entry_price);
      const pnl = (q - entry) * qty * (t.side === "buy" ? 1 : -1);
      await supabaseAdmin.from("paper_trades").update({
        is_open: false, exit_price: q, pnl, closed_at: new Date().toISOString(),
      }).eq("id", t.id);
      closedIntra += 1;
    }
    // Post one circuit-breaker message per day max.
    const { data: existing } = await supabaseAdmin
      .from("agent_messages").select("id")
      .eq("user_id", userId).eq("session_type", "circuit_breaker")
      .gte("created_at", dayStart.toISOString()).limit(1).maybeSingle();
    if (!existing) {
      await supabaseAdmin.from("agent_messages").insert({
        user_id: userId, role: "assistant", is_autonomous: true, session_type: "circuit_breaker",
        content: `🛑 Circuit breaker triggered. Portfolio is down ${dayPnlPct.toFixed(1)}% today — pausing all new entries for the rest of the trading day to protect capital. Exits still active.`,
      });
    }
    await supabaseAdmin.from("agent_decisions").insert({
      user_id: userId, session_type: sessionType, regime, trades_opened: 0,
      payload: { circuit_breaker_triggered: true, day_pnl_pct: dayPnlPct, intraday_closed: closedIntra } as never,
    });
    console.log(`[autonomous] circuit_breaker_triggered user=${userId} pct=${dayPnlPct.toFixed(2)}`);
    return { opened: 0, skipped: "circuit_breaker" };
  }

  // ---- Drawdown protection: peak-to-current ----
  const { data: peakRow } = await supabaseAdmin
    .from("portfolio_snapshots").select("equity")
    .eq("user_id", userId).order("equity", { ascending: false }).limit(1).maybeSingle();
  const peakEquity = Math.max(Number(peakRow?.equity ?? 0), currentEquity, startBal);
  const drawdownPct = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
  const defensive = drawdownPct > 15;
  const effectiveMinCashPct = defensive ? 40 : settings.min_cash_pct;
  const effectiveMaxPositionPct = settings.max_position_pct;
  if (defensive) {
    const { data: existing } = await supabaseAdmin
      .from("agent_messages").select("id")
      .eq("user_id", userId).eq("session_type", "drawdown_protection")
      .gte("created_at", dayStart.toISOString()).limit(1).maybeSingle();
    if (!existing) {
      await supabaseAdmin.from("agent_messages").insert({
        user_id: userId, role: "assistant", is_autonomous: true, session_type: "drawdown_protection",
        content: `⚠️ Drawdown protection active. Portfolio is ${drawdownPct.toFixed(1)}% below peak. Switching to defensive mode: 40% min cash, long equities only, high conviction only. Will restore normal parameters when within 10% of peak.`,
      });
    }
  }

  const cashPct = currentEquity > 0 ? (cash / currentEquity) * 100 : 100;
  if (cashPct < effectiveMinCashPct) {
    await supabaseAdmin.from("agent_messages").insert({
      user_id: userId, role: "assistant", is_autonomous: true, session_type: sessionType,
      content: `Held off on new positions — cash is at ${cashPct.toFixed(0)}%, below the ${effectiveMinCashPct}% minimum reserve${defensive ? " (defensive mode)" : ""}.`,
    });
    await supabaseAdmin.from("agent_decisions").insert({
      user_id: userId, session_type: sessionType, regime, trades_opened: 0,
      payload: { skipped: "min_cash", defensive, drawdown_pct: drawdownPct } as never,
    });
    return { opened: 0, skipped: "min_cash" };
  }

  const { data: learnings } = await supabaseAdmin
    .from("agent_learnings").select("analysis, key_insights, adjustments")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(4);
  const learningsSummary = (learnings ?? []).map((l, i) =>
    `Week ${i + 1}: ${l.analysis?.slice(0, 300)} | Adj: ${JSON.stringify(l.adjustments).slice(0, 200)}`
  ).join("\n") || "No prior learnings yet.";

  const userMessage = {
    session, regime, vix_level: vixLevel,
    portfolio: { cash, equity: currentEquity, cash_pct: cashPct, open_positions_count: openList.length, day_pnl_pct: dayPnlPct, drawdown_pct: drawdownPct },
    defensive_mode: defensive,
    settings: {
      max_position_pct: effectiveMaxPositionPct,
      min_cash_pct: effectiveMinCashPct,
      default_stop_loss_pct: settings.stop_loss_pct,
      default_take_profit_pct: settings.take_profit_pct,
    },
    candidates,
    current_positions: openList.map((t) => ({
      id: t.id, asset: t.asset, side: t.side, entry_price: t.entry_price,
      hold_duration: t.hold_duration, instrument: t.instrument,
    })),
    learnings_summary: learningsSummary,
    margin_available: false,
  };

  const systemPrompt = `You are an autonomous portfolio manager with deep expertise in equities, ETFs, crypto, and options (calls, puts, vertical spreads, iron condors). You manage a ring-fenced trading account. Your only goal is to maximize risk-adjusted returns over time.

HARD RULES — never violate these:
- Always maintain at least ${effectiveMinCashPct}% cash. Never deploy more than ${100 - effectiveMinCashPct}% of the portfolio.
- Never allocate more than ${effectiveMaxPositionPct}% to a single position.
- Default stop-loss is ${settings.stop_loss_pct}%, default take-profit is ${settings.take_profit_pct}% — tighten or loosen only with clear rationale.
- For SHORT positions: only recommend if margin_available is true. If not, use puts instead.
- Never trade assets with earnings within 48 hours.
- Session "midday" is intraday only — set hold_duration="intraday" for all midday trades.
- If defensive_mode is true: LONG stock/etf/crypto only (no shorts, no options, no spreads), conviction must be >= 75.
- If nothing compelling, return an empty trades array. Doing nothing is always valid.

Respond with ONLY valid JSON — no prose, no markdown fences:
{
  "market_assessment": "2-3 sentence market overview",
  "regime": "bull|bear|sideways",
  "cash_deployment_pct": <0-${100 - effectiveMinCashPct} number>,
  "trades": [ { "symbol": "NVDA", "direction": "long|short", "instrument": "stock|etf|crypto|call|put|call_spread|put_spread|iron_condor", "conviction": <0-100>, "allocation_pct": <1-${effectiveMaxPositionPct}>, "stop_loss_pct": <number>, "take_profit_pct": <number>, "hold_duration": "intraday|swing|position", "rationale": "2-3 sentence explanation", "options_details": { "expiry_days_out": 21, "strike_type": "atm|otm_1|otm_2|itm_1", "contracts": 1, "spread_width": null } } ],
  "message_to_user": "Friendly 2-4 sentence summary."
}`;

  const ai = await callGateway(systemPrompt, JSON.stringify(userMessage));
  if (!ai) {
    await supabaseAdmin.from("agent_decisions").insert({
      user_id: userId, session_type: sessionType, regime, trades_opened: 0,
      payload: { ai_error: true } as never,
    });
    return { opened: 0, skipped: "ai_error" };
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
    if (t.direction === "short" && !userMessage.margin_available) {
      t = { ...t, instrument: "put", direction: "long", rationale: `${t.rationale} [converted from short to put — margin unavailable]` };
    }
    // Defensive-mode enforcement: block options/shorts/spreads + conviction filter
    if (defensive) {
      const okInstrument = ["stock", "etf", "crypto"].includes(t.instrument);
      if (!okInstrument || t.direction === "short" || (t.conviction ?? 0) < 75) continue;
    }
    const allocPct = Math.min(t.allocation_pct, effectiveMaxPositionPct);
    const allocCash = (cash * allocPct) / 100;
    if (allocCash > cashRemaining * 0.99) continue;
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
      stop_loss_pct: t.stop_loss_pct ?? settings.stop_loss_pct,
      take_profit_pct: t.take_profit_pct ?? settings.take_profit_pct,
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

  const newCashPct = currentEquity > 0 ? (cashRemaining / currentEquity) * 100 : 0;
  await supabaseAdmin.from("agent_messages").insert({
    user_id: userId, role: "assistant", is_autonomous: true, session_type: sessionType,
    content: `${ai.message_to_user}\n\n📊 **Positions opened:** ${opened} | **Cash remaining:** ${newCashPct.toFixed(0)}%${defensive ? " · defensive mode" : ""}${vixLevel != null ? ` · VIX ${vixLevel.toFixed(1)}` : ""}`,
  });
  await supabaseAdmin.from("agent_decisions").insert({
    user_id: userId, session_type: sessionType, regime,
    market_assessment: ai.market_assessment, payload: ai as never,
    trades_opened: opened,
  });
  if (executionMode === "live") {
    console.log("[autonomous] live mode requested but paper execution used until broker integration.");
  }
  return { opened };
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
