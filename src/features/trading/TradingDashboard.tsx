import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { getHistoricalBars } from "@/lib/history.functions";
import { motion } from "framer-motion";
import {
  Activity, Brain, FlaskConical, TestTubes, Zap, Shield, LineChart as LineChartIcon,
  TrendingUp, TrendingDown, LogOut, ArrowUpRight, ArrowDownRight, Link2, Bot, ShieldCheck, Trophy, Sigma, ScrollText, Newspaper,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { StrategiesPanel } from "./components/StrategiesPanel";
import { BacktestingPanel, ExitAnalysisPanel } from "./components/BacktestingPanel";
import { RiskReportPanel } from "./components/RiskReportPanel";
import { AgentAuditLog } from "./components/AgentAuditLog";
import { GettingStartedBanner } from "./components/GettingStartedBanner";
import { AbTestingPanel } from "./components/AbTestingPanel";
import { ExecutionPanel } from "./components/ExecutionPanel";
import { RiskPanel } from "./components/RiskPanel";
import { BrokerPanel } from "./components/BrokerPanel";
import { AgentPanel } from "./components/AgentPanel";
import { LeaderboardPanel } from "./components/LeaderboardPanel";
import { OptionsFlowPanel } from "./components/OptionsFlowPanel";
import { CatalystsPanel } from "./components/CatalystsPanel";
import { AgentBacktestModal } from "./components/AgentBacktestModal";
import { TopNav } from "@/components/TopNav";

// Tab groups for organized navigation
const TAB_GROUPS = [
  {
    label: "Main",
    items: [
      { value: "overview", label: "Overview", Icon: Activity },
      { value: "agent", label: "Agent", Icon: Bot },
      { value: "execution", label: "Positions", Icon: Zap },
      { value: "leaderboard", label: "Leaderboard", Icon: Trophy },
    ],
  },
  {
    label: "Strategy",
    items: [
      { value: "strategies", label: "Strategies", Icon: Brain },
      { value: "backtest", label: "Backtest", Icon: FlaskConical },
      { value: "ab-testing", label: "A/B Tests", Icon: TestTubes },
    ],
  },
  {
    label: "Analysis",
    items: [
      { value: "risk-report", label: "Risk Report", Icon: ShieldCheck },
      { value: "exit-analysis", label: "Exit Analysis", Icon: TrendingDown },
      { value: "options", label: "Options Flow", Icon: Sigma },
      { value: "catalysts", label: "Catalysts", Icon: Newspaper },
    ],
  },
  {
    label: "Logs & Config",
    items: [
      { value: "audit-log", label: "Agent Log", Icon: ScrollText },
      { value: "risk", label: "Risk Config", Icon: Shield },
      { value: "broker", label: "Broker", Icon: Link2 },
    ],
  },
] as const;

type TabItem = { value: string; label: string; Icon: React.ComponentType<{ className?: string }> };
const TAB_ITEMS: TabItem[] = TAB_GROUPS.flatMap((g) => [...g.items] as TabItem[]);

export default function TradingDashboard() {
  const { tier, tierLabel, isAdmin, email, userId, loading } = useProfile();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>(() =>
    typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("tab") ?? "overview") : "overview",
  );

  // Ensure a paper portfolio exists for this user
  const portfolio = useQuery({
    queryKey: ["paper-portfolio", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: existing } = await supabase
        .from("paper_portfolios").select("*").eq("user_id", userId!).maybeSingle();
      if (existing) return existing;
      const { data: created, error } = await supabase
        .from("paper_portfolios")
        .insert({ user_id: userId!, balance: 10000, equity: 10000, starting_balance: 10000 })
        .select().single();
      if (error) throw error;
      return created;
    },
  });

  // Recent trades
  const trades = useQuery({
    queryKey: ["paper-trades", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paper_trades").select("*")
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Strategy + execution counts
  const counts = useQuery({
    queryKey: ["trading-counts", userId],
    enabled: !!userId,
    queryFn: async () => {
      const [s, e] = await Promise.all([
        supabase.from("strategies").select("id", { count: "exact", head: true }),
        supabase.from("signals_executions").select("id", { count: "exact", head: true }),
      ]);
      return { strategies: s.count ?? 0, executions: e.count ?? 0 };
    },
  });

  // Last execution for LIVE STATUS badge
  const lastExec = useQuery({
    queryKey: ["last-execution", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("signals_executions")
        .select("created_at,status").order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  // Realtime subscriptions
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel("trading-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "paper_trades" }, () => {
        qc.invalidateQueries({ queryKey: ["paper-trades", userId] });
        qc.invalidateQueries({ queryKey: ["paper-portfolio", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "signals_executions" }, () => {
        qc.invalidateQueries({ queryKey: ["last-execution", userId] });
        qc.invalidateQueries({ queryKey: ["trading-counts", userId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  if (loading) return null;

  const p = portfolio.data;
  const equity = Number(p?.equity ?? 0);
  const start = Number(p?.starting_balance ?? 10000);
  const pnl = equity - start;
  const pnlPct = start > 0 ? (pnl / start) * 100 : 0;
  const positive = pnl >= 0;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TopNav />
      <div className="flex flex-1 min-h-0">

      <aside className="hidden md:flex w-56 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground p-4 sticky top-0 h-screen">
        <div className="flex items-center gap-2 mb-8">
          <Brain className="h-5 w-5 text-primary" />
          <span className="font-display font-semibold">AI Trading</span>
        </div>
        <nav className="flex-1 space-y-1 text-sm">
          <Link to="/markets" className="flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-sidebar-accent/50">
            <Activity className="h-4 w-4" /> Dashboard
          </Link>
          <Link to="/trading" className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
            <Brain className="h-4 w-4" /> AI Trading
          </Link>
          {isAdmin && (
            <Link to="/admin" className="flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-sidebar-accent/50">
              <ShieldCheck className="h-4 w-4" /> Admin
            </Link>
          )}
        </nav>
        <div className="border-t border-sidebar-border pt-3 text-xs">
          <div className="text-muted-foreground truncate">{email}</div>
          <div className="flex items-center justify-between mt-1">
            <span className={cn(
              "uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded font-semibold",
              tier === "elite" ? "bg-amber-500/15 text-amber-500" : tier === "pro" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
            )}>{tierLabel}</span>
            <button onClick={signOut} className="text-muted-foreground hover:text-foreground"><LogOut className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="border-b border-border sticky top-0 z-10 bg-background/80 backdrop-blur">
          <div className="px-4 sm:px-6 py-3 sm:py-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-display font-semibold flex items-center gap-2 truncate">
                <Brain className="h-5 w-5 shrink-0 text-primary" />
                <span className="truncate">AI Trading Engine</span>
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">Paper-first execution. Live trading requires Premium &amp; broker connection.</p>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <Badge variant="outline" className="border-primary/40 text-primary font-mono text-[10px]">
                DRY RUN
              </Badge>
              <LiveStatus updatedAt={lastExec.data?.created_at} />
            </div>
          </div>
          {/* Stats bar */}
          <div className="px-4 sm:px-6 pb-3 sm:pb-4 grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            <Stat label="Paper equity" value={`$${equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
            <Stat label="P&L" value={`${positive ? "+" : ""}${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`} tone={positive ? "good" : "bad"} />
            <Stat label="Strategies" value={counts.data?.strategies ?? 0} />
            <Stat label="Executions" value={counts.data?.executions ?? 0} />
          </div>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="p-4 sm:p-6">
          <MobileTabSelect value={tab} onChange={setTab} />
          {/* Grouped tab navigation — desktop */}
          <div className="mb-6 hidden md:flex flex-col gap-0 border-b border-border pb-3">
            <div className="flex flex-wrap gap-4 items-start">
              {TAB_GROUPS.map((group) => (
                <div key={group.label} className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-medium mb-1 px-1">
                    {group.label}
                  </span>
                  <div className="flex flex-wrap gap-0.5">
                    {group.items.map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        onClick={() => setTab(value)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                          tab === value
                            ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        )}
                      >
                        <Icon className="h-3 w-3" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <TabsContent value="overview" className="space-y-6">
            {/* Getting started banner — only shown when account is empty */}
            <GettingStartedBanner
              userId={userId}
              onNavigate={setTab}
            />
            <section aria-labelledby="paper-portfolio" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <h2 id="paper-portfolio" className="sr-only">Paper Portfolio</h2>
              <div className="lg:col-span-2">
                <EquityCurveCard userId={userId} equity={equity} cash={Number(p?.balance ?? 0)} start={start} />
              </div>
              <Card className="p-4 sm:p-5 border-border/60 bg-card shadow-sm">
                <header className="flex items-center justify-between mb-4">
                  <h3 className="font-display font-semibold">Go to</h3>
                </header>
                <div className="space-y-1">
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setTab("agent")}>
                    <Bot className="h-3.5 w-3.5 mr-2 text-primary" /> AI Agent
                    <span className="ml-auto text-[10px] text-muted-foreground">Main feature</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setTab("execution")}>
                    <Zap className="h-3.5 w-3.5 mr-2 text-primary" /> Open Positions
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setTab("leaderboard")}>
                    <Trophy className="h-3.5 w-3.5 mr-2 text-primary" /> Strategy Leaderboard
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setTab("strategies")}>
                    <Brain className="h-3.5 w-3.5 mr-2 text-primary" /> Strategies
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setTab("backtest")}>
                    <FlaskConical className="h-3.5 w-3.5 mr-2 text-primary" /> Backtest
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setTab("catalysts")}>
                    <Newspaper className="h-3.5 w-3.5 mr-2 text-primary" /> News Catalysts
                  </Button>
                  {userId && (
                    <div className="pt-2">
                      <AgentBacktestModal userId={userId} />
                    </div>
                  )}
                </div>
              </Card>
            </section>

            <section aria-labelledby="recent-trades">
              <header className="flex items-center justify-between mb-3">
                <h2 id="recent-trades" className="font-display font-semibold">Recent Paper Trades</h2>
              </header>
              <Card className="border-border bg-card">
                {(trades.data?.length ?? 0) === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    No trades yet. Once you enable a strategy in PAPER mode, executions will appear here in real time.
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {trades.data!.map((t, i) => {
                      const tradePnl = Number(t.pnl ?? 0);
                      return (
                        <motion.li
                          key={t.id}
                          initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className="px-4 sm:px-5 py-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm"
                        >
                          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-wrap">
                            <span className={cn(
                              "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded font-mono shrink-0",
                              t.side === "buy" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                            )}>{t.side}</span>
                            <span className="font-display font-semibold truncate">{t.asset}</span>
                            <span className="text-xs text-muted-foreground font-mono truncate">{Number(t.quantity).toFixed(4)} @ ${Number(t.entry_price).toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                            {t.pnl != null && (
                              <span className={cn("font-mono text-xs flex items-center gap-1", tradePnl >= 0 ? "text-bull" : "text-bear")}>
                                {tradePnl >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                {tradePnl >= 0 ? "+" : ""}{tradePnl.toFixed(2)}
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">
                              {new Date(t.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        </motion.li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </section>
          </TabsContent>

          <TabsContent value="strategies">
            <StrategiesPanel />
          </TabsContent>
          <TabsContent value="ab-testing">
            <div className="space-y-4">
              <AbTestingPanel />
            </div>
          </TabsContent>
          <TabsContent value="audit-log">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-1">Agent Decision Log</h3>
                <p className="text-xs text-muted-foreground">Every autonomous decision the agent has made — click any row to see what it considered and why.</p>
              </div>
              <AgentAuditLog />
            </div>
          </TabsContent>
          <TabsContent value="exit-analysis">
            {userId && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-1">Exit Strategy Analysis</h3>
                  <p className="text-xs text-muted-foreground">Analyzes your closed trades to show if your exits are too early, too late, or well-calibrated.</p>
                </div>
                <ExitAnalysisPanel userId={userId} />
              </div>
            )}
          </TabsContent>
          <TabsContent value="risk-report">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-1">Portfolio Risk Report</h3>
                <p className="text-xs text-muted-foreground">Live risk metrics for all open positions: beta, sector concentration, max loss, and options exposure.</p>
              </div>
              <RiskReportPanel />
            </div>
          </TabsContent>
          <TabsContent value="backtest">
            <BacktestingPanel />
          </TabsContent>
          <TabsContent value="execution">
            <ExecutionPanel />
          </TabsContent>
          <TabsContent value="risk">
            <RiskPanel />
          </TabsContent>
          <TabsContent value="broker">
            <BrokerPanel />
          </TabsContent>
          <TabsContent value="agent">
            <AgentPanel />
          </TabsContent>
          <TabsContent value="leaderboard">
            <LeaderboardPanel userId={userId!} />
          </TabsContent>
          <TabsContent value="options">
            <OptionsFlowPanel />
          </TabsContent>
          <TabsContent value="catalysts">
            <CatalystsPanel />
          </TabsContent>
        </Tabs>
      </main>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "bad" }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className={cn("font-mono text-xl font-semibold", tone === "good" && "text-bull", tone === "bad" && "text-bear")}>{value}</div>
    </motion.div>
  );
}

function LiveStatus({ updatedAt }: { updatedAt?: string | null }) {
  const ts = updatedAt ? new Date(updatedAt) : null;
  const fresh = ts && Date.now() - ts.getTime() < 5 * 60_000;
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-mono">
      <span className={cn("h-2 w-2 rounded-full", fresh ? "bg-bull animate-pulse" : "bg-muted-foreground/50")} />
      <span className="text-muted-foreground">
        {ts ? `LAST EXEC ${ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "NO EXECUTIONS YET"}
      </span>
    </div>
  );
}

function MobileTabSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  if (!isMobile) return null;
  const current: TabItem = (TAB_ITEMS.find((t) => t.value === value) ?? TAB_ITEMS[0]) as TabItem;
  const CurrentIcon = current.Icon;
  return (
    <div className="mb-4 md:hidden">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full h-10">
          <span className="flex items-center gap-2">
            <CurrentIcon className="h-4 w-4 text-primary" />
            <span className="font-medium">{current.label}</span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {TAB_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                {group.label}
              </div>
              {group.items.map(({ value: v, label, Icon }) => (
                <SelectItem key={v} value={v}>
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </span>
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EquityCurveCard({ userId, equity, cash, start }: { userId: string | null; equity: number; cash: number; start: number }) {
  const [showBench, setShowBench] = useState(false);

  const snaps = useQuery({
    queryKey: ["equity-snapshots", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolio_snapshots")
        .select("equity, created_at")
        .order("created_at", { ascending: true })
        .limit(90);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = snaps.data ?? [];
  const positive = equity >= start;
  const stroke = positive ? "hsl(var(--bull))" : "hsl(var(--bear))";

  // Fetch SPY bars covering the same period as our snapshots
  const barsFn = useServerFn(getHistoricalBars);
  const firstSnapDate = rows.length > 0 ? new Date(rows[0].created_at) : null;
  const daysSinceFirst = firstSnapDate
    ? Math.max(15, Math.ceil((Date.now() - firstSnapDate.getTime()) / 86_400_000) + 5)
    : 30;

  const spy = useQuery({
    queryKey: ["spy-bench-v2", daysSinceFirst],
    enabled: showBench && rows.length >= 1,
    staleTime: 6 * 3600_000,
    queryFn: () => barsFn({ data: { symbol: "SPY", days: daysSinceFirst } }),
  });

  // Always include today's current equity so the chart shows even before first daily snapshot
  const allDataPoints = [
    ...rows,
    // Add today's live equity as the last point if it's different from latest snapshot
    ...(rows.length === 0 || Number(rows[rows.length - 1]?.equity) !== equity
      ? [{ created_at: new Date().toISOString(), equity }]
      : []),
  ];

  // Build chart data with proper date-aligned SPY values
  const chartData = allDataPoints.map((r) => {
    const point: { date: string; equity: number; spy?: number } = {
      date: new Date(r.created_at).toLocaleDateString([], { month: "short", day: "numeric" }),
      equity: Number(r.equity),
    };

    if (showBench && spy.data?.ok && spy.data.points.length > 0) {
      const spyPts = spy.data.points;
      // Find the SPY bar whose timestamp is closest to this snapshot's date
      const snapTs = new Date(r.created_at).getTime();
      let bestIdx = 0;
      let bestDiff = Math.abs(spyPts[0].t - snapTs);
      for (let j = 1; j < spyPts.length; j++) {
        const diff = Math.abs(spyPts[j].t - snapTs);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = j; }
      }
      // Normalize: SPY starting price maps to our starting balance
      const spyStartClose = spyPts[0].close;
      const spyCurrentClose = spyPts[bestIdx].close;
      point.spy = Number((start * (spyCurrentClose / spyStartClose)).toFixed(2));
    }

    return point;
  });

  // Compute alpha: how much we beat/lost vs SPY
  let vsSpyPct: number | null = null;
  if (showBench && spy.data?.ok && rows.length >= 2) {
    const lastSpyValue = chartData[chartData.length - 1]?.spy;
    if (lastSpyValue != null && lastSpyValue > 0) {
      const portfolioPct = ((equity - start) / start) * 100;
      const spyPct = ((lastSpyValue - start) / start) * 100;
      vsSpyPct = portfolioPct - spyPct;
    }
  }

  return (
    <Card className="p-4 sm:p-5" style={{ background: "linear-gradient(135deg, #1e293b 0%, #1a2744 100%)", border: "1px solid rgba(99,102,241,0.3)", boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)" }}>
      <header className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h3 className="font-display text-base font-bold flex items-center gap-2 min-w-0">
          <LineChartIcon className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-foreground">Paper Portfolio</span>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {/* VS SPY toggle */}
          <button
            onClick={() => setShowBench((v) => !v)}
            title="Compare your portfolio returns against the S&P 500"
            className={cn(
              "text-[10px] font-semibold uppercase px-2.5 py-1 rounded border transition-all",
              showBench
                ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                : "border-border/60 text-muted-foreground hover:text-amber-300 hover:border-amber-500/40 hover:bg-amber-500/10",
            )}
          >
            {spy.isLoading ? (
              <span className="flex items-center gap-1">
                <svg className="h-2.5 w-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Loading
              </span>
            ) : "vs SPY"}
          </button>

          {/* Alpha badge */}
          {vsSpyPct != null && (
            <span className={cn(
              "text-[11px] font-mono font-bold px-1.5 py-0.5 rounded",
              vsSpyPct >= 0
                ? "text-emerald-300 bg-emerald-500/15"
                : "text-red-300 bg-red-500/15"
            )}>
              {vsSpyPct >= 0 ? "+" : ""}{vsSpyPct.toFixed(1)}% vs SPY
            </span>
          )}

          {/* Error */}
          {showBench && !spy.isLoading && spy.data && !spy.data.ok && (
            <span className="text-[10px] text-red-400">SPY data unavailable</span>
          )}

          <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">simulated</span>
        </div>
      </header>

      {/* Legend */}
      {showBench && spy.data?.ok && (
        <div className="flex items-center gap-4 mb-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-5 rounded" style={{ background: stroke }} />
            Your portfolio
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-5 rounded" style={{ background: "#f59e0b", borderTop: "2px dashed #f59e0b" }} />
            SPY (normalized to $start)
          </span>
        </div>
      )}

      {chartData.length >= 1 ? (
        <div className="h-44 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                domain={["auto", "auto"]}
                width={58}
                tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`}
              />
              <RTooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 8 }}
                formatter={(v: number, key: string) => [
                  `$${Number(v).toFixed(2)}`,
                  key === "spy" ? "SPY (normalized)" : "Your portfolio",
                ]}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke={stroke}
                fill="url(#eq-fill)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
              />
              {showBench && spy.data?.ok && (
                <Area
                  type="monotone"
                  dataKey="spy"
                  stroke="#f59e0b"
                  fill="none"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  activeDot={{ r: 3, fill: "#f59e0b" }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="py-8 text-center space-y-2">
          <p className="text-sm text-muted-foreground">No equity history yet.</p>
          <p className="text-xs text-muted-foreground/70">
            The portfolio snapshot runs daily at 9am ET.<br />
            Your first chart point will appear tomorrow morning.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-muted-foreground mb-0.5">Equity</div>
          <div className="font-mono text-xl sm:text-2xl font-bold truncate" style={{ color: "#f1f5f9" }}>${equity.toFixed(2)}</div>
          <div className={cn("text-[11px] font-mono mt-0.5", equity >= start ? "text-emerald-400" : "text-red-400")}>
            {equity >= start ? "+" : ""}{(((equity - start) / start) * 100).toFixed(2)}%
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-muted-foreground mb-0.5">Cash</div>
          <div className="font-mono text-xl sm:text-2xl font-bold truncate text-foreground">${cash.toFixed(2)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{((cash / Math.max(equity, 1)) * 100).toFixed(0)}% of portfolio</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-muted-foreground mb-0.5">Started</div>
          <div className="font-mono text-xl sm:text-2xl font-bold text-muted-foreground truncate">${start.toFixed(0)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">paper balance</div>
        </div>
      </div>
    </Card>
  );
}



