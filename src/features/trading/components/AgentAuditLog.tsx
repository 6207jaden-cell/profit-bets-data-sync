import { LoadingState, ErrorState } from "@/components/StateViews";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Brain, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type DecisionRow = {
  id: string;
  session_type: string;
  regime: string | null;
  market_assessment: string | null;
  trades_opened: number;
  trades_closed: number | null;
  payload: unknown;
  created_at: string;
};

type AiTrade = {
  symbol: string;
  direction: string;
  instrument: string;
  conviction: number;
  allocation_pct: number;
  rationale: string;
};

type PayloadShape = {
  trades?: AiTrade[];
  cash_deployment_pct?: number;
  message_to_user?: string;
  circuit_breaker_triggered?: boolean;
  day_pnl_pct?: number;
  skipped?: string;
  ai_error?: boolean;
};

const SESSION_LABELS: Record<string, string> = {
  morning_scan: "Morning Scan",
  midday_scan: "Midday Scan",
  exit_check: "Exit Check",
  weekly_learning: "Weekly Review",
  weekend_prep: "Weekend Prep",
  circuit_breaker: "Circuit Breaker",
  drawdown_protection: "Drawdown Protection",
};

const SESSION_COLORS: Record<string, string> = {
  morning_scan: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  midday_scan: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  exit_check: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  weekly_learning: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  weekend_prep: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  circuit_breaker: "bg-red-500/20 text-red-400 border-red-500/30",
  drawdown_protection: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

function DecisionCard({ d }: { d: DecisionRow }) {
  const [open, setOpen] = useState(false);
  const payload = (d.payload ?? {}) as PayloadShape;
  const trades = payload.trades ?? [];
  const time = new Date(d.created_at).toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  const sessionLabel = SESSION_LABELS[d.session_type] ?? d.session_type;
  const sessionColor = SESSION_COLORS[d.session_type] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30";

  const regimeIcon = d.regime === "bull"
    ? <TrendingUp className="h-3 w-3 text-emerald-400" />
    : d.regime === "bear"
    ? <TrendingDown className="h-3 w-3 text-red-400" />
    : <Minus className="h-3 w-3 text-amber-400" />;

  return (
    <Card className={cn(
      "border-border/50 overflow-hidden transition-all",
      d.trades_opened > 0 ? "bg-card" : "bg-card/50"
    )}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-accent/20 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {open
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          }
          {/* Session type badge */}
          <Badge className={cn("text-[10px] shrink-0 font-medium", sessionColor)}>{sessionLabel}</Badge>

          {/* Regime pill */}
          {d.regime && (
            <span className={cn(
              "flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0",
              d.regime === "bull" ? "bg-emerald-500/10 text-emerald-400" :
              d.regime === "bear" ? "bg-red-500/10 text-red-400" :
              "bg-amber-500/10 text-amber-400"
            )}>
              {regimeIcon} {d.regime}
            </span>
          )}

          {/* Short market assessment preview */}
          {d.market_assessment && (
            <span className="text-[11px] text-muted-foreground truncate hidden sm:block">
              {d.market_assessment.slice(0, 90)}{d.market_assessment.length > 90 ? "…" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {/* Outcome badge */}
          {payload.circuit_breaker_triggered ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">🛑 blocked</span>
          ) : payload.ai_error ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">⚠ AI error</span>
          ) : d.trades_opened > 0 ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
              +{d.trades_opened} trade{d.trades_opened !== 1 ? "s" : ""}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">no trades</span>
          )}
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">{time}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-border/30 px-4 py-3 space-y-3">
          {/* Market assessment */}
          {d.market_assessment && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Market Assessment
              </div>
              <p className="text-sm text-foreground/80">{d.market_assessment}</p>
            </div>
          )}

          {/* Cash deployment */}
          {payload.cash_deployment_pct != null && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Cash Deployed</span>
              <span className="text-xs font-mono">{payload.cash_deployment_pct}%</span>
            </div>
          )}

          {/* Trades */}
          {trades.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 font-semibold">
                Trades Opened ({trades.length})
              </div>
              <div className="space-y-2">
                {trades.map((t, i) => (
                  <div key={i} className={cn(
                    "rounded-lg border px-3 py-2.5",
                    t.direction === "long"
                      ? "bg-emerald-950/20 border-emerald-800/30"
                      : "bg-red-950/20 border-red-800/30"
                  )}>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="font-mono font-bold text-sm">{t.symbol}</span>
                      <Badge className={cn("text-[9px] border-none",
                        t.direction === "long" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                      )}>
                        {(t.direction ?? "").toUpperCase()} {t.instrument}
                      </Badge>
                      <div className="ml-auto flex items-center gap-2 text-[10px]">
                        <span className={cn("font-mono font-semibold",
                          (t.conviction ?? 0) >= 80 ? "text-emerald-400" :
                          (t.conviction ?? 0) >= 65 ? "text-amber-400" : "text-muted-foreground"
                        )}>
                          {t.conviction ?? "?"}% conviction
                        </span>
                        <span className="text-muted-foreground font-mono">
                          {t.allocation_pct}% alloc
                        </span>
                      </div>
                    </div>
                    {t.rationale && (
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {t.rationale.replace(/\[SCALP\]|\[SWING\]|\[CRYPTO\]/g, "").trim()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No trades reason */}
          {trades.length === 0 && !payload.circuit_breaker_triggered && !payload.ai_error && (
            <div className="rounded-lg border border-border/40 border-dashed px-3 py-3 text-[11px] text-muted-foreground">
              {payload.skipped
                ? `⏭ Skipped this scan: ${payload.skipped}`
                : "No high-conviction setups found — agent scanned candidates but none met entry criteria"}
            </div>
          )}

          {/* Special states */}
          {payload.circuit_breaker_triggered && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
              🛑 Circuit breaker triggered — down {Math.abs(payload.day_pnl_pct ?? 0).toFixed(1)}% today
            </div>
          )}
          {payload.skipped && (
            <div className="text-xs text-muted-foreground">
              Skipped: {payload.skipped}
            </div>
          )}
          {payload.ai_error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
              AI gateway error — no trades placed this run
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function AgentAuditLog() {
  const { userId } = useProfile();
  const [limit, setLimit] = useState(20);

  const { data: decisions, isLoading, isError, refetch } = useQuery({
    queryKey: ["agent-audit-log", userId, limit],
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_decisions")
        .select("id, session_type, regime, market_assessment, trades_opened, trades_closed, payload, created_at")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? []) as DecisionRow[];
    },
  });

  if (isLoading) {
    return <LoadingState />;
  }

  if (!decisions || decisions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
        <Brain className="h-8 w-8 opacity-30" />
        <p>No decisions logged yet.</p>
        <p className="text-xs">Turn on Autonomous Mode to start seeing the agent's decisions here.</p>
      </div>
    );
  }

  const totalOpened = decisions.reduce((s, d) => s + (d.trades_opened ?? 0), 0);
  const scans = decisions.filter((d) => ["morning_scan", "midday_scan"].includes(d.session_type));
  const scansWithTrades = scans.filter((d) => d.trades_opened > 0);

  return (
    <div className="space-y-3">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Card className="p-2 border-border/50">
          <div className="text-lg font-mono font-bold">{decisions.length}</div>
          <div className="text-[10px] text-muted-foreground">Total decisions</div>
        </Card>
        <Card className="p-2 border-border/50">
          <div className="text-lg font-mono font-bold text-emerald-400">{totalOpened}</div>
          <div className="text-[10px] text-muted-foreground">Positions opened</div>
        </Card>
        <Card className="p-2 border-border/50">
          <div className="text-lg font-mono font-bold">
            {scans.length > 0 ? Math.round(scansWithTrades.length / scans.length * 100) : 0}%
          </div>
          <div className="text-[10px] text-muted-foreground">Scans with trades</div>
        </Card>
      </div>

      {/* Decision list */}
      <div className="space-y-1.5">
        {decisions.map((d) => (
          <DecisionCard key={d.id} d={d} />
        ))}
      </div>

      {decisions.length >= limit && (
        <button
          onClick={() => setLimit((l) => l + 20)}
          className="w-full py-2 text-xs text-muted-foreground hover:text-foreground border border-border/50 rounded-md"
        >
          Load 20 more
        </button>
      )}
    </div>
  );
}
