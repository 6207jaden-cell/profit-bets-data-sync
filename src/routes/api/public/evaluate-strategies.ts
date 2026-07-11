import { createFileRoute } from "@tanstack/react-router";
import { fetchBars, buildContext, evalGroup, isCryptoSymbol, isMarketOpen, detectMarketRegime, atr, fetchQuotePrice, type Bars } from "@/lib/indicators";
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

// fetchOHLC removed — shared fetchBars from indicators.ts now provides {highs, lows, closes, ...}


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

/** Sentiment using Finnhub's built-in NLP sentiment score — faster and more reliable than AI one-shot.
 * Falls back to article count only if sentiment endpoint is unavailable.
 */
async function newsSentiment(symbol: string): Promise<{ sentiment: "positive" | "negative" | "neutral"; confidence: number; reason: string } | null> {
  const finKey = process.env.FINNHUB_API_KEY;
  if (!finKey) return null;
  try {
    // Primary: Finnhub pre-computed sentiment (no AI cost, instant, runs their own NLP)
    const r = await fetch(`https://finnhub.io/api/v1/news-sentiment?symbol=${symbol}&token=${finKey}`);
    if (r.ok) {
      const j = (await r.json()) as {
        sentiment?: { bearishPercent?: number; bullishPercent?: number };
        companyNewsScore?: number;
      };
      const bullish = j.sentiment?.bullishPercent ?? 0;
      const bearish = j.sentiment?.bearishPercent ?? 0;
      if (!bullish && !bearish) return null;
      const net = bullish - bearish;
      const sentiment: "positive" | "negative" | "neutral" =
        net > 0.15 ? "positive" : net < -0.15 ? "negative" : "neutral";
      const confidence = Math.round(Math.min(90, Math.abs(net) * 200));
      return {
        sentiment,
        confidence,
        reason: `${(bullish * 100).toFixed(0)}% bullish / ${(bearish * 100).toFixed(0)}% bearish (Finnhub NLP)`,
      };
    }
  } catch { /* fall through */ }
  // Fallback: headline count proxy (no AI call)
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const r2 = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${yday}&to=${today}&token=${finKey}`);
    if (!r2.ok) return null;
    const nj = (await r2.json()) as Array<unknown>;
    if ((nj ?? []).length < 2) return null;
    return { sentiment: "neutral", confidence: 20, reason: `${nj.length} articles (NLP unavailable)` };
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

        // ---------- Per-run shared caches ----------
        const barsCache = new Map<string, Bars | null>();
        const quoteCache = new Map<string, Quote | null>();
        const earningsCache = new Map<string, { blocked: boolean; date?: string }>();
        const sentimentCache = new Map<string, { sentiment: "positive" | "negative" | "neutral"; confidence: number; reason: string } | null>();

        const getBars = async (sym: string) => {
          if (barsCache.has(sym)) return barsCache.get(sym)!;
          const v = await fetchBars(sym, 220);
          barsCache.set(sym, v);
          return v;
        };
        const getQuote = async (sym: string) => {
          if (quoteCache.has(sym)) return quoteCache.get(sym)!;
          const v = await fetchLiveQuote(sym);
          quoteCache.set(sym, v);
          return v;
        };
        const getEarnings = async (sym: string) => {
          if (earningsCache.has(sym)) return earningsCache.get(sym)!;
          const v = await earningsWithin48h(sym);
          earningsCache.set(sym, v);
          return v;
        };
        const getSentiment = async (sym: string) => {
          if (sentimentCache.has(sym)) return sentimentCache.get(sym)!;
          const v = await newsSentiment(sym);
          sentimentCache.set(sym, v);
          return v;
        };

        // Fetch SPY once for the whole run and derive regime once.
        const spyBars = await getBars("SPY");
        const regime = spyBars ? detectMarketRegime(spyBars.closes) : "sideways";
        // VIX once per run — used to scale allocation for non-crypto entries.
        const vixLevel = await fetchQuotePrice("VIX").catch(() => null);


        for (const [userId, userStrats] of byUser) {
          try {
            // Parallelize all per-user setup queries.
            const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
            const [
              portfolioRes,
              limitsRes,
              todayTradesRes,
              lastExecRes,
              openAllRes,
              closedTradesRes,
              peakSnapshotRes,
            ] = await Promise.all([
              supabaseAdmin.from("paper_portfolios").select("*").eq("user_id", userId).maybeSingle(),
              supabaseAdmin.from("risk_limits").select("*").eq("user_id", userId).maybeSingle(),
              supabaseAdmin.from("paper_trades").select("pnl")
                .eq("user_id", userId).eq("is_open", false)
                .gte("closed_at", dayStart.toISOString()),
              supabaseAdmin.from("signals_executions").select("created_at")
                .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
              supabaseAdmin.from("paper_trades").select("*")
                .eq("user_id", userId).eq("is_open", true),
              supabaseAdmin.from("paper_trades")
                .select("strategy_id, pnl")
                .eq("user_id", userId).eq("is_open", false),
              supabaseAdmin.from("portfolio_snapshots").select("equity")
                .eq("user_id", userId).order("equity", { ascending: false }).limit(1).maybeSingle(),
            ]);

            const portfolio = portfolioRes.data;
            if (!portfolio) { errors.push({ user_id: userId, reason: "no_portfolio" }); continue; }
            const limits = limitsRes.data;
            const maxDailyLossPct = Number(limits?.max_daily_loss_pct ?? 5);
            const maxPositionPct = Number(limits?.max_position_pct ?? 10);
            const cooldown = Number(limits?.cooldown_seconds ?? 30);

            const dayPnl = (todayTradesRes.data ?? []).reduce((a, t) => a + Number(t.pnl ?? 0), 0);
            const startBal = Number(portfolio.starting_balance);
            const dailyLossHit = startBal > 0 && (-dayPnl / startBal) * 100 >= maxDailyLossPct;

            // ---- Portfolio circuit breaker: block ALL entries if down > 5% today ----
            const dayPnlPct = startBal > 0 ? (dayPnl / startBal) * 100 : 0;
            const circuitBreaker = dayPnlPct < -5;
            if (circuitBreaker) {
              errors.push({ user_id: userId, reason: `circuit_breaker_triggered pct=${dayPnlPct.toFixed(2)}` });
            }

            // ---- Drawdown protection: peak-to-current > 15% ----
            const currentEquity = Number(portfolio.equity) || Number(portfolio.balance) || 0;
            const peakEquity = Math.max(Number(peakSnapshotRes.data?.equity ?? 0), currentEquity, startBal);
            const drawdownPct = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
            const defensiveMode = drawdownPct > 15;

            const lastExec = lastExecRes.data;
            const cooldownRemaining = lastExec
              ? Math.max(0, cooldown - (Date.now() - new Date(lastExec.created_at).getTime()) / 1000)
              : 0;


            // Index open trades by strategy_id+asset for O(1) lookup during the loop.
            const openAll = openAllRes.data ?? [];
            const openByKey = new Map<string, typeof openAll>();
            const sectorCounts = new Map<string, number>();
            for (const t of openAll) {
              const key = `${t.strategy_id}:${String(t.asset).toUpperCase()}`;
              const arr = openByKey.get(key) ?? [];
              arr.push(t);
              openByKey.set(key, arr);
              const sec = sectorFor(String(t.asset));
              sectorCounts.set(sec, (sectorCounts.get(sec) ?? 0) + 1);
            }
            let totalOpen = openAll.length;

            let cash = Number(portfolio.balance);
            let portfolioDirty = false;

            // Buffer batch inserts.
            const executionsBuffer: Array<{ user_id: string; strategy_id: string; execution_type: "paper"; status: "filled"; asset: string; side: "buy" | "sell"; quantity: number; price: number; reason: string }> = [];

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
                  if (!symIsCrypto && !marketOpen) continue;

                  // Fetch bars + quote in parallel.
                  const [bars, quote] = await Promise.all([getBars(symbol), getQuote(symbol)]);
                  if (!bars || !quote) {
                    errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: "market_data_unavailable" });
                    continue;
                  }
                  const liveCloses = [...bars.closes, quote.price];

                  // Exits — use batched open positions.
                  const key = `${strat.id}:${symbol}`;
                  const openTrades = openByKey.get(key) ?? [];
                  for (const trade of openTrades) {
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
                    portfolioDirty = true;
                    executionsBuffer.push({
                      user_id: userId, strategy_id: strat.id, execution_type: "paper", status: "filled",
                      asset: symbol, side: trade.side === "buy" ? "sell" : "buy",
                      quantity: qty, price: quote.price,
                      reason: `auto_exit pnl=${pnl.toFixed(2)} via ${quote.source}`,
                    });
                    await fireWebhook(userId, "trade_close", { strategy_id: strat.id, asset: symbol, side: trade.side === "buy" ? "sell" : "buy", quantity: qty, price: quote.price, pnl });
                    const sec = sectorFor(symbol);
                    sectorCounts.set(sec, Math.max(0, (sectorCounts.get(sec) ?? 1) - 1));
                    totalOpen = Math.max(0, totalOpen - 1);
                    closed++;
                  }
                  openByKey.delete(key);

                  // Entries
                  if (dailyLossHit || cooldownRemaining > 0 || circuitBreaker) continue;


                  if (entryConds.length === 0) continue;
                  // Skip if any open position exists for this strategy+symbol (already handled above).
                  if ((openByKey.get(key)?.length ?? 0) > 0) continue;

                  const entryCtx = buildContext(liveCloses, null);
                  if (!entryCtx) continue;
                  if (!evalGroup(entryConds, entryLogic, entryCtx)) continue;

                  // Earnings + sentiment in parallel (both cached per symbol; fail-open).
                  if (!symIsCrypto) {
                    const [er, ns] = await Promise.all([getEarnings(symbol), getSentiment(symbol)]);
                    if (er.blocked) {
                      errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: `blocked:earnings_proximity symbol=${symbol} earnings_date=${er.date}` });
                      continue;
                    }
                    if (ns && ns.sentiment === "negative" && ns.confidence >= 70) {
                      errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: `blocked:negative_news_sentiment symbol=${symbol} confidence=${ns.confidence} reason=${ns.reason}` });
                      continue;
                    }
                  }

                  const sec = sectorFor(symbol);
                  const secCount = sectorCounts.get(sec) ?? 0;
                  if (totalOpen >= 3 && (secCount + 1) / (totalOpen + 1) >= 0.4) {
                    errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: `blocked:sector_concentration sector=${sec} (${secCount}/${totalOpen} positions)` });
                    continue;
                  }

                  let allocPct = Math.min(maxPositionPct, 10);

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
                  // Defensive mode: require higher confidence (>=75) if we have a signal, block otherwise.
                  if (defensiveMode) {
                    if (confidence == null || confidence < 75) {
                      errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: `blocked:defensive_mode_low_conviction drawdown=${drawdownPct.toFixed(1)}%` });
                      continue;
                    }
                  }

                  // ATR volatility sizing — reuse the same Bars fetched above.
                  let volPct: number | null = null;
                  const a = atr(bars.highs, bars.lows, bars.closes, 14);
                  if (a && quote.price) {
                    volPct = (a / quote.price) * 100;
                    if (volPct > 10) allocPct *= 0.25;
                    else if (volPct > 5) allocPct *= 0.5;
                  }

                  // VIX-based allocation scaling (equities only — crypto has its own vol profile).
                  let vixMult = 1;
                  if (!symIsCrypto && vixLevel != null) {
                    if (vixLevel > 35) vixMult = 0.25;
                    else if (vixLevel > 25) vixMult = 0.5;
                    else if (vixLevel < 15) vixMult = 1.1;
                    allocPct *= vixMult;
                  }
                  allocPct = Math.max(2, allocPct);

                  const style = strat.style ?? sj.style ?? null;
                  let regimeMult = 1;
                  if (style === "momentum") {
                    regimeMult = regime === "bull" ? 1.25 : regime === "bear" ? 0.5 : 1;
                  } else if (style === "mean_reversion") {
                    regimeMult = regime === "sideways" ? 1.25 : 0.75;
                  }
                  allocPct = Math.min(maxPositionPct, allocPct * regimeMult);

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
                  portfolioDirty = true;
                  sectorCounts.set(sec, secCount + 1);
                  totalOpen++;
                  executionsBuffer.push({
                    user_id: userId, strategy_id: strat.id, execution_type: "paper", status: "filled",
                    asset: symbol, side: "buy", quantity, price: quote.price,
                    reason: `auto_entry via ${quote.source} alloc=${allocPct.toFixed(1)}%${confidence != null ? ` conf=${confidence}` : ""}${volPct != null ? ` vol=${volPct.toFixed(2)}%` : ""} regime=${regime}${style ? ` style=${style} mult=${regimeMult.toFixed(2)}` : ""}${vixLevel != null ? ` vix=${vixLevel.toFixed(1)} vix_mult=${vixMult.toFixed(2)}` : ""}${defensiveMode ? ` defensive dd=${drawdownPct.toFixed(1)}%` : ""}`,
                  });
                  await fireWebhook(userId, "trade_open", { strategy_id: strat.id, asset: symbol, side: "buy", quantity, price: quote.price, alloc_pct: allocPct, regime, style });
                  opened++;

                } catch (e) {
                  errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: e instanceof Error ? e.message : "symbol_eval_failed" });
                }
              }
            }

            // Deferred writes: one portfolio update + one bulk executions insert per user.
            if (portfolioDirty) {
              await supabaseAdmin.from("paper_portfolios").update({
                balance: cash, equity: cash, updated_at: new Date().toISOString(),
              }).eq("id", portfolio.id);
            }
            if (executionsBuffer.length > 0) {
              await supabaseAdmin.from("signals_executions").insert(executionsBuffer);
            }

            // Auto-retire poor performers — computed from the single closed-trades pull above.
            const closedByStrat = new Map<string, { count: number; wins: number; pnl: number }>();
            for (const t of closedTradesRes.data ?? []) {
              if (!t.strategy_id) continue;
              const cur = closedByStrat.get(t.strategy_id) ?? { count: 0, wins: 0, pnl: 0 };
              const p = Number(t.pnl ?? 0);
              cur.count++;
              if (p > 0) cur.wins++;
              cur.pnl += p;
              closedByStrat.set(t.strategy_id, cur);
            }
            for (const strat of userStrats) {
              const s = closedByStrat.get(strat.id);
              if (!s || s.count < 10) continue;
              const winRate = (s.wins / s.count) * 100;
              const roi = startBal > 0 ? (s.pnl / startBal) * 100 : 0;
              if (winRate < 35 || roi < -10) {
                await supabaseAdmin.from("strategies").update({ active: false }).eq("id", strat.id);
                await supabaseAdmin.from("signals_executions").insert({
                  user_id: userId, strategy_id: strat.id, execution_type: "paper", status: "cancelled",
                  asset: "SYSTEM", side: "sell", quantity: 0, price: 0,
                  reason: `auto_retired: poor_live_performance win_rate=${winRate.toFixed(0)}% roi=${roi.toFixed(1)}% retired_name=${strat.name ?? ""}`,
                });
                await fireWebhook(userId, "strategy_retired", { strategy_id: strat.id, name: strat.name ?? "", win_rate: winRate, roi });
                retired++;
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

        return Response.json({ ok: true, evaluated, opened, closed, retired, errors, ts, market_open: marketOpen, regime });
      },
    },
  },
});

