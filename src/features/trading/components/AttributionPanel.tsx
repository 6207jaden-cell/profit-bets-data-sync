import { useQuery } from "@tanstack/react-query";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GitBranch, Brain } from "lucide-react";
import { LoadingState } from "@/components/StateViews";
import { getSignalAttribution, getClaudeAttribution } from "@/lib/attribution.functions";

export function AttributionPanel() {
  const { userId } = useProfile();

  const { data: signalAttr, isLoading: signalLoading } = useQuery({
    queryKey: ["signal-attribution", userId],
    enabled: !!userId,
    staleTime: 300_000,
    queryFn: async () => getSignalAttribution(),
  });

  const { data: claudeAttr, isLoading: claudeLoading } = useQuery({
    queryKey: ["claude-attribution", userId],
    enabled: !!userId,
    staleTime: 300_000,
    queryFn: async () => getClaudeAttribution(),
  });

  return (
    <section>
      <h2 className="font-display font-semibold text-sm mb-1 flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-primary" />
        Attribution
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Where the P&L actually came from — which signals were involved, and whether Claude's judgment is adding value over the raw deterministic ranking.
      </p>

      {/* Claude Attribution */}
      <div className="mb-4">
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Brain className="h-3 w-3" /> Claude vs. Deterministic Ranking
        </h3>
        {claudeLoading ? (
          <LoadingState message="Loading Claude attribution…" />
        ) : !claudeAttr || claudeAttr.totalResolvedSampleSize === 0 ? (
          <Card className="p-4 border-border/60 bg-card text-xs text-muted-foreground text-center">
            No resolved shadow-comparison data yet — this fills in as logged candidates age past their resolution horizon (1–4 days depending on session type).
          </Card>
        ) : (
          <>
            {!claudeAttr.hasMinimumEvidence && (
              <div className="mb-2 px-3 py-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                Only {claudeAttr.claudePicksSampleSize} Claude-side / {claudeAttr.deterministicOnlySampleSize} deterministic-side resolved rows — treat this as provisional until both reach 30.
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Card className="p-3 border-border/60 bg-card">
                <p className="text-[10px] text-muted-foreground mb-1">Claude's Actual Picks</p>
                <p className="text-base font-mono font-bold">
                  {claudeAttr.claudePicksAvgReturnPct != null ? `${claudeAttr.claudePicksAvgReturnPct >= 0 ? "+" : ""}${claudeAttr.claudePicksAvgReturnPct.toFixed(2)}%` : "—"}
                </p>
                <p className="text-[9px] text-muted-foreground mt-0.5">avg return, n={claudeAttr.claudePicksSampleSize}</p>
              </Card>
              <Card className="p-3 border-border/60 bg-card">
                <p className="text-[10px] text-muted-foreground mb-1">Deterministic-Only</p>
                <p className="text-base font-mono font-bold">
                  {claudeAttr.deterministicOnlyAvgReturnPct != null ? `${claudeAttr.deterministicOnlyAvgReturnPct >= 0 ? "+" : ""}${claudeAttr.deterministicOnlyAvgReturnPct.toFixed(2)}%` : "—"}
                </p>
                <p className="text-[9px] text-muted-foreground mt-0.5">avg return, n={claudeAttr.deterministicOnlySampleSize}</p>
              </Card>
              <Card className="p-3 border-border/60 bg-card">
                <p className="text-[10px] text-muted-foreground mb-1">Claude's Added Value</p>
                <p className={cn(
                  "text-base font-mono font-bold",
                  claudeAttr.claudeAddedValuePct != null && claudeAttr.claudeAddedValuePct > 0 ? "text-emerald-400"
                    : claudeAttr.claudeAddedValuePct != null && claudeAttr.claudeAddedValuePct < 0 ? "text-red-400" : ""
                )}>
                  {claudeAttr.claudeAddedValuePct != null ? `${claudeAttr.claudeAddedValuePct >= 0 ? "+" : ""}${claudeAttr.claudeAddedValuePct.toFixed(2)}pp` : "—"}
                </p>
                <p className="text-[9px] text-muted-foreground mt-0.5">vs. pure ranking</p>
              </Card>
            </div>
          </>
        )}
      </div>

      {/* Signal Attribution */}
      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Signal P&L Attribution</h3>
        {signalLoading ? (
          <LoadingState message="Loading signal attribution…" />
        ) : !signalAttr || signalAttr.rows.length === 0 ? (
          <Card className="p-4 border-border/60 bg-card text-xs text-muted-foreground text-center">
            No closed trades with tracked signals yet.
          </Card>
        ) : (
          <Card className="border-border/60 bg-card overflow-hidden">
            <div className="hidden sm:grid grid-cols-[1fr_90px_70px_80px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50 font-medium">
              <span>Signal</span>
              <span className="text-right">Total P&L</span>
              <span className="text-right">Trades</span>
              <span className="text-right">% of Total</span>
            </div>
            <div className="divide-y divide-border/30">
              {signalAttr.rows.slice(0, 10).map((r) => (
                <div key={r.signalName} className="grid grid-cols-2 sm:grid-cols-[1fr_90px_70px_80px] gap-1 px-4 py-2 items-center">
                  <span className="text-sm font-medium col-span-2 sm:col-span-1">{r.signalName.replace(/_/g, " ")}</span>
                  <span className={cn("text-right text-xs font-mono", r.totalPnlDollar >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {r.totalPnlDollar >= 0 ? "+" : ""}${r.totalPnlDollar.toFixed(2)}
                  </span>
                  <span className="text-right text-xs font-mono text-muted-foreground">{r.tradeCount}</span>
                  <span className="text-right text-xs font-mono text-muted-foreground">
                    {r.pctOfTotalPnl != null ? `${r.pctOfTotalPnl.toFixed(0)}%` : "—"}
                  </span>
                </div>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-border/50 text-[9px] text-muted-foreground">
              Percentages commonly sum to more than 100% — a trade with multiple signals active gives each one full credit, not a split share. This shows which signals were involved in profit/loss, not a strict partition of it.
            </div>
          </Card>
        )}
      </div>
    </section>
  );
}
