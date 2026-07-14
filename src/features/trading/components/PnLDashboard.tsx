import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Target, Award, Calendar, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";

type ClosedTrade = {
  id: string;
  asset: string;
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  created_at: string;
  closed_at: string | null;
  rationale: string | null;
};

type PeriodStats = {
  realized: number;
  trades: number;
  wins: number;
  losses: number;
  bestTrade: number;
  worstTrade: number;
  avgGain: number;
};

function calcStats(trades: ClosedTrade[]): PeriodStats {
  let realized = 0;
  let wins = 0;
  let losses = 0;
  let bestTrade = 0;
  let worstTrade = 0;
  const pnls: number[] = [];

  for (const t of trades) {
    if (!t.exit_price) continue;
    const qty = Number(t.quantity);
    const entry = Number(t.entry_price);
    const exit = Number(t.exit_price);
    const dir = t.side === "buy" ? 1 : -1;
    const pnl = (exit - entry) * qty * dir;
    realized += pnl;
    pnls.push(pnl);
    if (pnl > 0) wins++;
    else losses++;
    if (pnl > bestTrade) bestTrade = pnl;
    if (pnl < worstTrade) worstTrade = pnl;
  }

  return {
    realized,
    trades: pnls.length,
    wins,
    losses,
    bestTrade,
    worstTrade,
    avgGain: pnls.length > 0 ? realized / pnls.length : 0,
  };
}

function fmt(n: number) {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(2)}`;
  return n >= 0 ? `+${s}` : `-${s}`;
}

function StatCard({
  label,
  icon: Icon,
  stats,
  accent,
}: {
  label: string;
  icon: typeof Calendar;
  stats: PeriodStats;
  accent?: boolean;
}) {
  const isUp = stats.realized >= 0;
  const winRate = stats.trades > 0 ? Math.round((stats.wins / stats.trades) * 100) : null;

  return (
    <Card className={cn(
      "p-4 border transition-all",
      accent ? "border-primary/30 bg-primary/5" : "border-border/60 bg-card"
    )}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        {stats.trades > 0 && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {stats.trades} trade{stats.trades !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {stats.trades === 0 ? (
        <p className="text-sm text-muted-foreground">No closed trades</p>
      ) : (
        <div className="space-y-2">
          {/* Main P&L number */}
          <div className={cn("font-mono text-2xl font-bold", isUp ? "text-emerald-400" : "text-red-400")}>
            {isUp ? <TrendingUp className="h-4 w-4 inline mr-1 mb-0.5" /> : <TrendingDown className="h-4 w-4 inline mr-1 mb-0.5" />}
            {fmt(stats.realized)}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div>
              <div className="text-[10px] text-muted-foreground">Win rate</div>
              <div className={cn("text-sm font-mono font-semibold", winRate && winRate >= 50 ? "text-emerald-400" : "text-red-400")}>
                {winRate != null ? `${winRate}%` : "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Avg/trade</div>
              <div className={cn("text-sm font-mono font-semibold", stats.avgGain >= 0 ? "text-emerald-400" : "text-red-400")}>
                {fmt(stats.avgGain)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">W / L</div>
              <div className="text-sm font-mono font-semibold">
                <span className="text-emerald-400">{stats.wins}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-red-400">{stats.losses}</span>
              </div>
            </div>
          </div>

          {/* Best / worst */}
          {stats.trades >= 2 && (
            <div className="flex gap-3 pt-1 text-[10px] font-mono">
              <span className="text-emerald-400 flex items-center gap-0.5">
                <Award className="h-2.5 w-2.5" />Best {fmt(stats.bestTrade)}
              </span>
              <span className="text-red-400 flex items-center gap-0.5">
                <Target className="h-2.5 w-2.5" />Worst {fmt(stats.worstTrade)}
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function PnLDashboard() {
  const { userId } = useProfile();

  const { data: closedTrades, isLoading } = useQuery({
    queryKey: ["pnl-dashboard", userId],
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("paper_trades")
        .select("id, asset, side, quantity, entry_price, exit_price, created_at, closed_at, rationale")
        .eq("user_id", userId!)
        .eq("is_open", false)
        .not("exit_price", "is", null)
        .order("closed_at", { ascending: false })
        .limit(500);
      return (data ?? []) as ClosedTrade[];
    },
  });

  const periods = useMemo(() => {
    if (!closedTrades) return null;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const getDate = (t: ClosedTrade) => new Date(t.closed_at ?? t.created_at);

    return {
      today: calcStats(closedTrades.filter(t => getDate(t) >= todayStart)),
      week: calcStats(closedTrades.filter(t => getDate(t) >= weekStart)),
      month: calcStats(closedTrades.filter(t => getDate(t) >= monthStart)),
      allTime: calcStats(closedTrades),
    };
  }, [closedTrades]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {["Today", "This week", "This month", "All time"].map(l => (
          <Card key={l} className="p-4 border-border/60 animate-pulse">
            <div className="h-3 w-16 bg-muted rounded mb-3" />
            <div className="h-7 w-20 bg-muted rounded" />
          </Card>
        ))}
      </div>
    );
  }

  if (!periods) return null;

  return (
    <section>
      <h2 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        Realized P&L
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Today" icon={Clock} stats={periods.today} />
        <StatCard label="This week" icon={Calendar} stats={periods.week} />
        <StatCard label="This month" icon={Calendar} stats={periods.month} />
        <StatCard label="All time" icon={Award} stats={periods.allTime} accent />
      </div>
    </section>
  );
}
