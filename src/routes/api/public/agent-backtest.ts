/**
 * Agent backtest endpoint.
 * Simulates a momentum-vs-SMA50 ranking rule (NOT the live system's full
 * decision logic — no Claude review, no regime detection, no correlation/
 * breadth/Kelly sizing, equal-weight only) against N days of historical
 * bars across a fixed 30-symbol universe, holding each pick for
 * `hold_days` bars. Persists result to `agent_backtest_results`.
 *
 * KNOWN METHODOLOGY LIMITATIONS — see TRADING_ENGINE_REVIEW.md Findings
 * 11-13 for full detail. Do not treat this endpoint's output as a
 * credible estimate of the live system's actual edge without reading
 * those findings first:
 *   (11) FIXED 2026-08-06 — previously scored and entered at the
 *        identical close price, assuming impossible zero-latency
 *        execution. Now enters at the NEXT bar's open via
 *        simulateBacktestDay() (src/lib/backtest-simulation.ts), a pure,
 *        independently tested function — see backtest-simulation.test.ts.
 *   (12) This comment previously (incorrectly) claimed regime alignment
 *        was simulated. It never was — corrected here.
 *   (13) No slippage or fee modeling, despite this project having both
 *        built and applied to every real paper trade elsewhere
 *        (src/lib/slippage.ts, src/lib/cost-reality.ts). Still open.
 *
 * Public route: verifies caller by apikey header (verifyPublicApiKeyFromEnv)
 * + explicit user_id in body.
 */
import { createFileRoute } from "@tanstack/react-router";
import { fetchBars } from "@/lib/indicators";
import { enforceRateLimit, endpointBucketKey, resolveRateLimit } from "@/lib/rate-limit";
import { verifyPublicApiKeyFromEnv, unauthorizedResponse } from "@/lib/api-auth";
import { simulateBacktestDay, lastValidSimulationDay, type SymBars } from "@/lib/backtest-simulation";

const UNIVERSE = [
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","JPM","V","XOM",
  "WMT","JNJ","HD","BAC","PG","DIS","NFLX","AMD","CRM","UBER",
  "SPY","QQQ","IWM","GLD","XLF","XLK","XLE",
  "BTC-USD","ETH-USD","SOL-USD",
];

async function loadAll(days: number): Promise<SymBars[]> {
  const target = Math.max(days + 60, 120); // headroom for SMA lookback
  const out: SymBars[] = [];
  const batch = 8;
  for (let i = 0; i < UNIVERSE.length; i += batch) {
    const slice = UNIVERSE.slice(i, i + batch);
    const bars = await Promise.all(slice.map(async (s) => {
      const b = await fetchBars(s, target);
      if (!b || b.closes.length < 60) return null;
      return { symbol: s, times: b.times, opens: b.opens, closes: b.closes };
    }));
    for (const b of bars) if (b) out.push(b);
  }
  return out;
}

export const Route = createFileRoute("/api/public/agent-backtest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifyPublicApiKeyFromEnv(request)) return unauthorizedResponse();
        const body = (await request.json().catch(() => ({}))) as {
          user_id?: string; days_back?: number; hold_days?: number; picks_per_day?: number;
        };
        const userId = String(body.user_id ?? "");
        if (!userId) return Response.json({ ok: false, error: "user_id_required" }, { status: 400 });
        const daysBack = Math.min(Math.max(Number(body.days_back ?? 30), 7), 180);
        const holdDays = Math.min(Math.max(Number(body.hold_days ?? 3), 1), 20);
        const picks = Math.min(Math.max(Number(body.picks_per_day ?? 3), 1), 8);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Backtests are computationally expensive (simulates up to 180 days
        // across the universe) and user-triggered, not cron-driven — a
        // per-user bucket (not global, not IP) is the right granularity so
        // one user running a backtest doesn't exhaust another user's quota.
        const rl = resolveRateLimit(5, 60);
        const rateLimited = await enforceRateLimit(supabaseAdmin, {
          key: `${endpointBucketKey("agent-backtest")}:user:${userId}`, maxRequests: rl.maxRequests, windowSeconds: rl.windowSeconds,
        });
        if (rateLimited) return rateLimited;

        const universe = await loadAll(daysBack);
        if (universe.length < 5) {
          return Response.json({ ok: false, error: "insufficient_data" }, { status: 502 });
        }

        // Align on the shortest series
        const minLen = Math.min(...universe.map((u) => u.closes.length));
        const startIdx = Math.max(50, minLen - daysBack);
        const returns: number[] = [];
        const trades: Array<{ day: number; symbol: string; entry: number; exit: number; pnl_pct: number }> = [];
        let equity = 10000;
        const dailyEquity: Array<{ day: number; equity: number }> = [];

        const lastDay = lastValidSimulationDay(minLen, holdDays);
        for (let day = startIdx; day <= lastDay; day++) {
          const result = simulateBacktestDay(universe, day, picks, holdDays);
          if (!result) continue;
          for (const t of result.trades) trades.push({ ...t, day: t.day - startIdx });
          returns.push(result.dayPnlPct);
          equity = equity * (1 + result.dayPnlPct);
          dailyEquity.push({ day: day - startIdx, equity: Number(equity.toFixed(2)) });
        }

        const totalReturnPct = ((equity - 10000) / 10000) * 100;
        const wins = trades.filter((t) => t.pnl_pct > 0).length;
        const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
        const avgPnl = trades.length > 0 ? trades.reduce((s, t) => s + t.pnl_pct, 0) / trades.length : 0;
        const mean = returns.reduce((a, b) => a + b, 0) / Math.max(returns.length, 1);
        const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(returns.length, 1);
        const std = Math.sqrt(variance);
        const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

        const summary = {
          total_return_pct: Number(totalReturnPct.toFixed(2)),
          win_rate: Number(winRate.toFixed(2)),
          avg_pnl_pct: Number(avgPnl.toFixed(3)),
          sharpe: Number(sharpe.toFixed(3)),
          trade_count: trades.length,
          days_back: daysBack,
          hold_days: holdDays,
          picks_per_day: picks,
        };

        await supabaseAdmin.from("agent_backtest_results").insert({
          user_id: userId,
          days_back: daysBack,
          total_return_pct: summary.total_return_pct,
          win_rate: summary.win_rate,
          avg_pnl_pct: summary.avg_pnl_pct,
          sharpe: summary.sharpe,
          trade_count: summary.trade_count,
          details: {
            hold_days: holdDays,
            picks_per_day: picks,
            equity_curve: dailyEquity,
            trades: trades.slice(-100),
          } as never,
        });

        return Response.json({ ok: true, summary, equity_curve: dailyEquity });
      },
    },
  },
});
