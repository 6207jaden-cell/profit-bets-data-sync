import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Play, Pause, Trophy, Sparkles, User, ChevronDown, ChevronRight, BarChart3 } from "lucide-react";
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpanded((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const data = useQuery({
    queryKey: ["leaderboard"],
    refetchInterval: 30_000,
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
          <div className="p-8 text-center text-muted-foreground text-sm space-y-3">
            <p>No strategies yet.</p>
            <p className="text-xs">
              The AI Lab generates a new strategy every hour and backtests it automatically. Your strategies appear here too.
              Create your first strategy in the Strategies tab or wait for the AI Lab to populate this list.
            </p>
            <div className="flex justify-center gap-2 pt-1">
              <a href="/trading?tab=strategies" className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
                Create Strategy
              </a>
              <button
                onClick={() => qc.invalidateQueries({ queryKey: ["leaderboard"] })}
                className="px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-muted"
              >
                Refresh
              </button>
            </div>
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
                      {row.liveTradeCount >= 20 && (row.liveWinRate ?? 0) >= 55 && (row.backtestSharpe ?? 0) >= 1.0 && row.livePnl > 0 && (
                        <span
                          title="This strategy has proven itself in paper trading. Consider enabling live mode in the Strategies tab."
                          className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-bull/15 text-bull border border-bull/30 animate-pulse"
                        >
                          ✦ READY FOR LIVE
                        </span>
                      )}
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
                      onClick={() => toggleExpand(row.strategy.id)}
                      title="Show attribution"
                    >
                      {expanded.has(row.strategy.id)
                        ? <ChevronDown className="h-3.5 w-3.5" />
                        : <ChevronRight className="h-3.5 w-3.5" />}
                    </Button>
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
                {expanded.has(row.strategy.id) && (
                  <div className="md:col-span-12 mt-2 pt-3 border-t border-border">
                    <AttributionPanel strategyId={row.strategy.id} />
                  </div>
                )}
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

function AttributionPanel({ strategyId }: { strategyId: string }) {
  const q = useQuery({
    queryKey: ["strategy-attribution", strategyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paper_trades")
        .select("asset, side, quantity, entry_price, exit_price, pnl, created_at, closed_at, is_open")
        .eq("strategy_id", strategyId)
        .eq("is_open", false)
        .order("closed_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (q.isLoading) return <div className="text-xs text-muted-foreground p-2">Loading attribution…</div>;
  const trades = q.data ?? [];
  if (trades.length === 0) {
    return (
      <div className="text-xs text-muted-foreground p-2 flex items-center gap-2">
        <BarChart3 className="h-3 w-3" /> No closed trades yet — attribution appears after this strategy fires.
      </div>
    );
  }

  const pnls = trades.map((t) => Number(t.pnl ?? 0));
  const total = pnls.reduce((a, b) => a + b, 0);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const best = trades.reduce((m, t) => (Number(t.pnl ?? -Infinity) > Number(m.pnl ?? -Infinity) ? t : m), trades[0]);
  const worst = trades.reduce((m, t) => (Number(t.pnl ?? Infinity) < Number(m.pnl ?? Infinity) ? t : m), trades[0]);

  // By asset
  const byAsset = new Map<string, { pnl: number; count: number }>();
  for (const t of trades) {
    const cur = byAsset.get(t.asset) ?? { pnl: 0, count: 0 };
    cur.pnl += Number(t.pnl ?? 0);
    cur.count++;
    byAsset.set(t.asset, cur);
  }
  const assets = [...byAsset.entries()]
    .map(([asset, v]) => ({ asset, ...v }))
    .sort((a, b) => b.pnl - a.pnl);

  // Avg hold hours
  const holds = trades
    .filter((t) => t.closed_at && t.created_at)
    .map((t) => (new Date(t.closed_at!).getTime() - new Date(t.created_at).getTime()) / 3_600_000);
  const avgHold = holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : 0;

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <BarChart3 className="h-3.5 w-3.5" />
        <span className="font-mono uppercase tracking-wider text-[10px]">Attribution · {trades.length} closed trades</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
        <MiniStat label="Net P&L" value={`$${total.toFixed(2)}`} tone={total >= 0 ? "good" : "bad"} />
        <MiniStat label="Avg Win" value={`$${avgWin.toFixed(2)}`} tone="good" />
        <MiniStat label="Avg Loss" value={`$${avgLoss.toFixed(2)}`} tone="bad" />
        <MiniStat label="Avg Hold" value={avgHold >= 24 ? `${(avgHold / 24).toFixed(1)}d` : `${avgHold.toFixed(1)}h`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="border border-border rounded-md p-3 bg-background/40">
          <div className="text-[10px] uppercase text-muted-foreground mb-2 font-mono">Best & Worst Trade</div>
          <div className="space-y-1 font-mono">
            <div className="flex justify-between gap-2">
              <span className="truncate">🟢 {best.asset} · {best.side}</span>
              <span className="text-bull">+${Number(best.pnl ?? 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="truncate">🔴 {worst.asset} · {worst.side}</span>
              <span className="text-bear">${Number(worst.pnl ?? 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
        <div className="border border-border rounded-md p-3 bg-background/40">
          <div className="text-[10px] uppercase text-muted-foreground mb-2 font-mono">P&L by Asset</div>
          <ul className="space-y-1 font-mono max-h-32 overflow-auto">
            {assets.slice(0, 8).map((a) => (
              <li key={a.asset} className="flex justify-between gap-2">
                <span className="truncate">{a.asset} <span className="text-muted-foreground">×{a.count}</span></span>
                <span className={a.pnl >= 0 ? "text-bull" : "text-bear"}>
                  {a.pnl >= 0 ? "+" : ""}${a.pnl.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="border border-border rounded-md p-2 bg-background/40">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className={cn("text-sm font-semibold", tone === "good" && "text-bull", tone === "bad" && "text-bear")}>{value}</div>
    </div>
  );
}

