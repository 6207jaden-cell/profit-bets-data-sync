/**
 * Agent backtest endpoint.
 * Simulates the autonomous agent's core rule (momentum + regime alignment)
 * against N days of historical bars across the standard universe, holding
 * each pick for `hold_days` bars. Persists result to `agent_backtest_results`.
 *
 * Public route: verifies caller by anon apikey header + explicit user_id in body.
 */
import { createFileRoute } from "@tanstack/react-router";
import { fetchBars, sma } from "@/lib/indicators";

const UNIVERSE = [
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","JPM","V","XOM",
  "WMT","JNJ","HD","BAC","PG","DIS","NFLX","AMD","CRM","UBER",
  "SPY","QQQ","IWM","GLD","XLF","XLK","XLE",
  "BTC-USD","ETH-USD","SOL-USD",
];

type SymBars = { symbol: string; times: number[]; closes: number[] };

async function loadAll(days: number): Promise<SymBars[]> {
  const target = Math.max(days + 60, 120); // headroom for SMA lookback
  const out: SymBars[] = [];
  const batch = 8;
  for (let i = 0; i < UNIVERSE.length; i += batch) {
    const slice = UNIVERSE.slice(i, i + batch);
    const bars = await Promise.all(slice.map(async (s) => {
      const b = await fetchBars(s, target);
      if (!b || b.closes.length < 60) return null;
      return { symbol: s, times: b.times, closes: b.closes };
    }));
    for (const b of bars) if (b) out.push(b);
  }
  return out;
}

export const Route = createFileRoute("/api/public/agent-backtest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        const apikey = request.headers.get("apikey");
        if (!anonKey || apikey !== anonKey) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body = (await request.json().catch(() => ({}))) as {
          user_id?: string; days_back?: number; hold_days?: number; picks_per_day?: number;
        };
        const userId = String(body.user_id ?? "");
        if (!userId) return Response.json({ ok: false, error: "user_id_required" }, { status: 400 });
        const daysBack = Math.min(Math.max(Number(body.days_back ?? 30), 7), 180);
        const holdDays = Math.min(Math.max(Number(body.hold_days ?? 3), 1), 20);
        const picks = Math.min(Math.max(Number(body.picks_per_day ?? 3), 1), 8);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

        for (let day = startIdx; day < minLen - holdDays; day++) {
          // Score = momentum vs sma50 for each symbol at 'day'
          const scored: Array<{ u: SymBars; mom: number }> = [];
          for (const u of universe) {
            const closesSlice = u.closes.slice(0, day + 1);
            const smaArr = sma(closesSlice, 50);
            const s50 = smaArr[smaArr.length - 1];
            if (!s50) continue;
            const price = u.closes[day];
            scored.push({ u, mom: (price - s50) / s50 });
          }
          scored.sort((a, b) => b.mom - a.mom);
          const chosen = scored.slice(0, picks);
          if (chosen.length === 0) continue;
          // Equal weight, hold holdDays, PnL on close-to-close
          let dayPnlPct = 0;
          for (const c of chosen) {
            const entry = c.u.closes[day];
            const exit = c.u.closes[day + holdDays];
            const r = (exit - entry) / entry;
            dayPnlPct += r / chosen.length;
            trades.push({
              day: day - startIdx,
              symbol: c.u.symbol,
              entry: Number(entry.toFixed(4)),
              exit: Number(exit.toFixed(4)),
              pnl_pct: Number((r * 100).toFixed(2)),
            });
          }
          returns.push(dayPnlPct);
          equity = equity * (1 + dayPnlPct);
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
