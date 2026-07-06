import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Play, Pause, Trophy, Sparkles, User } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { runBacktest } from "@/lib/backtest.functions";

type SortMode = "backtest_roi" | "live_pnl";

type StrategyRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  execution_mode: string;
  risk_level: string;
  active: boolean;
  source: string;
};

type PerfRow = {
  strategy_id: string;
  roi: number | null;
  win_rate: number | null;
  sharpe: number | null;
  updated_at: string;
};

type TradeRow = { strategy_id: string | null; pnl: number | null };

type LeaderRow = {
  strategy: StrategyRow;
  backtestRoi: number | null;
  backtestWinRate: number | null;
  backtestSharpe: number | null;
  livePnl: number;
  liveWinRate: number | null;
  liveTradeCount: number;
  isYours: boolean;
};

export function LeaderboardPanel({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [sortMode, setSortMode] = useState<SortMode>("backtest_roi");

  const data = useQuery({
    queryKey: ["leaderboard"],
    queryFn: async (): Promise<LeaderRow[]> => {
      const [{ data: strategies, error: sErr }, { data: perf, error: pErr }, { data: trades, error: tErr }] =
        await Promise.all([
          supabase.from("strategies")
            .select("id, user_id, name, description, execution_mode, risk_level, active, source"),
          supabase.from("strategy_performance")
            .select("strategy_id, roi, win_rate, sharpe, updated_at")
            .order("updated_at", { ascending: false }),
          supabase.from("paper_trades")
            .select("strategy_id, pnl").eq("is_open", false),
        ]);
      if (sErr) throw sErr;
      if (pErr) throw pErr;
      if (tErr) throw tErr;

      // Latest perf row per strategy
      const perfMap = new Map<string, PerfRow>();
      for (const p of (perf ?? []) as PerfRow[]) {
        if (!perfMap.has(p.strategy_id)) perfMap.set(p.strategy_id, p);
      }
      // Aggregate closed trades per strategy
      const tradeAgg = new Map<string, { pnl: number; wins: number; count: number }>();
      for (const t of (trades ?? []) as TradeRow[]) {
        if (!t.strategy_id) continue;
        const cur = tradeAgg.get(t.strategy_id) ?? { pnl: 0, wins: 0, count: 0 };
        const pnl = Number(t.pnl ?? 0);
        cur.pnl += pnl;
        if (pnl > 0) cur.wins++;
        cur.count++;
        tradeAgg.set(t.strategy_id, cur);
      }

      return ((strategies ?? []) as StrategyRow[]).map((s) => {
        const p = perfMap.get(s.id);
        const a = tradeAgg.get(s.id);
        return {
          strategy: s,
          backtestRoi: p?.roi != null ? Number(p.roi) : null,
          backtestWinRate: p?.win_rate != null ? Number(p.win_rate) : null,
          backtestSharpe: p?.sharpe != null ? Number(p.sharpe) : null,
          livePnl: a?.pnl ?? 0,
          liveWinRate: a && a.count > 0 ? (a.wins / a.count) * 100 : null,
          liveTradeCount: a?.count ?? 0,
          isYours: s.user_id === userId,
        };
      });
    },
  });

  const sorted = useMemo(() => {
    const rows = [...(data.data ?? [])];
    if (sortMode === "backtest_roi") {
      rows.sort((a, b) => (b.backtestRoi ?? -Infinity) - (a.backtestRoi ?? -Infinity));
    } else {
      rows.sort((a, b) => b.livePnl - a.livePnl);
    }
    return rows;
  }, [data.data, sortMode]);

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("strategies").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
      toast.success("Strategy updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const backtestNow = useMutation({
    mutationFn: async (id: string) => {
      const res = await runBacktest({ data: { strategy_id: id, days: 365 } });
      if (!res.ok) throw new Error(res.reason);
      return res;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
      if (res.ok) toast.success(`Backtest complete — ROI ${res.roi}%`);
    },
    onError: (e: Error) => toast.error(`Backtest failed: ${e.message}`),
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display font-semibold flex items-center gap-2">
            <Trophy className="h-4 w-4 shrink-0 text-primary" /> Strategy Leaderboard
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ranked across your strategies and the AI Lab. Live P&amp;L reflects closed paper trades only.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5 bg-card text-xs font-mono">
          <button
            onClick={() => setSortMode("backtest_roi")}
            className={cn(
              "px-2.5 py-1 rounded-sm transition-colors",
              sortMode === "backtest_roi" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Backtest ROI
          </button>
          <button
            onClick={() => setSortMode("live_pnl")}
            className={cn(
              "px-2.5 py-1 rounded-sm transition-colors",
              sortMode === "live_pnl" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Live P&amp;L
          </button>
        </div>
      </header>

      <Card className="border-border bg-card overflow-hidden">
        {data.isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading leaderboard…</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No strategies yet — create one in the Strategies tab or let the AI Lab generate some.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((row, idx) => (
              <li key={row.strategy.id} className="px-4 py-3 flex flex-col gap-3 md:grid md:grid-cols-12 md:items-center md:gap-3 text-sm">
                <div className="flex items-start gap-3 md:contents">
                  <div className="md:col-span-1 font-mono font-semibold text-muted-foreground shrink-0">
                    #{idx + 1}
                  </div>
                  <div className="md:col-span-4 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display font-semibold truncate">{row.strategy.name}</span>
                      {row.strategy.source === "ai_lab" ? (
                        <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/30 text-[10px] font-mono">
                          <Sparkles className="h-2.5 w-2.5 mr-1" />AI Lab
                        </Badge>
                      ) : (
                        <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px] font-mono">
                          <User className="h-2.5 w-2.5 mr-1" />{row.isYours ? "Yours" : "User"}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] font-mono border-border">
                        {row.strategy.execution_mode}
                      </Badge>
                      <Badge variant="outline" className={cn(
                        "text-[10px] font-mono",
                        row.strategy.risk_level === "high" && "border-bear/40 text-bear",
                        row.strategy.risk_level === "medium" && "border-amber-500/40 text-amber-500",
                        row.strategy.risk_level === "low" && "border-bull/40 text-bull",
                      )}>
                        {row.strategy.risk_level}
                      </Badge>
                    </div>
                    {row.strategy.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{row.strategy.description}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 md:contents">
                  <Metric label="BT ROI" value={row.backtestRoi} suffix="%" />
                  <Metric label="BT Win" value={row.backtestWinRate} suffix="%" neutral />
                  <Metric label="Sharpe" value={row.backtestSharpe} digits={2} />
                  <Metric label="Live P&L" value={row.livePnl === 0 ? null : row.livePnl} prefix="$" digits={2} />
                </div>

                <div className="flex items-center justify-between md:contents">
                  <div className="md:col-span-1 md:text-right">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Live</div>
                    <div className="font-mono text-sm">
                      {row.liveTradeCount === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span>{row.liveWinRate?.toFixed(0)}% · {row.liveTradeCount}</span>
                      )}
                    </div>
                  </div>

                  <div className="md:col-span-1 flex items-center md:justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      disabled={backtestNow.isPending}
                      onClick={() => backtestNow.mutate(row.strategy.id)}
                      title="Run backtest now"
                    >
                      <FlaskConical className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      disabled={toggleActive.isPending}
                      onClick={() => toggleActive.mutate({ id: row.strategy.id, active: !row.strategy.active })}
                      title={row.strategy.active ? "Pause strategy" : "Activate strategy"}
                    >
                      {row.strategy.active
                        ? <Pause className="h-3.5 w-3.5 text-bull" />
                        : <Play className="h-3.5 w-3.5 text-muted-foreground" />}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Metric({
  label, value, prefix = "", suffix = "", digits = 2, neutral = false,
}: { label: string; value: number | null; prefix?: string; suffix?: string; digits?: number; neutral?: boolean }) {
  const isNull = value == null;
  const tone = isNull || neutral || value === 0
    ? "text-muted-foreground"
    : value! > 0 ? "text-bull" : "text-bear";
  return (
    <div className="text-left md:col-span-1 md:text-right min-w-0">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</div>
      <div className={cn("font-mono text-sm truncate", tone)}>
        {isNull ? "—" : `${prefix}${value! > 0 && !prefix ? "+" : ""}${value!.toFixed(digits)}${suffix}`}
      </div>
    </div>
  );
}
