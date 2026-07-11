import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, LineChart, Line, Legend,
} from "recharts";
import { Brain, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

type ClosedTrade = {
  id: string;
  asset: string;
  side: string;
  instrument: string | null;
  pnl: number | null;
  hold_duration: string | null;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
  conviction: number | null;
  created_at: string;
  closed_at: string | null;
};

type AgentDecision = {
  session_type: string;
  regime: string | null;
  trades_opened: number;
  created_at: string;
  payload: unknown;
};

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function winRate(trades: ClosedTrade[]): number {
  const withPnl = trades.filter((t) => t.pnl != null);
  if (withPnl.length === 0) return 0;
  return withPnl.filter((t) => Number(t.pnl) > 0).length / withPnl.length * 100;
}

function avgPnl(trades: ClosedTrade[]): number {
  const withPnl = trades.filter((t) => t.pnl != null);
  if (withPnl.length === 0) return 0;
  return avg(withPnl.map((t) => Number(t.pnl)));
}

export function AgentPerformancePanel() {
  const { userId } = useProfile();

  const { data: trades, isLoading: tradesLoading } = useQuery({
    queryKey: ["agent-perf-trades", userId],
    enabled: !!userId,
    staleTime: 300_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("paper_trades")
        .select("id, asset, side, instrument, pnl, hold_duration, stop_loss_pct, take_profit_pct, conviction, created_at, closed_at")
        .eq("user_id", userId!)
        .eq("is_open", false)
        .not("pnl", "is", null)
        .order("closed_at", { ascending: false })
        .limit(200);
      return ((data ?? []) as unknown) as ClosedTrade[];
    },
  });

  const { data: decisions } = useQuery({
    queryKey: ["agent-perf-decisions", userId],
    enabled: !!userId,
    staleTime: 300_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_decisions")
        .select("session_type, regime, trades_opened, created_at, payload")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(200);
      return (data ?? []) as AgentDecision[];
    },
  });

  if (tradesLoading) {
    return <div className="text-center py-8 text-muted-foreground text-sm">Loading performance data…</div>;
  }

  const allTrades = trades ?? [];
  if (allTrades.length < 3) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
        <Brain className="h-8 w-8 opacity-30" />
        <p>Need at least 3 closed trades to show analytics.</p>
      </div>
    );
  }

  // ── By session type ──────────────────────────────────────────────────────
  const sessionGroups: Record<string, ClosedTrade[]> = {};
  // Match trades to decisions by time proximity
  for (const trade of allTrades) {
    const tradeTime = new Date(trade.created_at).getTime();
    const matchedDecision = (decisions ?? []).find((d) => {
      const dt = new Date(d.created_at).getTime();
      return Math.abs(dt - tradeTime) < 30 * 60_000; // within 30 min
    });
    const session = matchedDecision?.session_type ?? "unknown";
    if (!sessionGroups[session]) sessionGroups[session] = [];
    sessionGroups[session].push(trade);
  }

  const sessionData = Object.entries(sessionGroups).map(([session, ts]) => ({
    session: session.replace("_scan", "").replace("_", " "),
    trades: ts.length,
    winRate: Number(winRate(ts).toFixed(1)),
    avgPnl: Number(avgPnl(ts).toFixed(2)),
  })).sort((a, b) => b.trades - a.trades);

  // ── By instrument type ───────────────────────────────────────────────────
  const instrGroups: Record<string, ClosedTrade[]> = {};
  for (const t of allTrades) {
    const instr = t.instrument ?? "stock";
    if (!instrGroups[instr]) instrGroups[instr] = [];
    instrGroups[instr].push(t);
  }
  const instrData = Object.entries(instrGroups).map(([instr, ts]) => ({
    instrument: instr,
    trades: ts.length,
    winRate: Number(winRate(ts).toFixed(1)),
    avgPnl: Number(avgPnl(ts).toFixed(2)),
  })).sort((a, b) => b.avgPnl - a.avgPnl);

  // ── By hold duration ─────────────────────────────────────────────────────
  const holdGroups: Record<string, ClosedTrade[]> = {};
  for (const t of allTrades) {
    const hold = t.hold_duration ?? "unknown";
    if (!holdGroups[hold]) holdGroups[hold] = [];
    holdGroups[hold].push(t);
  }
  const holdData = Object.entries(holdGroups).map(([hold, ts]) => ({
    duration: hold,
    trades: ts.length,
    winRate: Number(winRate(ts).toFixed(1)),
    avgPnl: Number(avgPnl(ts).toFixed(2)),
  }));

  // ── By regime ─────────────────────────────────────────────────────────────
  const regimeGroups: Record<string, ClosedTrade[]> = { bull: [], bear: [], sideways: [] };
  for (const trade of allTrades) {
    const tradeTime = new Date(trade.created_at).getTime();
    const matchedDecision = (decisions ?? []).find((d) => {
      const dt = new Date(d.created_at).getTime();
      return Math.abs(dt - tradeTime) < 30 * 60_000;
    });
    const regime = matchedDecision?.regime ?? "sideways";
    if (!regimeGroups[regime]) regimeGroups[regime] = [];
    regimeGroups[regime].push(trade);
  }
  const regimeData = Object.entries(regimeGroups)
    .filter(([, ts]) => ts.length > 0)
    .map(([regime, ts]) => ({
      regime: regime.charAt(0).toUpperCase() + regime.slice(1),
      trades: ts.length,
      winRate: Number(winRate(ts).toFixed(1)),
      avgPnl: Number(avgPnl(ts).toFixed(2)),
    }));

  // ── Weekly rolling P&L ───────────────────────────────────────────────────
  const weeklyMap = new Map<string, number>();
  for (const t of allTrades) {
    if (!t.closed_at) continue;
    const d = new Date(t.closed_at);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    weeklyMap.set(key, (weeklyMap.get(key) ?? 0) + Number(t.pnl ?? 0));
  }
  const weeklyData = Array.from(weeklyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, pnl]) => ({ week: week.slice(5), pnl: Number(pnl.toFixed(2)) }));

  const COLORS = { bull: "#22c55e", bear: "#ef4444", sideways: "#f59e0b" };

  return (
    <div className="space-y-4">
      {/* Conviction calibration chart */}
      {(() => {
        const convBuckets = [
          { label: "0-40 (Low)", min: 0, max: 40 },
          { label: "40-60 (Med)", min: 40, max: 60 },
          { label: "60-80 (High)", min: 60, max: 80 },
          { label: "80-100 (Max)", min: 80, max: 101 },
        ];
        const convData = convBuckets.map(({ label, min, max }) => {
          const bucket = allTrades.filter((t) => {
            const c = t.conviction;
            return c != null && c >= min && c < max;
          });
          return {
            label,
            trades: bucket.length,
            winRate: Number(winRate(bucket).toFixed(1)),
            avgPnl: Number(avgPnl(bucket).toFixed(2)),
          };
        }).filter((b) => b.trades > 0);
        if (convData.length < 2) return null;
        return (
          <Card className="p-4 border-border/50">
            <div className="text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wide">
              Conviction Calibration
            </div>
            <p className="text-[10px] text-muted-foreground mb-3">
              Are high-conviction trades actually winning more? If not, Claude's self-assessment needs tuning.
            </p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={convData}>
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} unit="%" />
                <Tooltip
                  formatter={(v: number) => [`${v.toFixed(0)}%`, "Win Rate"]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                />
                <Bar dataKey="winRate" name="Win Rate" radius={[3, 3, 0, 0]}>
                  {convData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.winRate >= 55 ? "hsl(var(--bull))" : entry.winRate >= 45 ? "#f59e0b" : "hsl(var(--bear))"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {convData.map((b) => (
                <div key={b.label} className="text-center">
                  <div className="text-[9px] text-muted-foreground">{b.label}</div>
                  <div className="text-[10px] font-mono">{b.trades} trades</div>
                  <div className={cn("text-[10px] font-mono", b.avgPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {b.avgPnl >= 0 ? "+" : ""}${b.avgPnl.toFixed(2)} avg
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}

      {/* Weekly P&L chart */}
      <Card className="p-4 border-border/50">
        <div className="text-xs font-medium mb-3 text-muted-foreground uppercase tracking-wide">
          Weekly P&L
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={weeklyData}>
            <XAxis dataKey="week" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} />
            <Tooltip
              formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]}
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
            />
            <Bar dataKey="pnl" name="P&L">
              {weeklyData.map((entry) => (
                <Cell key={entry.week} fill={entry.pnl >= 0 ? "hsl(var(--bull))" : "hsl(var(--bear))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* By session type */}
      <Card className="p-4 border-border/50">
        <div className="text-xs font-medium mb-3 text-muted-foreground uppercase tracking-wide">
          Performance by Session Type
        </div>
        <div className="space-y-2">
          {sessionData.map((s) => (
            <div key={s.session} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] capitalize">{s.session}</Badge>
                <span className="text-xs text-muted-foreground">{s.trades} trades</span>
              </div>
              <div className="flex gap-3 font-mono text-xs">
                <span className={s.winRate >= 50 ? "text-emerald-400" : "text-red-400"}>
                  {s.winRate.toFixed(0)}% WR
                </span>
                <span className={s.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {s.avgPnl >= 0 ? "+" : ""}${s.avgPnl.toFixed(2)} avg
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* By instrument */}
      <Card className="p-4 border-border/50">
        <div className="text-xs font-medium mb-3 text-muted-foreground uppercase tracking-wide">
          Performance by Instrument
        </div>
        <div className="space-y-2">
          {instrData.map((s) => (
            <div key={s.instrument} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">{s.instrument}</Badge>
                <span className="text-xs text-muted-foreground">{s.trades} trades</span>
              </div>
              <div className="flex gap-3 font-mono text-xs">
                <span className={s.winRate >= 50 ? "text-emerald-400" : "text-red-400"}>
                  {s.winRate.toFixed(0)}% WR
                </span>
                <span className={s.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {s.avgPnl >= 0 ? "+" : ""}${s.avgPnl.toFixed(2)} avg
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* By hold duration */}
      <Card className="p-4 border-border/50">
        <div className="text-xs font-medium mb-3 text-muted-foreground uppercase tracking-wide">
          Performance by Hold Duration
        </div>
        <div className="space-y-2">
          {holdData.map((s) => (
            <div key={s.duration} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] capitalize">{s.duration}</Badge>
                <span className="text-xs text-muted-foreground">{s.trades} trades</span>
              </div>
              <div className="flex gap-3 font-mono text-xs">
                <span className={s.winRate >= 50 ? "text-emerald-400" : "text-red-400"}>
                  {s.winRate.toFixed(0)}% WR
                </span>
                <span className={s.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {s.avgPnl >= 0 ? "+" : ""}${s.avgPnl.toFixed(2)} avg
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* By market regime */}
      {regimeData.length > 0 && (
        <Card className="p-4 border-border/50">
          <div className="text-xs font-medium mb-3 text-muted-foreground uppercase tracking-wide">
            Performance by Market Regime
          </div>
          <div className="space-y-2">
            {regimeData.map((s) => (
              <div key={s.regime} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Badge
                    className={cn("text-[10px]",
                      s.regime === "Bull" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                      s.regime === "Bear" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                      "bg-amber-500/20 text-amber-400 border-amber-500/30"
                    )}
                  >{s.regime}</Badge>
                  <span className="text-xs text-muted-foreground">{s.trades} trades</span>
                </div>
                <div className="flex gap-3 font-mono text-xs">
                  <span className={s.winRate >= 50 ? "text-emerald-400" : "text-red-400"}>
                    {s.winRate.toFixed(0)}% WR
                  </span>
                  <span className={s.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {s.avgPnl >= 0 ? "+" : ""}${s.avgPnl.toFixed(2)} avg
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
