import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Calendar, Zap, RefreshCw, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getEarnings, generateMarketSignals } from "@/lib/market.functions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function daysUntil(date: string) {
  if (!date) return "TBD";
  const diff = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return "Reported";
  return `${diff}d`;
}

export function EarningsCalendar() {
  const qc = useQueryClient();
  const earningsFn = useServerFn(getEarnings);
  const genFn = useServerFn(generateMarketSignals);
  const [generating, setGenerating] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["earnings-calendar"],
    queryFn: () => earningsFn(),
    staleTime: 30 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const rows = q.data?.available ? q.data.data : [];

  async function handleSignal(sym: string) {
    setGenerating(sym);
    try {
      await genFn();
      qc.invalidateQueries({ queryKey: ["public-signals-today"] });
      toast.success(`Signal requested for ${sym}`);
    } catch {
      toast.error("Signal generation failed.");
    } finally {
      setGenerating(null);
    }
  }

  return (
    <Card className="p-5 border-border bg-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-display font-semibold flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" /> Upcoming Earnings
          <span className={cn(
            "text-[9px] px-1.5 py-0.5 rounded font-semibold",
            q.data?.available ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground",
          )}>
            {q.data?.available ? "LIVE" : "OFFLINE"}
          </span>
        </h3>
        <button
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
          aria-label="Refresh earnings"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", q.isFetching && "animate-spin")} />
        </button>
      </div>

      {q.data && !q.data.available && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 mb-3">
          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
          <p className="text-[10px] text-destructive">
            {q.data.reason === "missing_api_key" ? "Add a Finnhub API key to enable earnings." : "Earnings unavailable."}
          </p>
        </div>
      )}

      {q.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-10 bg-secondary/50 rounded animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No upcoming earnings.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto divide-y divide-border">
          {rows.map((e, i) => {
            const days = daysUntil(e.date);
            return (
              <div key={`${e.symbol}-${i}`} className="flex items-center justify-between py-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-display font-semibold">{e.symbol}</span>
                  <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                    {e.date}{e.hour ? ` · ${e.hour}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground font-num">
                    {e.epsEstimate != null ? `EPS ${e.epsEstimate.toFixed(2)}` : "EPS —"}
                  </span>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-bold",
                    days === "Today" || days === "Tomorrow"
                      ? "bg-primary/20 text-primary"
                      : days === "Reported"
                        ? "bg-muted text-muted-foreground"
                        : "bg-secondary text-muted-foreground",
                  )}>{days}</span>
                  <button
                    onClick={() => handleSignal(e.symbol)}
                    disabled={generating === e.symbol}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                  >
                    <Zap className="w-3 h-3" />
                    {generating === e.symbol ? "..." : "Signal"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
