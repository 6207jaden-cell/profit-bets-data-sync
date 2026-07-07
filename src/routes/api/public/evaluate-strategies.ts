import { createFileRoute } from "@tanstack/react-router";
import { fetchDailyCloses, buildContext, evalGroup, isCryptoSymbol, isMarketOpen, detectMarketRegime, atr } from "@/lib/indicators";
import { fireWebhook } from "@/lib/webhook.functions";


/**
 * Autonomous paper-trading evaluator. Called by pg_cron every 5 minutes.
 * Enhancements: confidence-scaled sizing, ATR volatility sizing,
 * sector concentration guard, auto-retirement of poor performers.
 */

type Quote = { price: number; source: string };

const SECTOR: Record<string, string> = {
  AAPL: "tech", MSFT: "tech", NVDA: "tech", GOOGL: "tech", META: "tech", AMZN: "tech",
  TSLA: "auto", F: "auto", GM: "auto",
  JPM: "finance", BAC: "finance", GS: "finance",
  XOM: "energy", CVX: "energy",
  SPY: "etf", QQQ: "etf", IWM: "etf",
  BTC: "crypto", ETH: "crypto", SOL: "crypto", "BTC-USD": "crypto", "ETH-USD": "crypto", "SOL-USD": "crypto",
};

function cryptoBase(sym: string): string {
  return sym.toUpperCase().replace(/[-/]USD[T]?$/, "");
}

async function fetchLiveQuote(symbol: string): Promise<Quote | null> {
  const S = symbol.toUpperCase();
  const isCrypto = isCryptoSymbol(S);
  const fin = process.env.FINNHUB_API_KEY;
  const poly = process.env.POLYGON_API_KEY;
  const alpha = process.env.ALPHA_VANTAGE_API_KEY;
  try {
    if (fin && !isCrypto) {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${S}&token=${fin}`);
      if (r.ok) { const j = (await r.json()) as { c?: number }; if (j.c) return { price: j.c, source: "finnhub" }; }
    }
    if (fin && isCrypto) {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=BINANCE:${cryptoBase(S)}USDT&token=${fin}`);
      if (r.ok) { const j = (await r.json()) as { c?: number }; if (j.c) return { price: j.c, source: "finnhub" }; }
    }
  } catch { /* fall */ }
  try {
    if (poly) {
      const polySym = isCrypto ? `X:${cryptoBase(S)}USD` : S;
      const r = await fetch(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(polySym)}/prev?apiKey=${poly}`);
      if (r.ok) {
        const j = (await r.json()) as { results?: Array<{ c: number }> };
        const c = j.results?.[0]?.c;
        if (c) return { price: c, source: "polygon" };
      }
    }
  } catch { /* fall */ }
  try {
    if (alpha && !isCrypto) {
      const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${S}&apikey=${alpha}`);
      if (r.ok) {
        const j = (await r.json()) as { ["Global Quote"]?: Record<string, string> };
        const p = j["Global Quote"]?.["05. price"];
        if (p) return { price: Number(p), source: "alphavantage" };
      }
    }
  } catch { /* fall */ }
  return null;
}

