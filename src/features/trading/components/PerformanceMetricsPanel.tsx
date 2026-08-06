import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Activity, LineChart as LineChartIcon } from "lucide-react";
import { LoadingState } from "@/components/StateViews";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell } from "recharts";
import {
  computeSharpeRatio, computeSortinoRatio, computeMaxDrawdown, buildRealizedEquityCurve,
  computeProfitFactor, computeExpectancy, computeWinRateWithConfidenceInterval,
  computeRollingMetrics, computeRollingTrend,
  computeReturnDistribution, computeHoldingTimeDistribution,
  type TradeReturn,
} from "@/lib/performance-metrics";
import { getBenchmarkComparison } from "@/lib/benchmark-comparison.functions";
import { getRegimePerformance } from "@/lib/regime-performance.functions";

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

  const { data: benchmark, isLoading: benchmarkLoading } = useQuery({
    queryKey: ["benchmark-comparison", userId],
    enabled: !!userId,
    staleTime: 3_600_000, // hourly — this doesn't change meaningfully faster than daily portfolio snapshots do
    queryFn: async () => getBenchmarkComparison(),
  });

  const { data: regimePerf, isLoading: regimeLoading } = useQuery({
    queryKey: ["regime-performance", userId],
    enabled: !!userId,
    staleTime: 3_600_000, // regime reconstruction refetches SPY history — expensive enough to cache generously
    queryFn: async () => getRegimePerformance(),
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

    const ROLLING_WINDOW = 10;
    const rollingPoints = computeRollingMetrics(tradeReturns, ROLLING_WINDOW);
    const rollingTrend = computeRollingTrend(rollingPoints);

    const returnDistribution = computeReturnDistribution(tradeReturns);
    const closedTradesWithDates = trades.filter((t) => t.closed_at != null);
    const holdingTimeDistribution = computeHoldingTimeDistribution(
      closedTradesWithDates.map((t) => ({ createdAt: t.created_at, closedAt: t.closed_at! })),
    );

    return {
      sampleSize: tradeReturns.length,
      sharpe: computeSharpeRatio(tradeReturns),
      sortino: computeSortinoRatio(tradeReturns),
      drawdown: computeMaxDrawdown(equityCurve),
      profitFactor: computeProfitFactor(pnls),
      expectancy: computeExpectancy(tradeReturns),
      winRate: computeWinRateWithConfidenceInterval(wins, tradeReturns.length),
      rollingPoints,
      rollingTrend,
      returnDistribution,
      holdingTimeDistribution,
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

          {/* Rolling metrics — shows the TREND, not just the aggregate.
              Only rendered once there are enough rolling points to actually
              show a trend rather than 1-2 isolated dots. */}
          {metrics.rollingPoints.length >= 5 && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <LineChartIcon className="h-3 w-3" /> Rolling Win Rate (10-trade window)
                </h3>
                {metrics.rollingTrend?.winRateDelta != null && (
                  <span className={cn(
                    "text-[10px] font-mono flex items-center gap-0.5",
                    metrics.rollingTrend.winRateDelta > 0 ? "text-emerald-400" : metrics.rollingTrend.winRateDelta < 0 ? "text-red-400" : "text-muted-foreground"
                  )}>
                    {metrics.rollingTrend.winRateDelta > 0 ? <TrendingUp className="h-3 w-3" /> : metrics.rollingTrend.winRateDelta < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                    {(metrics.rollingTrend.winRateDelta * 100).toFixed(1)}pp vs. prior window
                  </span>
                )}
              </div>
              <Card className="p-3 border-border/60 bg-card">
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={metrics.rollingPoints}>
                    <XAxis dataKey="index" hide />
                    <YAxis domain={[0, 1]} hide />
                    <ReferenceLine y={0.5} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.4} />
                    <Tooltip
                      formatter={(value: number) => [`${(value * 100).toFixed(0)}%`, "Win rate"]}
                      labelFormatter={(_label, payload) => payload?.[0]?.payload?.date ?? ""}
                      contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    />
                    <Line type="monotone" dataKey="rollingWinRate" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}

          {/* Real benchmark comparison — Beta/Alpha/Correlation to SPY, from
              actual daily-aligned portfolio equity vs SPY closes, not the
              synthetic trade-sequence curve the metrics above use. */}
          <div className="mt-3">
            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">vs. SPY (real daily-aligned data)</h3>
            {benchmarkLoading ? (
              <p className="text-xs text-muted-foreground">Loading benchmark comparison…</p>
            ) : !benchmark || benchmark.sampleSize < 3 ? (
              <Card className="p-3 border-border/60 bg-card text-xs text-muted-foreground">
                Not enough daily portfolio history yet to compare against SPY — this needs several days of snapshots, not just closed trades.
              </Card>
            ) : (
              <>
                {benchmark.insufficientData && (
                  <div className="mb-2 px-3 py-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                    Only {benchmark.sampleSize} days of aligned data — treat Beta/Alpha as provisional until at least 20.
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <MetricCard
                    label="Beta"
                    value={benchmark.beta != null ? benchmark.beta.toFixed(2) : "—"}
                    sublabel="market exposure"
                    tone="neutral"
                  />
                  <MetricCard
                    label="Alpha"
                    value={benchmark.alpha != null ? `${benchmark.alpha >= 0 ? "+" : ""}${benchmark.alpha.toFixed(3)}%` : "—"}
                    sublabel="excess vs. predicted"
                    tone={benchmark.alpha != null && benchmark.alpha > 0 ? "positive" : benchmark.alpha != null && benchmark.alpha < 0 ? "negative" : "neutral"}
                  />
                  <MetricCard
                    label="Correlation"
                    value={benchmark.correlationToSpy != null ? benchmark.correlationToSpy.toFixed(2) : "—"}
                    sublabel="to SPY"
                    tone="neutral"
                  />
                </div>

                {/* Rolling Beta — shows whether market exposure has been
                    drifting, not just its current aggregate value. Only
                    shown once at least 5 rolling points exist. */}
                {benchmark.rollingPoints.length >= 5 && (
                  <div className="mt-2">
                    <h4 className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Rolling Beta (20-day window)</h4>
                    <Card className="p-2 border-border/60 bg-card">
                      <ResponsiveContainer width="100%" height={80}>
                        <LineChart data={benchmark.rollingPoints}>
                          <XAxis dataKey="index" hide />
                          <YAxis hide domain={["dataMin - 0.2", "dataMax + 0.2"]} />
                          <ReferenceLine y={1} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.4} />
                          <Tooltip
                            formatter={(value: number) => [value.toFixed(2), "Beta"]}
                            contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                          />
                          <Line type="monotone" dataKey="rollingBeta" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </Card>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Trade Distribution — return histogram and holding-time
              histogram, both true partitions (percentages sum to exactly
              100%). Fixed bucket boundaries, not data-dependent bins, so
              results are comparable across different report runs. */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Return Distribution</h3>
              <Card className="p-3 border-border/60 bg-card">
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={metrics.returnDistribution} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 8 }} interval={0} angle={-35} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                    <Tooltip
                      formatter={(value: number, _name, entry) => [`${value} trade${value !== 1 ? "s" : ""} (${entry.payload.pctOfTotal}%)`, "Count"]}
                      contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {metrics.returnDistribution.map((bucket, i) => (
                        <Cell key={bucket.label} fill={i < 4 ? "hsl(0 70% 55%)" : "hsl(160 70% 45%)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
            <div>
              <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Holding Time Distribution</h3>
              {metrics.holdingTimeDistribution.length === 0 ? (
                <Card className="p-3 border-border/60 bg-card text-xs text-muted-foreground text-center h-[120px] flex items-center justify-center">
                  No closed trades with timing data yet.
                </Card>
              ) : (
                <Card className="p-3 border-border/60 bg-card">
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={metrics.holdingTimeDistribution} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 8 }} interval={0} angle={-35} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(value: number, _name, entry) => [`${value} trade${value !== 1 ? "s" : ""} (${entry.payload.pctOfTotal}%)`, "Count"]}
                        contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}
            </div>
          </div>

          {/* Regime-Conditional Performance — regime reconstructed
              retroactively from historical SPY data using the same live
              detectMarketRegime algorithm, not a separately-invented
              classification scheme. See regime-performance.functions.ts. */}
          <div className="mt-3">
            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Performance by Market Regime</h3>
            {regimeLoading ? (
              <LoadingState message="Reconstructing historical market regime…" />
            ) : !regimePerf || regimePerf.rows.length === 0 ? (
              <Card className="p-4 border-border/60 bg-card text-xs text-muted-foreground text-center">
                No closed trades with reconstructable regime data yet.
              </Card>
            ) : (
              <Card className="border-border/60 bg-card overflow-hidden">
                <div className="hidden sm:grid grid-cols-[1fr_80px_90px_70px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50 font-medium">
                  <span>Regime</span>
                  <span className="text-right">Trades</span>
                  <span className="text-right">Avg Return</span>
                  <span className="text-right">Win Rate</span>
                </div>
                <div className="divide-y divide-border/30">
                  {regimePerf.rows.map((r) => (
                    <div key={r.regime} className="grid grid-cols-2 sm:grid-cols-[1fr_80px_90px_70px] gap-1 px-4 py-2 items-center">
                      <span className="text-sm font-medium capitalize col-span-2 sm:col-span-1">{r.regime}</span>
                      <span className="text-right text-xs font-mono text-muted-foreground">{r.tradeCount}</span>
                      <span className={cn("text-right text-xs font-mono", r.avgReturnPct >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {r.avgReturnPct >= 0 ? "+" : ""}{r.avgReturnPct.toFixed(2)}%
                      </span>
                      <span className="text-right text-xs font-mono text-muted-foreground">{(r.winRate * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 border-t border-border/50 text-[9px] text-muted-foreground">
                  Regime reconstructed retroactively from historical SPY data at each trade's entry date, using the same live regime-detection algorithm the system actually runs — not a separately-invented classification.
                </div>
              </Card>
            )}
          </div>

          <p className="text-[9px] text-muted-foreground mt-3">
            Based on {metrics.sampleSize} closed trades with realized P&L. Max drawdown is computed from a synthetic realized-P&L curve (sequential trade compounding), not true mark-to-market equity — see performance-metrics.ts for why that's a meaningful simplification worth knowing about.
          </p>
        </>
      )}
    </section>
  );
}
