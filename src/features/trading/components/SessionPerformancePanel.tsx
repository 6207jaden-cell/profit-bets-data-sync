import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { cn } from "@/lib/utils";
import { BarChart2 } from "lucide-react";
import { LoadingState } from "@/components/StateViews";

type Trade = {
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  rationale: string | null;
};

type SessionStats = {
  label: string;
  tag: "[SCALP]" | "[SWING]" | "[CRYPTO]" | "Other";
  color: string;
  bgColor: string;
  trades: number;
  wins: number;
  losses: number;
  totalPnL: number;
  winRate: number;
  avgPnL: number;
};

function pnl(t: Trade): number {
  if (!t.exit_price) return 0;
  const dir = t.side === "buy" ? 1 : -1;
  return (Number(t.exit_price) - Number(t.entry_price)) * Number(t.quantity) * dir;
}

function getTag(rationale: string | null): "[SCALP]" | "[SWING]" | "[CRYPTO]" | "Other" {
  if (!rationale) return "Other";
  if (rationale.includes("[SCALP]")) return "[SCALP]";
  if (rationale.includes("[SWING]")) return "[SWING]";
  if (rationale.includes("[CRYPTO]")) return "[CRYPTO]";
  return "Other";
}

const SESSION_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  "[SCALP]": { label: "Scalp", color: "#3b82f6", bgColor: "bg-blue-500/10" },
  "[SWING]": { label: "Swing", color: "#a855f7", bgColor: "bg-purple-500/10" },
  "[CRYPTO]": { label: "Crypto 24/7", color: "#f59e0b", bgColor: "bg-amber-500/10" },
  "Other": { label: "Manual / Other", color: "#6b7280", bgColor: "bg-gray-500/10" },
};

export function SessionPerformancePanel() {
  const { userId } = useProfile();

  const { data: trades, isLoading } = useQuery({
    queryKey: ["session-perf", userId],
    enabled: !!userId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("paper_trades")
        .select("side, quantity, entry_price, exit_price, rationale")
        .eq("user_id", userId!)
        .eq("is_open", false)
        .not("exit_price", "is", null);
      return (data ?? []) as Trade[];
    },
  });

  const sessions = useMemo((): SessionStats[] => {
    if (!trades || trades.length === 0) return [];

    const groups: Record<string, Trade[]> = { "[SCALP]": [], "[SWING]": [], "[CRYPTO]": [], "Other": [] };
    for (const t of trades) groups[getTag(t.rationale)].push(t);

    return Object.entries(groups)
      .filter(([, ts]) => ts.length > 0)
      .map(([tag, ts]) => {
        const pnls = ts.map(pnl);
        const totalPnL = pnls.reduce((s, p) => s + p, 0);
        const wins = pnls.filter(p => p > 0).length;
        const cfg = SESSION_CONFIG[tag];
        return {
          label: cfg.label,
          tag: tag as SessionStats["tag"],
          color: cfg.color,
          bgColor: cfg.bgColor,
          trades: ts.length,
          wins,
          losses: ts.length - wins,
          totalPnL,
          winRate: ts.length > 0 ? Math.round((wins / ts.length) * 100) : 0,
          avgPnL: ts.length > 0 ? totalPnL / ts.length : 0,
        };
      })
      .sort((a, b) => b.trades - a.trades);
  }, [trades]);

  const winRateData = sessions.map(s => ({
    name: s.label,
    "Win Rate": s.winRate,
    color: s.color,
  }));

  const pnlData = sessions.map(s => ({
    name: s.label,
    "P&L": Number(s.totalPnL.toFixed(2)),
    color: s.totalPnL >= 0 ? s.color : "#ef4444",
  }));

  if (isLoading) return <LoadingState message="Loading performance data…" />;
  if (sessions.length === 0) return (
    <div className="text-center py-8 text-muted-foreground text-sm">
      No closed trades yet — performance breakdown will appear here after the agent closes its first trades.
    </div>
  );

  return (
    <section className="space-y-4">
      <h2 className="font-display font-semibold text-sm flex items-center gap-2">
        <BarChart2 className="h-4 w-4 text-primary" />
        Performance by Session Type
      </h2>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {sessions.map(s => (
          <Card key={s.tag} className={cn("p-4 border-border/60", s.bgColor)}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold" style={{ color: s.color }}>{s.label}</span>
              <span className="text-[10px] text-muted-foreground">{s.trades} trades</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total P&L</span>
                <span className={cn("font-mono font-bold", s.totalPnL >= 0 ? "text-emerald-400" : "text-red-400")}>
                  {s.totalPnL >= 0 ? "+" : ""}${Math.abs(s.totalPnL).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Win rate</span>
                <span className={cn("font-mono font-semibold", s.winRate >= 50 ? "text-emerald-400" : "text-red-400")}>
                  {s.winRate}%
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Avg/trade</span>
                <span className={cn("font-mono", s.avgPnL >= 0 ? "text-emerald-400" : "text-red-400")}>
                  {s.avgPnL >= 0 ? "+" : ""}${Math.abs(s.avgPnL).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">W / L</span>
                <span className="font-mono">
                  <span className="text-emerald-400">{s.wins}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-red-400">{s.losses}</span>
                </span>
              </div>
            </div>

            {/* Win rate bar */}
            <div className="mt-3 h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${s.winRate}%`, background: s.color }}
              />
            </div>
          </Card>
        ))}
      </div>

      {/* Charts */}
      {sessions.length >= 2 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="p-4 border-border/60">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Win Rate by Session</h3>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={winRateData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: number) => [`${v}%`, "Win Rate"]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11, borderRadius: 6 }} />
                <Bar dataKey="Win Rate" radius={[3, 3, 0, 0]}>
                  {winRateData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4 border-border/60">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Total P&L by Session</h3>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={pnlData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} />
                <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11, borderRadius: 6 }} />
                <Bar dataKey="P&L" radius={[3, 3, 0, 0]}>
                  {pnlData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </section>
  );
}
