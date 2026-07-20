import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/StateViews";

type Decision = {
  id: string;
  session_type: string;
  regime: string | null;
  market_assessment: string | null;
  trades_opened: number;
  created_at: string;
  payload: {
    trades?: Array<{
      symbol: string;
      direction: string;
      conviction?: number;
      allocation_pct?: number;
      rationale?: string;
    }>;
    market_assessment?: string;
    skipped?: string;
  } | null;
};

const SESSION_COLORS: Record<string, string> = {
  morning_scan: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  midday_scan: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  scalp_scan: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  crypto_scan: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  weekend_prep: "bg-purple-500/20 text-purple-300 border-purple-500/30",
};

const SESSION_LABELS: Record<string, string> = {
  morning_scan: "Morning Swing",
  midday_scan: "Midday Swing",
  scalp_scan: "Scalp",
  crypto_scan: "Crypto 24/7",
  weekend_prep: "Weekend Prep",
};

export function AgentWatchlistPanel() {
  const { userId } = useProfile();

  const { data: decisions, isLoading } = useQuery({
    queryKey: ["agent-last-scans", userId],
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_decisions")
        .select("id, session_type, regime, market_assessment, trades_opened, created_at, payload")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(5);
      return (data ?? []) as Decision[];
    },
  });

  if (isLoading) return <LoadingState message="Loading agent activity…" />;

  if (!decisions || decisions.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground text-sm space-y-2">
        <Brain className="h-8 w-8 opacity-20 mx-auto" />
        <p>No agent scans yet.</p>
        <p className="text-xs">Go to the Agent tab → turn on Autonomous Mode → click "▶ Run scan now"</p>
      </div>
    );
  }

  const latest = decisions[0];
  const latestTrades = (latest.payload?.trades ?? []);
  const timeSince = Math.round((Date.now() - new Date(latest.created_at).getTime()) / 60_000);
  const timeStr = timeSince < 60
    ? `${timeSince}m ago`
    : timeSince < 1440
    ? `${Math.round(timeSince / 60)}h ago`
    : `${Math.round(timeSince / 1440)}d ago`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          Agent Last Scan
        </h3>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {timeStr}
          <Badge className={cn("text-[9px]", SESSION_COLORS[latest.session_type] ?? "bg-muted text-muted-foreground")}>
            {SESSION_LABELS[latest.session_type] ?? latest.session_type}
          </Badge>
        </div>
      </div>

      {/* Market assessment */}
      {latest.market_assessment && (
        <Card className="p-3 border-border/60 bg-card/60">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="text-primary font-medium">Agent view: </span>
            {latest.market_assessment}
          </p>
        </Card>
      )}

      {/* What the agent opened last scan */}
      {latestTrades.length > 0 ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-medium">
            Opened in last scan ({latestTrades.length})
          </div>
          <div className="space-y-1.5">
            {latestTrades.map((t, i) => (
              <Card key={i} className={cn(
                "px-3 py-2.5 border-border/50",
                t.direction === "long" ? "bg-emerald-950/20 border-emerald-800/30" : "bg-red-950/20 border-red-800/30"
              )}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {t.direction === "long"
                      ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      : <TrendingDown className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    }
                    <span className="font-mono font-bold text-sm">{t.symbol}</span>
                    <Badge variant="outline" className="text-[9px] border-border/50">
                      {t.direction?.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {t.conviction != null && (
                      <span className={cn("font-mono font-semibold",
                        t.conviction >= 80 ? "text-emerald-400" :
                        t.conviction >= 60 ? "text-amber-400" : "text-muted-foreground"
                      )}>
                        {t.conviction}% conviction
                      </span>
                    )}
                    {t.allocation_pct != null && (
                      <span className="font-mono">{t.allocation_pct}% alloc</span>
                    )}
                  </div>
                </div>
                {t.rationale && (
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                    {t.rationale.replace(/\[SCALP\]|\[SWING\]|\[CRYPTO\]/g, "").trim()}
                  </p>
                )}
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border/40 rounded-lg">
          {latest.payload?.skipped
            ? `⏭ Skipped: ${latest.payload.skipped}`
            : "No trades opened in this scan — agent found no high-conviction setups"}
        </div>
      )}

      {/* Recent scan history */}
      {decisions.length > 1 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-medium">
            Recent scan history
          </div>
          <div className="space-y-1">
            {decisions.slice(1).map(d => {
              const trades = d.payload?.trades ?? [];
              const t = Math.round((Date.now() - new Date(d.created_at).getTime()) / 60_000);
              const ago = t < 60 ? `${t}m` : t < 1440 ? `${Math.round(t/60)}h` : `${Math.round(t/1440)}d`;
              return (
                <div key={d.id} className="flex items-center justify-between text-[11px] px-2 py-1.5 rounded hover:bg-muted/30">
                  <span className="text-muted-foreground">{ago} ago</span>
                  <Badge className={cn("text-[9px]", SESSION_COLORS[d.session_type] ?? "bg-muted")}>
                    {SESSION_LABELS[d.session_type] ?? d.session_type}
                  </Badge>
                  <span className={cn("font-mono", d.trades_opened > 0 ? "text-emerald-400" : "text-muted-foreground")}>
                    {d.trades_opened > 0 ? `+${d.trades_opened} opened` : "no trades"}
                  </span>
                  <span className={cn("font-mono text-[10px]",
                    d.regime === "bull" ? "text-emerald-400" :
                    d.regime === "bear" ? "text-red-400" : "text-amber-400"
                  )}>
                    {d.regime ?? "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