/** Fetch daily OHLC bars for ATR from Polygon. */
async function fetchOHLC(symbol: string, days = 60): Promise<{ highs: number[]; lows: number[]; closes: number[] } | null> {
  const poly = process.env.POLYGON_API_KEY;
  if (!poly) return null;
  const S = symbol.toUpperCase();
  const isCrypto = isCryptoSymbol(S);
  const polySym = isCrypto ? `X:${cryptoBase(S)}USD` : S;
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  try {
    const r = await fetch(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(polySym)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=500&apiKey=${poly}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { results?: Array<{ h: number; l: number; c: number }> };
    if (!j.results?.length) return null;
    return {
      highs: j.results.map((b) => b.h),
      lows: j.results.map((b) => b.l),
      closes: j.results.map((b) => b.c),
    };
  } catch { return null; }
}

type StrategyRow = {
  id: string;
  user_id: string;
  name?: string;
  style?: string | null;
  strategy_json: {
    entry?: { conditions?: string[]; logic?: "AND" | "OR" };
    exit?: { conditions?: string[]; logic?: "AND" | "OR" };
    universe?: string[];
    style?: string;
  };
};


function sectorFor(sym: string): string {
  return SECTOR[sym.toUpperCase()] ?? "other";
}

/** Return true if the symbol has an earnings release in the next 48h. */
async function earningsWithin48h(symbol: string): Promise<{ blocked: boolean; date?: string }> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return { blocked: false };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const r = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${to}&symbol=${symbol}&token=${key}`);
    if (!r.ok) return { blocked: false };
    const j = (await r.json()) as { earningsCalendar?: Array<{ date: string; symbol: string }> };
    for (const e of j.earningsCalendar ?? []) {
      if (e.symbol.toUpperCase() !== symbol.toUpperCase()) continue;
      const diffH = (new Date(e.date).getTime() - Date.now()) / 3600_000;
      if (diffH >= 0 && diffH <= 48) return { blocked: true, date: e.date };
    }
    return { blocked: false };
  } catch { return { blocked: false }; }
}

/** Simple AI sentiment on recent headlines. Fails open. */
async function newsSentiment(symbol: string): Promise<{ sentiment: "positive" | "negative" | "neutral"; confidence: number; reason: string } | null> {
  const finKey = process.env.FINNHUB_API_KEY;
  const aiKey = process.env.LOVABLE_API_KEY;
  if (!finKey || !aiKey) return null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const nr = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${yday}&to=${today}&token=${finKey}`);
    if (!nr.ok) return null;
    const nj = (await nr.json()) as Array<{ headline?: string }>;
    const headlines = (nj ?? []).slice(0, 5).map((n) => n.headline ?? "").filter(Boolean);
    if (headlines.length < 2) return null;
    const prompt = `Given these recent news headlines for ${symbol}, respond with ONLY a JSON object: { "sentiment": "positive"|"negative"|"neutral", "confidence": 0-100, "reason": "one sentence" }. Headlines: ${headlines.join(" | ")}`;
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": aiKey, "X-Lovable-AIG-SDK": "direct" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return null;
    const jj = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(jj.choices?.[0]?.message?.content ?? "{}") as { sentiment?: string; confidence?: number; reason?: string };
    const s = parsed.sentiment === "positive" || parsed.sentiment === "negative" ? parsed.sentiment : "neutral";
    return { sentiment: s, confidence: Number(parsed.confidence ?? 0), reason: String(parsed.reason ?? "") };
  } catch { return null; }
}


