import { createFileRoute } from "@tanstack/react-router";
import { fetchDailyCloses, buildContext, evalGroup } from "@/lib/indicators";

/**
 * Autonomous paper-trading evaluator. Called by pg_cron every 5 minutes via
 * the project's anon key in the `apikey` header (same pattern as
 * evaluate-alerts). Iterates every active paper strategy, evaluates exit
 * conditions on open positions first, then entry conditions on flat symbols.
 */

type Quote = { price: number; source: string };

async function fetchLiveQuote(symbol: string): Promise<Quote | null> {
  const S = symbol.toUpperCase();
  const poly = process.env.POLYGON_API_KEY;
  const fin = process.env.FINNHUB_API_KEY;
  const alpha = process.env.ALPHA_VANTAGE_API_KEY;
  try {
    if (poly) {
      const r = await fetch(`https://api.polygon.io/v2/aggs/ticker/${S}/prev?apiKey=${poly}`);
      if (r.ok) {
        const j = (await r.json()) as { results?: Array<{ c: number }> };
        const c = j.results?.[0]?.c;
        if (c) return { price: c, source: "polygon" };
      }
    }
  } catch { /* fall */ }
  try {
    if (fin) {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${S}&token=${fin}`);
      if (r.ok) {
        const j = (await r.json()) as { c?: number };
        if (j.c) return { price: j.c, source: "finnhub" };
      }
    }
  } catch { /* fall */ }
  try {
    if (alpha) {
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

type StrategyRow = {
  id: string;
  user_id: string;
  strategy_json: {
    entry?: { conditions?: string[]; logic?: "AND" | "OR" };
    exit?: { conditions?: string[]; logic?: "AND" | "OR" };
    universe?: string[];
  };
};

export const Route = createFileRoute("/api/public/evaluate-strategies")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        if (!anon || apikey !== anon) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const ts = new Date().toISOString();

        const { data: strategies, error: sErr } = await supabaseAdmin
          .from("strategies")
          .select("id, user_id, strategy_json")
          .eq("execution_mode", "paper")
          .eq("active", true);
        if (sErr) return Response.json({ ok: false, error: sErr.message }, { status: 500 });
        if (!strategies || strategies.length === 0) {
          return Response.json({ ok: true, evaluated: 0, opened: 0, closed: 0, errors: [], ts });
        }

        // Group by user for shared risk/portfolio state.
        const byUser = new Map<string, StrategyRow[]>();
        for (const s of strategies as StrategyRow[]) {
          const arr = byUser.get(s.user_id) ?? [];
          arr.push(s);
          byUser.set(s.user_id, arr);
        }

        let evaluated = 0;
        let opened = 0;
        let closed = 0;
        const errors: Array<{ user_id?: string; strategy_id?: string; symbol?: string; reason: string }> = [];

        // Cache live data across strategies within a single run.
        const closesCache = new Map<string, number[] | null>();
        const quoteCache = new Map<string, Quote | null>();
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

        for (const [userId, userStrats] of byUser) {
          try {
            const { data: portfolio } = await supabaseAdmin
              .from("paper_portfolios").select("*").eq("user_id", userId).maybeSingle();
            if (!portfolio) {
              errors.push({ user_id: userId, reason: "no_portfolio" });
              continue;
            }
            const { data: limits } = await supabaseAdmin
              .from("risk_limits").select("*").eq("user_id", userId).maybeSingle();
            const maxDailyLossPct = Number(limits?.max_daily_loss_pct ?? 5);
            const maxPositionPct = Number(limits?.max_position_pct ?? 10);
            const cooldown = Number(limits?.cooldown_seconds ?? 30);

            // Daily loss cap
            const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
            const { data: todayTrades } = await supabaseAdmin
              .from("paper_trades").select("pnl")
              .eq("user_id", userId).eq("is_open", false)
              .gte("closed_at", dayStart.toISOString());
            const dayPnl = (todayTrades ?? []).reduce((a, t) => a + Number(t.pnl ?? 0), 0);
            const startBal = Number(portfolio.starting_balance);
            const dailyLossHit = startBal > 0 && (-dayPnl / startBal) * 100 >= maxDailyLossPct;

            // Cooldown gate
            const { data: lastExec } = await supabaseAdmin
              .from("signals_executions").select("created_at")
              .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
            const cooldownRemaining = lastExec
              ? Math.max(0, cooldown - (Date.now() - new Date(lastExec.created_at).getTime()) / 1000)
              : 0;

            // Mutable cash so multiple opens in one run stay honest.
            let cash = Number(portfolio.balance);

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
                  const closes = await getCloses(symbol);
                  const quote = await getQuote(symbol);
                  if (!closes || !quote) {
                    errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: "market_data_unavailable" });
                    continue;
                  }
                  const liveCloses = [...closes, quote.price];

                  // --- Exits on any open positions for this strategy+symbol ---
                  const { data: openTrades } = await supabaseAdmin
                    .from("paper_trades").select("*")
                    .eq("user_id", userId).eq("strategy_id", strat.id)
                    .eq("asset", symbol).eq("is_open", true);

                  for (const trade of openTrades ?? []) {
                    const exitCtx = buildContext(liveCloses, Number(trade.entry_price));
                    if (!exitCtx) continue;
                    if (exitConds.length === 0) continue;
                    if (!evalGroup(exitConds, exitLogic, exitCtx)) continue;

                    const qty = Number(trade.quantity);
                    const entry = Number(trade.entry_price);
                    const proceeds = qty * quote.price;
                    const cost = qty * entry;
                    const pnl = trade.side === "buy" ? proceeds - cost : cost - proceeds;

                    await supabaseAdmin.from("paper_trades").update({
                      is_open: false,
                      exit_price: quote.price,
                      pnl,
                      closed_at: new Date().toISOString(),
                    }).eq("id", trade.id);

                    cash += proceeds;
                    await supabaseAdmin.from("paper_portfolios").update({
                      balance: cash, equity: cash, updated_at: new Date().toISOString(),
                    }).eq("id", portfolio.id);

                    await supabaseAdmin.from("signals_executions").insert({
                      user_id: userId,
                      strategy_id: strat.id,
                      execution_type: "paper",
                      status: "filled",
                      asset: symbol,
                      side: trade.side === "buy" ? "sell" : "buy",
                      quantity: qty,
                      price: quote.price,
                      reason: `auto_exit pnl=${pnl.toFixed(2)} via ${quote.source}`,
                    });
                    closed++;
                  }

                  // --- Entries: only if flat on this strategy+symbol ---
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

                  const allocPct = Math.min(maxPositionPct, 10);
                  const allocCash = (cash * allocPct) / 100;
                  if (allocCash <= 0) {
                    errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: "insufficient_cash" });
                    continue;
                  }
                  const quantity = allocCash / quote.price;

                  const { data: newTrade, error: tErr } = await supabaseAdmin
                    .from("paper_trades").insert({
                      user_id: userId,
                      portfolio_id: portfolio.id,
                      strategy_id: strat.id,
                      asset: symbol,
                      side: "buy",
                      quantity,
                      entry_price: quote.price,
                      is_open: true,
                    }).select().single();
                  if (tErr || !newTrade) {
                    errors.push({ user_id: userId, strategy_id: strat.id, symbol, reason: tErr?.message ?? "insert_failed" });
                    continue;
                  }

                  cash -= allocCash;
                  await supabaseAdmin.from("paper_portfolios").update({
                    balance: cash, equity: cash, updated_at: new Date().toISOString(),
                  }).eq("id", portfolio.id);

                  await supabaseAdmin.from("signals_executions").insert({
                    user_id: userId,
                    strategy_id: strat.id,
                    execution_type: "paper",
                    status: "filled",
                    asset: symbol,
                    side: "buy",
                    quantity,
                    price: quote.price,
                    reason: `auto_entry via ${quote.source}`,
                  });
                  opened++;
                } catch (e) {
                  errors.push({
                    user_id: userId,
                    strategy_id: strat.id,
                    symbol,
                    reason: e instanceof Error ? e.message : "symbol_eval_failed",
                  });
                }
              }
            }
          } catch (e) {
            errors.push({ user_id: userId, reason: e instanceof Error ? e.message : "user_eval_failed" });
          }
        }

        return Response.json({ ok: true, evaluated, opened, closed, errors, ts });
      },
    },
  },
});
