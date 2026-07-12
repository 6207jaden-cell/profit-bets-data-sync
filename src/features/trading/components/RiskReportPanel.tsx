import { LoadingState, ErrorState } from "@/components/StateViews";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Shield, AlertTriangle, TrendingUp, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const SECTOR_COLORS: Record<string, string> = {
  tech: "#6366f1", finance: "#f59e0b", energy: "#10b981",
  health: "#ec4899", consumer: "#3b82f6", etf: "#8b5cf6",
  crypto: "#f97316", other: "#6b7280",
};

const SECTOR_MAP: Record<string, string> = {
  AAPL:"tech",MSFT:"tech",NVDA:"tech",GOOGL:"tech",AMZN:"tech",META:"tech",TSLA:"tech",
  AMD:"tech",CRM:"tech",NFLX:"tech",PLTR:"tech",SMCI:"tech",IONQ:"tech",MSTR:"tech",
  JPM:"finance",V:"finance",BAC:"finance",SOFI:"finance",HOOD:"finance",COIN:"finance",
  XOM:"energy",XLE:"energy",WMT:"consumer",JNJ:"health",HD:"consumer",PG:"consumer",
  DIS:"consumer",UBER:"consumer",LYFT:"consumer",ABNB:"consumer",RBLX:"consumer",
  SNAP:"consumer",ROKU:"consumer",DKNG:"consumer",OPEN:"consumer",RIVN:"consumer",
  SPY:"etf",QQQ:"etf",IWM:"etf",GLD:"etf",TLT:"etf",XLF:"etf",XLK:"etf",
  SOXL:"etf",ARKK:"etf",
};

function getSector(symbol: string): string {
  const s = symbol.toUpperCase().replace("-USD","");
  if (["BTC","ETH","SOL"].includes(s)) return "crypto";
  return SECTOR_MAP[s] ?? "other";
}

// SPY beta approximation: ratio of asset momentum to SPY momentum
// Real beta requires regression; this is a proxy using 30-day return correlation
const BETA_PROXY: Record<string, number> = {
  SOXL: 3.0, ARKK: 1.8, NVDA: 1.7, TSLA: 1.6, AMD: 1.5, SMCI: 1.6,
  META: 1.3, GOOGL: 1.2, AMZN: 1.2, MSFT: 1.1, AAPL: 1.1, CRM: 1.3,
  JPM: 1.0, BAC: 1.1, V: 0.9, XOM: 0.8, WMT: 0.6, JNJ: 0.5,
  GLD: -0.1, TLT: -0.3, SPY: 1.0, QQQ: 1.15, IWM: 1.2,
  "BTC-USD": 0.9, "ETH-USD": 1.1, "SOL-USD": 1.4,
  PLTR: 1.5, COIN: 1.6, HOOD: 1.4, SOFI: 1.3,
};

