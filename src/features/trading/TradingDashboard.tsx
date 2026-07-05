import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Activity, Brain, FlaskConical, Zap, Shield, LineChart as LineChartIcon,
  TrendingUp, LogOut, ArrowUpRight, ArrowDownRight, Link2, Bot,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StrategiesPanel } from "./components/StrategiesPanel";
import { BacktestingPanel } from "./components/BacktestingPanel";
import { ExecutionPanel } from "./components/ExecutionPanel";
import { RiskPanel } from "./components/RiskPanel";
import { BrokerPanel } from "./components/BrokerPanel";
import { AgentPanel } from "./components/AgentPanel";

export default function TradingDashboard() {
  const { tier, email, userId, loading } = useProfile();
  const navigate = useNavigate();
  const qc = useQueryClient();

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
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground p-4 sticky top-0 h-screen">
        <div className="flex items-center gap-2 mb-8">
          <TrendingUp className="h-5 w-5 text-primary" />
          <span className="font-display font-semibold">Markets</span>
        </div>
        <nav className="flex-1 space-y-1 text-sm">
          <Link to="/markets" className="flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-sidebar-accent/50">
            <Activity className="h-4 w-4" /> Dashboard
          </Link>
          <Link to="/trading" className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
            <Brain className="h-4 w-4" /> AI Trading
          </Link>
        </nav>
        <div className="border-t border-sidebar-border pt-3 text-xs">
          <div className="text-muted-foreground truncate">{email}</div>
          <div className="flex items-center justify-between mt-1">
            <span className="uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold">{tier}</span>
            <button onClick={signOut} className="text-muted-foreground hover:text-foreground"><LogOut className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="border-b border-border sticky top-0 z-10 bg-background/80 backdrop-blur">
          <div className="px-6 py-4 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-display font-semibold flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" /> AI Trading Engine
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">Paper-first execution. Live trading requires Premium &amp; broker connection.</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary/40 text-primary font-mono text-[10px]">
                DRY RUN MODE
              </Badge>
              <LiveStatus updatedAt={lastExec.data?.created_at} />
            </div>
          </div>
          {/* Stats bar */}
          <div className="px-6 pb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Paper equity" value={`$${equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
            <Stat label="P&L" value={`${positive ? "+" : ""}${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`} tone={positive ? "good" : "bad"} />
            <Stat label="Strategies" value={counts.data?.strategies ?? 0} />
            <Stat label="Executions" value={counts.data?.executions ?? 0} />
          </div>
        </header>

        <Tabs defaultValue={typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("tab") ?? "overview") : "overview"} className="p-6">
          <TabsList className="mb-6 flex-wrap">
            <TabsTrigger value="overview"><Activity className="h-3.5 w-3.5 mr-1.5" />Overview</TabsTrigger>
            <TabsTrigger value="strategies"><Brain className="h-3.5 w-3.5 mr-1.5" />Strategies</TabsTrigger>
            <TabsTrigger value="backtest"><FlaskConical className="h-3.5 w-3.5 mr-1.5" />Backtesting</TabsTrigger>
            <TabsTrigger value="execution"><Zap className="h-3.5 w-3.5 mr-1.5" />Execution</TabsTrigger>
            <TabsTrigger value="risk"><Shield className="h-3.5 w-3.5 mr-1.5" />Risk</TabsTrigger>
            <TabsTrigger value="broker"><Link2 className="h-3.5 w-3.5 mr-1.5" />Broker</TabsTrigger>
            <TabsTrigger value="agent"><Bot className="h-3.5 w-3.5 mr-1.5" />Agent</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <section aria-labelledby="paper-portfolio" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <h2 id="paper-portfolio" className="sr-only">Paper Portfolio</h2>
              <Card className="p-5 border-border bg-card lg:col-span-2">
                <header className="flex items-center justify-between mb-4">
                  <h3 className="font-display font-semibold flex items-center gap-2"><LineChartIcon className="h-4 w-4 text-primary" /> Paper Portfolio</h3>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">simulated</span>
                </header>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Equity</div>
                    <div className="font-mono text-2xl font-semibold">${equity.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Cash</div>
                    <div className="font-mono text-2xl font-semibold">${Number(p?.balance ?? 0).toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Starting</div>
                    <div className="font-mono text-2xl font-semibold text-muted-foreground">${start.toFixed(0)}</div>
                  </div>
                </div>
              </Card>
              <Card className="p-5 border-border bg-card">
                <header className="flex items-center justify-between mb-4">
                  <h3 className="font-display font-semibold">Quick Actions</h3>
                </header>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Build a strategy with AI, run a backtest, then auto-execute into your paper portfolio.</p>
                  <p className="text-xs">Live trading unlocks at <span className="text-primary font-semibold">Premium</span>.</p>
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
                          className="px-5 py-3 flex items-center justify-between text-sm"
                        >
                          <div className="flex items-center gap-3">
                            <span className={cn(
                              "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded font-mono",
                              t.side === "buy" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                            )}>{t.side}</span>
                            <span className="font-display font-semibold">{t.asset}</span>
                            <span className="text-xs text-muted-foreground font-mono">{Number(t.quantity).toFixed(4)} @ ${Number(t.entry_price).toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {t.pnl != null && (
                              <span className={cn("font-mono text-xs flex items-center gap-1", tradePnl >= 0 ? "text-bull" : "text-bear")}>
                                {tradePnl >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                {tradePnl >= 0 ? "+" : ""}{tradePnl.toFixed(2)}
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground font-mono">
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
        </Tabs>
      </main>
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

