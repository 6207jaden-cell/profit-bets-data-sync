import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import { LoadingState } from "@/components/StateViews";
import {
  computeSharpeRatio, computeSortinoRatio, computeMaxDrawdown, buildRealizedEquityCurve,
  computeProfitFactor, computeExpectancy, computeWinRateWithConfidenceInterval,
  type TradeReturn,
} from "@/lib/performance-metrics";

type ClosedTrade = {
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  closed_at: string | null;
  created_at: string;
};

function pnlPct(t: ClosedTrade): number | null {
  if (!t.exit_price) return null;
  const dir = t.side === "buy" ? 1 : -1;
  const entry = Number(t.entry_price);
  if (entry <= 0) return null;
  return ((Number(t.exit_price) - entry) / entry) * 100 * dir;
}

function pnlDollar(t: ClosedTrade): number {
  if (!t.exit_price) return 0;
  const dir = t.side === "buy" ? 1 : -1;
  return (Number(t.exit_price) - Number(t.entry_price)) * Number(t.quantity) * dir;
}

/**
 * Metric card showing a value alongside its sample size — every figure on
 * this panel is shown with how much evidence backs it, per
 * ENGINEERING_CONSTITUTION.md Section 14's transparency standard: never
 * present a metric with more confidence than its sample size supports.
 */
function MetricCard({ label, value, sublabel, tone }: { label: string; value: string; sublabel: string; tone: "positive" | "negative" | "neutral" }) {
  return (
    <Card className="p-3 border-border/60 bg-card">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className={cn(
        "text-lg font-mono font-bold",
        tone === "positive" ? "text-emerald-400" : tone === "negative" ? "text-red-400" : "text-foreground"
      )}>
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</p>
    </Card>
  );
}

export function PerformanceMetricsPanel() {
  const { userId } = useProfile();

  const { data: trades, isLoading } = useQuery({
    queryKey: ["performance-metrics-trades", userId],
    enabled: !!userId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("paper_trades")
        .select("side, quantity, entry_price, exit_price, closed_at, created_at")
        .eq("user_id", userId!)
        .eq("is_open", false)
        .not("exit_price", "is", null)
        .order("closed_at", { ascending: true });
      return (data ?? []) as ClosedTrade[];
    },
  });

  const metrics = useMemo(() => {
    if (!trades || trades.length === 0) return null;

    const tradeReturns: TradeReturn[] = trades
      .map((t) => ({ pnlPct: pnlPct(t), closedAt: t.closed_at ?? t.created_at }))
      .filter((t): t is TradeReturn => t.pnlPct != null);

    if (tradeReturns.length === 0) return null;

    const pnls = trades.map(pnlDollar);
    const wins = tradeReturns.filter((t) => t.pnlPct > 0).length;

    const equityCurve = buildRealizedEquityCurve(tradeReturns);

    return {
      sampleSize: tradeReturns.length,
      sharpe: computeSharpeRatio(tradeReturns),
      sortino: computeSortinoRatio(tradeReturns),
      drawdown: computeMaxDrawdown(equityCurve),
      profitFactor: computeProfitFactor(pnls),
      expectancy: computeExpectancy(tradeReturns),
      winRate: computeWinRateWithConfidenceInterval(wins, tradeReturns.length),
    };
  }, [trades]);

  if (isLoading) return <LoadingState message="Computing performance metrics…" />;

  const MIN_SAMPLE = 20;
  const hasEnoughData = metrics != null && metrics.sampleSize >= MIN_SAMPLE;

  return (
    <section>
      <h2 className="font-display font-semibold text-sm mb-1 flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        Risk-Adjusted Performance
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        The question that matters most: is this actually better than randomly investing in the market? These metrics — not raw P&L alone — are how you check.
      </p>

      {!metrics ? (
        <Card className="p-6 border-border/60 bg-card text-center text-sm text-muted-foreground">
          No closed trades yet — these metrics fill in as trades close.
        </Card>
      ) : (
        <>
          {!hasEnoughData && (
            <div className="mb-3 px-3 py-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
              Only {metrics.sampleSize} closed trade{metrics.sampleSize !== 1 ? "s" : ""} so far — every number below is real, but with this few trades none of them should be trusted as a stable estimate yet. Treat these as provisional until at least {MIN_SAMPLE}.
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <MetricCard
              label="Sharpe Ratio"
              value={metrics.sharpe ? metrics.sharpe.raw.toFixed(2) : "—"}
              sublabel={metrics.sharpe?.annualized != null ? `${metrics.sharpe.annualized.toFixed(2)} annualized` : "per-trade"}
              tone={metrics.sharpe && metrics.sharpe.raw > 0 ? "positive" : metrics.sharpe && metrics.sharpe.raw < 0 ? "negative" : "neutral"}
            />
            <MetricCard
              label="Sortino Ratio"
              value={metrics.sortino != null ? metrics.sortino.toFixed(2) : "—"}
              sublabel="downside-only risk"
              tone={metrics.sortino != null && metrics.sortino > 0 ? "positive" : metrics.sortino != null && metrics.sortino < 0 ? "negative" : "neutral"}
            />
            <MetricCard
              label="Max Drawdown"
              value={metrics.drawdown ? `-${metrics.drawdown.maxDrawdownPct.toFixed(1)}%` : "—"}
              sublabel="realized P&L curve"
              tone={metrics.drawdown && metrics.drawdown.maxDrawdownPct > 20 ? "negative" : "neutral"}
            />
            <MetricCard
              label="Profit Factor"
              value={metrics.profitFactor != null ? metrics.profitFactor.toFixed(2) : "no losses yet"}
              sublabel="gross win / gross loss"
              tone={metrics.profitFactor != null && metrics.profitFactor > 1 ? "positive" : metrics.profitFactor != null ? "negative" : "neutral"}
            />
            <MetricCard
              label="Expectancy"
              value={metrics.expectancy ? `${metrics.expectancy.expectancyPct >= 0 ? "+" : ""}${metrics.expectancy.expectancyPct.toFixed(2)}%` : "—"}
              sublabel="mean return per trade"
              tone={metrics.expectancy && metrics.expectancy.expectancyPct > 0 ? "positive" : metrics.expectancy && metrics.expectancy.expectancyPct < 0 ? "negative" : "neutral"}
            />
            <MetricCard
              label="Win Rate"
              value={metrics.winRate ? `${(metrics.winRate.winRate * 100).toFixed(0)}%` : "—"}
              sublabel={metrics.winRate ? `95% CI: ${(metrics.winRate.ciLower * 100).toFixed(0)}–${(metrics.winRate.ciUpper * 100).toFixed(0)}%` : ""}
              tone="neutral"
            />
          </div>

          {metrics.expectancy && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Card className="p-3 border-border/60 bg-card flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Avg Win</p>
                  <p className="text-sm font-mono font-semibold text-emerald-400">+{metrics.expectancy.avgWinPct.toFixed(2)}%</p>
                </div>
              </Card>
              <Card className="p-3 border-border/60 bg-card flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-400 shrink-0" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Avg Loss</p>
                  <p className="text-sm font-mono font-semibold text-red-400">-{metrics.expectancy.avgLossPct.toFixed(2)}%</p>
                </div>
              </Card>
            </div>
          )}

          <p className="text-[9px] text-muted-foreground mt-3">
            Based on {metrics.sampleSize} closed trades with realized P&L. Max drawdown is computed from a synthetic realized-P&L curve (sequential trade compounding), not true mark-to-market equity — see performance-metrics.ts for why that's a meaningful simplification worth knowing about.
          </p>
        </>
      )}
    </section>
  );
}
