import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Brain, TrendingUp, TrendingDown } from "lucide-react";
import { LoadingState } from "@/components/StateViews";

type SignalWeightRow = {
  signal_name: string;
  alpha: number;
  beta: number;
  sample_size: number;
  avg_pnl_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  weight_multiplier: number;
};

const SIGNAL_LABELS: Record<string, string> = {
  momentum: "Momentum vs SMA50",
  return_5d: "5-Day Return",
  return_20d: "20-Day Return",
  rs_vs_spy: "Relative Strength vs SPY",
  rs_strong_outperform: "Strong Outperformance",
  rs_strong_underperform: "Strong Underperformance",
  regime_aligned: "Regime Alignment",
  rsi_oversold: "RSI Oversold (<30)",
  rsi_overbought: "RSI Overbought (>70)",
  volume_surge: "Volume Surge",
  volume_surge_strong: "Strong Volume Surge (>50%)",
  liquidity: "Liquidity Bonus",
  macd_bullish: "MACD Bullish",
  macd_bearish: "MACD Bearish",
  bb_lower_band: "Bollinger Lower Band",
  bb_upper_band: "Bollinger Upper Band",
  stoch_oversold: "Stochastic Oversold",
  stoch_overbought: "Stochastic Overbought",
};

function friendlyName(signalName: string): string {
  return SIGNAL_LABELS[signalName] ?? signalName.replace(/_/g, " ");
}

export function SignalWeightsPanel() {
  const { userId } = useProfile();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["signal-weights", userId],
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      // agent_signal_weights is ahead of the auto-generated Database type
      // (migration applied, codegen not re-run) — cast needed.
      const { data } = await (supabase as any)
        .from("agent_signal_weights")
        .select("signal_name, alpha, beta, sample_size, avg_pnl_pct, avg_win_pct, avg_loss_pct, weight_multiplier")
        .eq("user_id", userId!)
        .order("sample_size", { ascending: false });
      return (data ?? []) as SignalWeightRow[];
    },
  });

  if (isLoading) return <LoadingState message="Loading learned signal performance…" />;

  const trackedRows = (rows ?? []).filter((r) => r.sample_size > 0);

  return (
    <section>
      <h2 className="font-display font-semibold text-sm mb-1 flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        What the Agent Has Learned
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Every signal the agent uses gets its own real win rate, tracked from this account's actual closed trades. New signals start neutral and only earn more (or less) influence as evidence builds — nothing here is a generic assumption.
      </p>

      {trackedRows.length === 0 ? (
        <Card className="p-6 border-border/60 bg-card text-center text-sm text-muted-foreground">
          No signal history yet — this fills in as trades close. Each closed trade immediately updates the win rate for every signal that was active when it opened.
        </Card>
      ) : (
        <Card className="border-border/60 bg-card overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_70px_70px_80px_80px_70px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50 font-medium">
            <span>Signal</span>
            <span className="text-right">Trades</span>
            <span className="text-right">Win Rate</span>
            <span className="text-right">Avg Win</span>
            <span className="text-right">Avg Loss</span>
            <span className="text-right">Weight</span>
          </div>
          <div className="divide-y divide-border/30">
            {trackedRows.map((r) => {
              const winRate = r.alpha / (r.alpha + r.beta);
              const winRatePct = Math.round(winRate * 100);
              const isProven = r.sample_size >= 15;
              const isPositiveEdge = r.weight_multiplier > 1.0;

              return (
                <div key={r.signal_name} className="grid grid-cols-2 sm:grid-cols-[1fr_70px_70px_80px_80px_70px] gap-1 sm:gap-2 px-4 py-2.5 items-center">
                  <div className="col-span-2 sm:col-span-1 flex items-center gap-1.5">
                    <span className="text-sm font-medium">{friendlyName(r.signal_name)}</span>
                    {!isProven && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                        building history
                      </span>
                    )}
                  </div>

                  <div className="text-right text-xs font-mono text-muted-foreground">
                    <span className="sm:hidden text-[9px] text-muted-foreground/60 mr-1">Trades</span>
                    {r.sample_size}
                  </div>

                  <div className={cn("text-right text-xs font-mono font-semibold flex items-center justify-end gap-1",
                    winRatePct >= 55 ? "text-emerald-400" : winRatePct <= 45 ? "text-red-400" : "text-muted-foreground"
                  )}>
                    {isProven && (winRatePct >= 55 ? <TrendingUp className="h-3 w-3" /> : winRatePct <= 45 ? <TrendingDown className="h-3 w-3" /> : null)}
                    <span className="sm:hidden text-[9px] text-muted-foreground/60 mr-1 font-normal">Win rate</span>
                    {winRatePct}%
                  </div>

                  <div className="text-right text-xs font-mono text-emerald-400">
                    <span className="sm:hidden text-[9px] text-muted-foreground/60 mr-1 font-normal">Avg win</span>
                    {r.avg_win_pct > 0 ? `+${r.avg_win_pct.toFixed(1)}%` : "—"}
                  </div>

                  <div className="text-right text-xs font-mono text-red-400">
                    <span className="sm:hidden text-[9px] text-muted-foreground/60 mr-1 font-normal">Avg loss</span>
                    {r.avg_loss_pct > 0 ? `-${r.avg_loss_pct.toFixed(1)}%` : "—"}
                  </div>

                  <div className="text-right">
                    <span className="sm:hidden text-[9px] text-muted-foreground/60 mr-1 font-normal">Weight</span>
                    <span className={cn(
                      "text-xs font-mono font-semibold px-1.5 py-0.5 rounded",
                      isPositiveEdge ? "bg-emerald-500/10 text-emerald-400" : r.weight_multiplier < 1.0 ? "bg-red-500/10 text-red-400" : "text-muted-foreground"
                    )}>
                      {r.weight_multiplier.toFixed(2)}x
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-4 py-2 border-t border-border/50 text-[10px] text-muted-foreground">
            Signals need 15+ closed trades before they influence position sizing (Kelly Criterion) — below that, "building history" signals are tracked but don't yet affect trade decisions.
          </div>
        </Card>
      )}
    </section>
  );
}