export const Route = createFileRoute("/api/public/evaluate-strategies")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        if (!anon || apikey !== anon) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const ts = new Date().toISOString();
        const marketOpen = isMarketOpen();

        const { data: strategies, error: sErr } = await supabaseAdmin
          .from("strategies")
          .select("id, user_id, name, style, strategy_json")
          .eq("execution_mode", "paper").eq("active", true);
        if (sErr) return Response.json({ ok: false, error: sErr.message }, { status: 500 });
        if (!strategies || strategies.length === 0) {
          return Response.json({ ok: true, evaluated: 0, opened: 0, closed: 0, errors: [], ts, market_open: marketOpen });
        }


        const byUser = new Map<string, StrategyRow[]>();
        for (const s of strategies as StrategyRow[]) {
          const arr = byUser.get(s.user_id) ?? [];
          arr.push(s);
          byUser.set(s.user_id, arr);
        }

        let evaluated = 0, opened = 0, closed = 0, retired = 0;
        const errors: Array<{ user_id?: string; strategy_id?: string; symbol?: string; reason: string }> = [];

        const closesCache = new Map<string, number[] | null>();
        const quoteCache = new Map<string, Quote | null>();
        const ohlcCache = new Map<string, { highs: number[]; lows: number[]; closes: number[] } | null>();
        const getCloses = async (sym: string) => {
          if (closesCache.has(sym)) return closesCache.get(sym)!;
          const v = await fetchDailyCloses(sym, 220);
          closesCache.set(sym, v);
          return v;
        };
        const getQuote = async (sym: string) => {
          if (quoteCache.has(sym)) return quoteCache.get(sym)!;
          const v = await fetchLiveQuote(sym);
          quoteCache.set(sym, v);
          return v;
        };
        const getOHLC = async (sym: string) => {
          if (ohlcCache.has(sym)) return ohlcCache.get(sym)!;
          const v = await fetchOHLC(sym, 60);
          ohlcCache.set(sym, v);
          return v;
        };

        for (const [userId, userStrats] of byUser) {
          try {
            const { data: portfolio } = await supabaseAdmin
              .from("paper_portfolios").select("*").eq("user_id", userId).maybeSingle();
            if (!portfolio) { errors.push({ user_id: userId, reason: "no_portfolio" }); continue; }
            const { data: limits } = await supabaseAdmin
              .from("risk_limits").select("*").eq("user_id", userId).maybeSingle();
            const maxDailyLossPct = Number(limits?.max_daily_loss_pct ?? 5);
            const maxPositionPct = Number(limits?.max_position_pct ?? 10);
            const cooldown = Number(limits?.cooldown_seconds ?? 30);

            const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
            const { data: todayTrades } = await supabaseAdmin
              .from("paper_trades").select("pnl")
              .eq("user_id", userId).eq("is_open", false)
              .gte("closed_at", dayStart.toISOString());
            const dayPnl = (todayTrades ?? []).reduce((a, t) => a + Number(t.pnl ?? 0), 0);
            const startBal = Number(portfolio.starting_balance);
            const dailyLossHit = startBal > 0 && (-dayPnl / startBal) * 100 >= maxDailyLossPct;

            const { data: lastExec } = await supabaseAdmin
              .from("signals_executions").select("created_at")
              .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
            const cooldownRemaining = lastExec
              ? Math.max(0, cooldown - (Date.now() - new Date(lastExec.created_at).getTime()) / 1000)
              : 0;

            // Sector snapshot of currently open positions
            const { data: openAll } = await supabaseAdmin
              .from("paper_trades").select("asset").eq("user_id", userId).eq("is_open", true);
            const sectorCounts = new Map<string, number>();
            for (const t of openAll ?? []) {
              const sec = sectorFor(String(t.asset));
              sectorCounts.set(sec, (sectorCounts.get(sec) ?? 0) + 1);
            }
            const totalOpen = openAll?.length ?? 0;

            let cash = Number(portfolio.balance);

            // Market regime (one-shot per user via SPY)
            const spyCloses = await getCloses("SPY");
            const regime = spyCloses ? detectMarketRegime(spyCloses) : "sideways";


            for (const strat of userStrats) {
              const sj = strat.strategy_json ?? {};
              const universe = (sj.universe ?? []).map((s) => String(s).toUpperCase()).filter(Boolean);
              const entryConds = sj.entry?.conditions ?? [];
              const entryLogic = sj.entry?.logic === "OR" ? "OR" : "AND";
              const exitConds = sj.exit?.conditions ?? [];
              const exitLogic = sj.exit?.logic === "OR" ? "OR" : "AND";

              for (const symbol of universe) {
                evaluated++;
                try {
                  const symIsCrypto = isCryptoSymbol(symbol);
                  // Market hours guard — stocks skipped when closed
                  if (!symIsCrypto && !marketOpen) {
                    continue;
                  }
                  const closes = await getCloses(symbol);
                  const quote = await getQuote(symbol);
                  if (!closes || !quote) {
                    errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: "market_data_unavailable" });
                    continue;
                  }
                  const liveCloses = [...closes, quote.price];


                  // Exits first
                  const { data: openTrades } = await supabaseAdmin
                    .from("paper_trades").select("*")
                    .eq("user_id", userId).eq("strategy_id", strat.id)
                    .eq("asset", symbol).eq("is_open", true);

                  for (const trade of openTrades ?? []) {
                    const exitCtx = buildContext(liveCloses, Number(trade.entry_price));
                    if (!exitCtx || exitConds.length === 0) continue;
                    if (!evalGroup(exitConds, exitLogic, exitCtx)) continue;
                    const qty = Number(trade.quantity);
                    const entry = Number(trade.entry_price);
                    const proceeds = qty * quote.price;
                    const cost = qty * entry;
                    const pnl = trade.side === "buy" ? proceeds - cost : cost - proceeds;
                    await supabaseAdmin.from("paper_trades").update({
                      is_open: false, exit_price: quote.price, pnl, closed_at: new Date().toISOString(),
                    }).eq("id", trade.id);
                    cash += proceeds;
                    await supabaseAdmin.from("paper_portfolios").update({
                      balance: cash, equity: cash, updated_at: new Date().toISOString(),
                    }).eq("id", portfolio.id);
                    await supabaseAdmin.from("signals_executions").insert({
                      user_id: userId, strategy_id: strat.id, execution_type: "paper", status: "filled",
                      asset: symbol, side: trade.side === "buy" ? "sell" : "buy",
                      quantity: qty, price: quote.price,
                      reason: `auto_exit pnl=${pnl.toFixed(2)} via ${quote.source}`,
                    });
                    await fireWebhook(userId, "trade_close", { strategy_id: strat.id, asset: symbol, side: trade.side === "buy" ? "sell" : "buy", quantity: qty, price: quote.price, pnl });
                    // Update sector counts (this asset just closed)
                    const sec = sectorFor(symbol);
                    sectorCounts.set(sec, Math.max(0, (sectorCounts.get(sec) ?? 1) - 1));
                    closed++;
                  }


                  // Entries
                  if (dailyLossHit || cooldownRemaining > 0) continue;
                  if (entryConds.length === 0) continue;

                  const { count: openCount } = await supabaseAdmin
                    .from("paper_trades").select("id", { count: "exact", head: true })
                    .eq("user_id", userId).eq("strategy_id", strat.id)
                    .eq("asset", symbol).eq("is_open", true);
                  if ((openCount ?? 0) > 0) continue;

                  const entryCtx = buildContext(liveCloses, null);
                  if (!entryCtx) continue;
                  if (!evalGroup(entryConds, entryLogic, entryCtx)) continue;

                  // Sector concentration guard
                  const sec = sectorFor(symbol);
                  const secCount = sectorCounts.get(sec) ?? 0;
                  if (totalOpen >= 3 && (secCount + 1) / (totalOpen + 1) >= 0.4) {
                    errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: `blocked:sector_concentration sector=${sec} (${secCount}/${totalOpen} positions)` });
                    continue;
                  }

                  let allocPct = Math.min(maxPositionPct, 10);

                  // Confidence-based sizing from recent market signal
                  const sixHoursAgo = new Date(Date.now() - 6 * 3600_000).toISOString();
                  const { data: sig } = await supabaseAdmin
                    .from("market_signals")
                    .select("confidence")
                    .eq("asset", symbol).eq("result", "open")
                    .gte("created_at", sixHoursAgo)
                    .order("created_at", { ascending: false }).limit(1).maybeSingle();
                  const confidence = sig?.confidence != null ? Number(sig.confidence) : null;
                  if (confidence != null) {
                    if (confidence < 40) {
                      errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: `blocked:low_confidence conf=${confidence}` });
                      continue;
                    }
                    if (confidence < 60) allocPct *= 0.5;
                    else if (confidence < 80) allocPct *= 0.75;
                  }

                  // Volatility-adjusted sizing (ATR)
                  const ohlc = await getOHLC(symbol);
                  let volPct: number | null = null;
                  if (ohlc) {
                    const a = atr(ohlc.highs, ohlc.lows, ohlc.closes, 14);
                    if (a && quote.price) {
                      volPct = (a / quote.price) * 100;
                      if (volPct > 10) allocPct *= 0.25;
                      else if (volPct > 5) allocPct *= 0.5;
                    }
                  }
                  allocPct = Math.max(2, allocPct); // floor 2%

                  const allocCash = (cash * allocPct) / 100;
                  if (allocCash <= 0) {
                    errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: "insufficient_cash" });
                    continue;
                  }
                  const quantity = allocCash / quote.price;

                  const { data: newTrade, error: tErr } = await supabaseAdmin
                    .from("paper_trades").insert({
                      user_id: userId, portfolio_id: portfolio.id, strategy_id: strat.id,
                      asset: symbol, side: "buy", quantity, entry_price: quote.price, is_open: true,
                    }).select().single();
                  if (tErr || !newTrade) {
                    errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: tErr?.message ?? "insert_failed" });
                    continue;
                  }
                  cash -= allocCash;
                  sectorCounts.set(sec, secCount + 1);
                  await supabaseAdmin.from("paper_portfolios").update({
                    balance: cash, equity: cash, updated_at: new Date().toISOString(),
                  }).eq("id", portfolio.id);
                  await supabaseAdmin.from("signals_executions").insert({
                    user_id: userId, strategy_id: strat.id, execution_type: "paper", status: "filled",
                    asset: symbol, side: "buy", quantity, price: quote.price,
                    reason: `auto_entry via ${quote.source} alloc=${allocPct.toFixed(1)}%${confidence != null ? ` conf=${confidence}` : ""}${volPct != null ? ` vol=${volPct.toFixed(2)}%` : ""}`,
                  });
                  opened++;
                } catch (e) {
                  errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: e instanceof Error ? e.message : "symbol_eval_failed" });
                }
              }
            }

            // Auto-retire poor performers for this user
            for (const strat of userStrats) {
              const { data: closedTrades } = await supabaseAdmin
                .from("paper_trades").select("pnl").eq("user_id", userId).eq("strategy_id", strat.id).eq("is_open", false);
              const rows = closedTrades ?? [];
              if (rows.length < 10) continue;
              const wins = rows.filter((r) => Number(r.pnl ?? 0) > 0).length;
              const winRate = (wins / rows.length) * 100;
              const totalPnl = rows.reduce((a, r) => a + Number(r.pnl ?? 0), 0);
              const roi = startBal > 0 ? (totalPnl / startBal) * 100 : 0;
              if (winRate < 35 || roi < -10) {
                await supabaseAdmin.from("strategies").update({ active: false }).eq("id", strat.id);
                await supabaseAdmin.from("signals_executions").insert({
                  user_id: userId, strategy_id: strat.id, execution_type: "paper", status: "cancelled",
                  asset: "SYSTEM", side: "sell", quantity: 0, price: 0,
                  reason: `auto_retired: poor_live_performance win_rate=${winRate.toFixed(0)}% roi=${roi.toFixed(1)}% retired_name=${strat.name ?? ""}`,
                });
                retired++;
                // Trigger a replacement strategy generation
                try {
                  const url = `https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad-dev.lovable.app/api/public/generate-strategies`;
                  await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", apikey: anon },
                    body: JSON.stringify({ retired_name: strat.name ?? "" }),
                  });
                } catch { /* best-effort */ }
              }
            }
          } catch (e) {
            errors.push({ user_id: userId, reason: e instanceof Error ? e.message : "user_eval_failed" });
          }
        }

        return Response.json({ ok: true, evaluated, opened, closed, retired, errors, ts });
      },
    },
  },
});
