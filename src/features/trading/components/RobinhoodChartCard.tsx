import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Snapshot = { balance: number; created_at: string };
type Connection = { state: string };

export function RobinhoodChartCard() {
  const { userId } = useProfile();

  // Check if Robinhood is connected
  const { data: connection } = useQuery({
    queryKey: ["robinhood-connection", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("mcp_connections")
        .select("state")
        .eq("user_id", userId!)
        .eq("server_url", "https://agent.robinhood.com/mcp/trading")
        .maybeSingle();
      return data as Connection | null;
    },
  });

  const isConnected = connection?.state === "ready";

  // Load snapshots
  const { data: snapshots, isLoading } = useQuery({
    queryKey: ["robinhood-snapshots", userId],
    enabled: !!userId && isConnected,
    staleTime: 120_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("robinhood_snapshots")
        .select("balance, created_at")
        .eq("user_id", userId!)
        .order("created_at", { ascending: true })
        .limit(365);
      return (data ?? []) as Snapshot[];
    },
  });

  const chartData = (snapshots ?? []).map((s) => ({
    date: new Date(s.created_at).toLocaleDateString([], { month: "short", day: "numeric" }),
    balance: Number(s.balance),
  }));

  const latest = chartData[chartData.length - 1]?.balance ?? 0;
  const first = chartData[0]?.balance ?? 0;
  const change = first > 0 ? latest - first : 0;
  const changePct = first > 0 ? (change / first) * 100 : 0;
  const isUp = change >= 0;
  const stroke = isUp ? "#22c55e" : "#ef4444";

  // ── Not connected ────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <Card className="p-4 sm:p-5 border-border/60 bg-card shadow-sm flex flex-col items-center justify-center min-h-[220px] gap-3 text-center">
        <WifiOff className="h-8 w-8 text-muted-foreground/40" />
        <div>
          <p className="font-medium text-sm">Robinhood not connected</p>
          <p className="text-xs text-muted-foreground mt-1">
            Go to <span className="text-primary font-medium">Broker tab</span> → connect your Robinhood account to see your real balance here.
          </p>
        </div>
      </Card>
    );
  }

  // ── Connected but no data yet ────────────────────────────────────────────
  if (!isLoading && chartData.length === 0) {
    return (
      <Card className="p-4 sm:p-5 border-border/60 bg-card shadow-sm flex flex-col items-center justify-center min-h-[220px] gap-3 text-center">
        <Wifi className="h-8 w-8 text-emerald-400/60" />
        <div>
          <p className="font-medium text-sm">Robinhood connected ✓</p>
          <p className="text-xs text-muted-foreground mt-1">
            Your balance chart will start building from the first sync.<br />
            Syncs run daily at <span className="font-mono text-primary">9:15am ET</span>.
          </p>
        </div>
      </Card>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="p-4 sm:p-5 border-border/60 bg-card shadow-sm min-h-[220px] animate-pulse">
        <div className="h-4 w-32 bg-muted rounded mb-4" />
        <div className="h-32 bg-muted/50 rounded" />
      </Card>
    );
  }

  // ── Chart ────────────────────────────────────────────────────────────────
  return (
    <Card
      className="p-4 sm:p-5 shadow-sm"
      style={{
        background: "linear-gradient(135deg, #1e293b 0%, #1a2744 100%)",
        border: "1px solid rgba(99,102,241,0.2)",
      }}
    >
      <header className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-display text-sm font-bold text-foreground flex items-center gap-2">
            <Wifi className="h-3.5 w-3.5 text-emerald-400" />
            Robinhood Account
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">Real account balance</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-bold text-foreground">
            ${latest.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          {chartData.length > 1 && (
            <div className={cn("text-[11px] font-mono flex items-center justify-end gap-0.5 mt-0.5", isUp ? "text-emerald-400" : "text-red-400")}>
              {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {isUp ? "+" : ""}{change.toFixed(2)} ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
            </div>
          )}
        </div>
      </header>

      {chartData.length < 2 ? (
        <div className="flex items-center justify-center h-28 text-xs text-muted-foreground">
          {chartData.length === 1 ? "First data point recorded — chart fills in over time" : "No data yet"}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={130}>
          <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="rh-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 11,
              }}
              formatter={(v: number) => [`$${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "Balance"]}
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke={stroke}
              fill="url(#rh-fill)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <p className="text-[9px] text-muted-foreground mt-2 text-right">
        Updated daily · {chartData.length} day{chartData.length !== 1 ? "s" : ""} of data
      </p>
    </Card>
  );
}