export function RiskReportPanel() {
  const { userId } = useProfile();

  const { data: trades, isLoading } = useQuery({
    queryKey: ["risk-report-trades", userId],
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("paper_trades")
        .select("asset, side, quantity, entry_price, stop_loss_pct, instrument, options_details")
        .eq("is_open", true);
      return data ?? [];
    },
  });

  const { data: portfolio } = useQuery({
    queryKey: ["risk-report-portfolio", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("paper_portfolios")
        .select("balance, equity, starting_balance")
        .eq("user_id", userId!)
        .maybeSingle();
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        Loading risk data…
      </div>
    );
  }

  const positions = trades ?? [];
  const totalEquity = Number(portfolio?.equity ?? portfolio?.balance ?? 0);
  const cash = Number(portfolio?.balance ?? 0);

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
        <Shield className="h-8 w-8 opacity-30" />
        <p>No open positions — nothing to report.</p>
      </div>
    );
  }

  // ── Sector exposure ──────────────────────────────────────────────────────
  const sectorMap = new Map<string, number>();
  for (const t of positions) {
    const val = Number(t.quantity) * Number(t.entry_price);
    const sec = getSector(String(t.asset));
    sectorMap.set(sec, (sectorMap.get(sec) ?? 0) + val);
  }
  const sectorData = Array.from(sectorMap.entries()).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value: Number((value / totalEquity * 100).toFixed(1)),
    rawValue: value,
  })).sort((a, b) => b.value - a.value);

  // ── Portfolio beta ───────────────────────────────────────────────────────
  let weightedBeta = 0;
  let totalWeight = 0;
  for (const t of positions) {
    const val = Number(t.quantity) * Number(t.entry_price);
    const sym = String(t.asset).toUpperCase();
    const beta = BETA_PROXY[sym] ?? 1.0;
    weightedBeta += beta * val;
    totalWeight += val;
  }
  const portfolioBeta = totalWeight > 0 ? weightedBeta / totalWeight : 0;

  // ── Max theoretical loss (all stops hit simultaneously) ──────────────────
  let maxLoss = 0;
  for (const t of positions) {
    const val = Number(t.quantity) * Number(t.entry_price);
    const stopPct = Number(t.stop_loss_pct ?? 7) / 100;
    const isBuy = t.side === "buy";
    // For shorts, loss is unlimited theoretically — cap at 50% for display
    maxLoss += val * (isBuy ? stopPct : 0.5);
  }
  const maxLossPct = totalEquity > 0 ? (maxLoss / totalEquity) * 100 : 0;

  // ── Options delta exposure ───────────────────────────────────────────────
  let deltaExposure = 0;
  let optionsCount = 0;
  for (const t of positions) {
    const instr = String(t.instrument ?? "stock").toLowerCase();
    if (!["call","put","call_spread","put_spread"].includes(instr)) continue;
    optionsCount++;
    const details = t.options_details as { resolved_contract?: { delta?: number } } | null;
    const delta = details?.resolved_contract?.delta ?? (instr.includes("call") ? 0.5 : -0.5);
    const contracts = 1; // default 1 contract = 100 shares
    deltaExposure += delta * contracts * 100 * Number(t.entry_price);
  }

  // ── Risk score (0-10) ────────────────────────────────────────────────────
  function computeRiskScore(): { score: number; label: string; color: string } {
    let score = 0;
    // Beta contribution (0-3 pts)
    score += Math.min(3, portfolioBeta * 1.5);
    // Concentration (0-2 pts): highest sector weight
    const topSector = sectorData[0]?.value ?? 0;
    score += topSector > 50 ? 2 : topSector > 30 ? 1 : 0;
    // Max loss (0-3 pts)
    score += maxLossPct > 20 ? 3 : maxLossPct > 10 ? 2 : maxLossPct > 5 ? 1 : 0;
    // Options presence (0-2 pts)
    score += optionsCount > 3 ? 2 : optionsCount > 0 ? 1 : 0;

    const s = Math.min(10, Math.max(0, score));
    if (s >= 7) return { score: s, label: "High Risk", color: "text-red-400" };
    if (s >= 4) return { score: s, label: "Moderate Risk", color: "text-amber-400" };
    return { score: s, label: "Low Risk", color: "text-emerald-400" };
  }

  const riskScore = computeRiskScore();

  return (
    <div className="space-y-4">
      {/* Risk score summary */}
      <Card className="p-4 border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Portfolio Risk Score</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("text-2xl font-mono font-bold", riskScore.color)}>
              {riskScore.score.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">/ 10</span>
            <Badge className={cn(
              riskScore.score >= 7 ? "bg-red-500/20 text-red-400 border-red-500/30" :
              riskScore.score >= 4 ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
              "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
            )}>{riskScore.label}</Badge>
          </div>
        </div>
      </Card>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3 border-border/50">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Portfolio Beta</span>
          </div>
          <div className="text-xl font-mono font-bold">{portfolioBeta.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {portfolioBeta > 1.5 ? "High market sensitivity" : portfolioBeta > 1.0 ? "Above market" : "Defensive"}
          </div>
        </Card>

        <Card className="p-3 border-border/50">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Max Loss (all stops)</span>
          </div>
          <div className={cn("text-xl font-mono font-bold", maxLossPct > 15 ? "text-red-400" : maxLossPct > 8 ? "text-amber-400" : "text-emerald-400")}>
            -{maxLossPct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            ${maxLoss.toFixed(0)} if all stops triggered
          </div>
        </Card>

        <Card className="p-3 border-border/50">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Options Delta Exp.</span>
          </div>
          <div className="text-xl font-mono font-bold">
            {deltaExposure >= 0 ? "+" : ""}${Math.abs(deltaExposure).toFixed(0)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {optionsCount} options position{optionsCount !== 1 ? "s" : ""}
            {deltaExposure > 0 ? " · net long" : deltaExposure < 0 ? " · net short" : ""}
          </div>
        </Card>

        <Card className="p-3 border-border/50">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Cash Buffer</span>
          </div>
          <div className={cn("text-xl font-mono font-bold",
            totalEquity > 0 && (cash/totalEquity*100) < 15 ? "text-red-400" :
            totalEquity > 0 && (cash/totalEquity*100) < 25 ? "text-amber-400" : "text-emerald-400"
          )}>
            {totalEquity > 0 ? (cash / totalEquity * 100).toFixed(0) : 0}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            ${cash.toFixed(0)} available
          </div>
        </Card>
      </div>

      {/* Sector exposure pie */}
      <Card className="p-4 border-border/50">
        <div className="text-xs font-medium mb-3 text-muted-foreground uppercase tracking-wide">
          Sector Exposure
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={sectorData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
            >
              {sectorData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={SECTOR_COLORS[entry.name.toLowerCase()] ?? "#6b7280"}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => [`${v.toFixed(1)}%`, "Allocation"]}
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
            />
            <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
        {sectorData[0]?.value > 40 && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            {sectorData[0].name} is {sectorData[0].value}% of portfolio — consider diversifying
          </div>
        )}
      </Card>
    </div>
  );
}
