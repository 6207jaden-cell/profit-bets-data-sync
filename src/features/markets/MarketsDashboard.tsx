import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getFearGreed, getMarketNews, getEarnings, getOptionsFlow, getMarketStats, generateMarketSignals,
} from "@/lib/market.functions";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  LineChart, Sidebar as SidebarIcon, Bell, Eye, Briefcase, History, Newspaper, Calendar,
  Activity, TrendingUp, LogOut, Zap, Sparkles, Brain, ShieldCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

import { useProfile } from "@/hooks/use-profile";
import { MarketSignalCard } from "./components/MarketSignalCard";
import { LiveBadge } from "./components/LiveBadge";
import { BlurLock } from "./components/BlurLock";
import { FearGreedGauge } from "./components/FearGreedGauge";
import { PriceAlertsPanel } from "./components/PriceAlertsPanel";
import { SmartAlertsPanel } from "./components/SmartAlertsPanel";
import { WatchlistPanel } from "./components/WatchlistPanel";
import { SignalHistoryPanel } from "./components/SignalHistoryPanel";
import { PortfolioPanel } from "./components/PortfolioPanel";
import { LivePriceTicker } from "./components/LivePriceTicker";
import { AssetDetailDrawer } from "./components/AssetDetailDrawer";
import { MultiTimeframeConsensus } from "./components/MultiTimeframeConsensus";
import { TopNav } from "@/components/TopNav";

type SignalRow = {
  id: string;
  asset: string;
  signal_type: "options_flow" | "buy_sell";
  direction: "call" | "put" | "buy" | "sell";
  confidence: number;
  entry_price: number | null;
  target_price: number | null;
  stop_price: number | null;
  expected_edge_pct: number | null;
  thesis: string | null;
  result: string;
  created_at: string;
};

export default function MarketsDashboard() {
  const { tier, tierLabel, isAdmin, email, userId, loading } = useProfile();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [drawer, setDrawer] = useState<{ open: boolean; asset: string; type: "stock" | "crypto" }>({
    open: false, asset: "BTC", type: "crypto",
  });
  const openDrawer = (asset: string, type: "stock" | "crypto") => setDrawer({ open: true, asset, type });
  const [consensusAsset, setConsensusAsset] = useState("BTC");
  const [consensusType, setConsensusType] = useState<"stock" | "crypto">("crypto");

  const fearGreedFn = useServerFn(getFearGreed);
  const newsFn = useServerFn(getMarketNews);
  const earningsFn = useServerFn(getEarnings);
  const flowFn = useServerFn(getOptionsFlow);
  const statsFn = useServerFn(getMarketStats);
  const generateFn = useServerFn(generateMarketSignals);

  const fg = useQuery({ queryKey: ["fear-greed"], queryFn: () => fearGreedFn(), staleTime: 5 * 60_000 });
  const news = useQuery({ queryKey: ["market-news"], queryFn: () => newsFn(), staleTime: 5 * 60_000 });
  const earnings = useQuery({ queryKey: ["earnings"], queryFn: () => earningsFn(), staleTime: 30 * 60_000 });
  const flow = useQuery({ queryKey: ["options-flow"], queryFn: () => flowFn(), staleTime: 5 * 60_000 });
  const stats = useQuery({ queryKey: ["market-stats"], queryFn: () => statsFn(), staleTime: 60_000 });

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const signalsQuery = useQuery({
    queryKey: ["public-signals-today"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("market_signals")
        .select("*")
        .gte("created_at", todayStart.toISOString())
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as SignalRow[];
    },
    refetchInterval: 60_000,
  });

  // Realtime: refresh signals on insert
  useEffect(() => {
    const ch = supabase.channel("public-signals")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "market_signals" }, () => {
        qc.invalidateQueries({ queryKey: ["public-signals-today"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  // Try to generate signals if none exist today
  useEffect(() => {
    if (!signalsQuery.data || signalsQuery.data.length > 0) return;
    void generateFn().then(() => qc.invalidateQueries({ queryKey: ["public-signals-today"] }));
  }, [signalsQuery.data, generateFn, qc]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  const signals = signalsQuery.data ?? [];
  const bullish = signals.filter((s) => s.direction === "call" || s.direction === "buy").length;
  const bearish = signals.length - bullish;

  // Watchlist count for stats bar
  const trackingCount = useQuery({
    queryKey: ["watchlist-count", userId],
    queryFn: async () => {
      const { count } = await supabase.from("market_tracking").select("id", { count: "exact", head: true });
      return count ?? 0;
    },
    enabled: !!userId,
  });

  if (loading) return null;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TopNav />
      <div className="flex flex-1 min-h-0">
      {/* Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground p-4 sticky top-0 h-screen">
        <div className="flex items-center gap-2 mb-8">
          <TrendingUp className="h-5 w-5 text-primary" />
          <span className="font-display font-semibold">Markets</span>
        </div>
        <nav className="flex-1 space-y-1 text-sm">
          <Link to="/markets" className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
            <Activity className="h-4 w-4" /> Dashboard
          </Link>
          <Link to="/trading" className="flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-sidebar-accent/50">
            <Brain className="h-4 w-4" /> AI Trading
          </Link>
          {isAdmin && (
            <Link to="/admin" className="flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-sidebar-accent/50">
              <ShieldCheck className="h-4 w-4" /> Admin
            </Link>
          )}
          {[
            { icon: Eye, label: "Watchlist" },
            { icon: Briefcase, label: "Portfolio" },
            { icon: Bell, label: "Alerts" },
            { icon: History, label: "Signal History" },
          ].map((i) => (
            <div key={i.label} className="flex items-center gap-2 px-2.5 py-2 rounded-md text-muted-foreground">
              <i.icon className="h-4 w-4" /> {i.label}
            </div>
          ))}
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

      {/* Main */}
      <main className="flex-1 min-w-0">
        <header className="border-b border-border sticky top-0 z-10 bg-background/80 backdrop-blur">
          <div className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button className="md:hidden text-muted-foreground"><SidebarIcon className="h-5 w-5" /></button>
              <h1 className="text-xl font-display font-semibold">Markets Dashboard</h1>
            </div>
            <LiveBadge updatedAt={stats.data?.updatedAt} />
          </div>
          {/* Stats bar */}
          <div className="px-6 pb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatItem label="Open signals today" value={stats.data?.openSignalsToday ?? 0} />
            <StatItem label="30d win rate" value={`${(stats.data?.winRate30d ?? 0).toFixed(0)}%`} positive={(stats.data?.winRate30d ?? 0) >= 50} />
            <StatItem label="30d avg P&L" value={`${(stats.data?.avgPnl30d ?? 0).toFixed(1)}%`} positive={(stats.data?.avgPnl30d ?? 0) >= 0} />
            <StatItem label="Tracked assets" value={trackingCount.data ?? 0} />
          </div>
        </header>

        <div className="px-4 sm:px-6 pt-3">
          <LivePriceTicker />
        </div>

        <Tabs defaultValue="overview" className="p-4 sm:p-6">
          <TabsList className="mb-6 flex w-full flex-wrap gap-1 h-auto justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
            <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
            <TabsTrigger value="alerts">Smart Alerts</TabsTrigger>
            <TabsTrigger value="history">Signal History</TabsTrigger>
            <TabsTrigger value="consensus">Consensus</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Market Pulse */}
            <section aria-labelledby="market-pulse" className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <h2 id="market-pulse" className="sr-only">Market Pulse</h2>
              <Card className="p-5 border-border bg-card">
                <header className="flex items-center justify-between mb-3">
                  <h3 className="font-display font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Fear &amp; Greed</h3>
                </header>
                {fg.data?.available ? (
                  <FearGreedGauge value={fg.data.data.value} classification={fg.data.data.classification} />
                ) : (
                  <Empty msg="Index unavailable" />
                )}
              </Card>
              <MarketStatusCard />
              <Card className="p-5 border-border bg-card">
                <header className="flex items-center justify-between mb-3">
                  <h3 className="font-display font-semibold flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> AI Signals Today</h3>
                </header>
                <div className="font-num text-4xl font-semibold">{signals.length}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  <span className="text-bull">{bullish} bullish</span> · <span className="text-bear">{bearish} bearish</span>
                </div>
                <Button size="sm" variant="ghost" className="mt-3 -ml-3" onClick={() => generateFn().then(() => qc.invalidateQueries({ queryKey: ["public-signals-today"] }))}>
                  Refresh signals
                </Button>
              </Card>
            </section>

            {/* Latest AI Signals */}
            <section aria-labelledby="latest-signals">
              <header className="flex items-center justify-between mb-3">
                <h2 id="latest-signals" className="font-display font-semibold flex items-center gap-2">
                  <LineChart className="h-4 w-4 text-primary" /> Latest AI Signals
                </h2>
              </header>
              {signals.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground border-border bg-card">
                  No signals yet today — generating in background…
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {signals.slice(0, 6).map((s, i) => (
                    <MarketSignalCard
                      key={s.id}
                      index={i}
                      asset={s.asset}
                      direction={s.direction}
                      signalType={s.signal_type}
                      confidence={s.confidence}
                      entryPrice={s.entry_price}
                      targetPrice={s.target_price}
                      stopPrice={s.stop_price}
                      expectedEdgePct={s.expected_edge_pct}
                      thesis={s.thesis}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Sample / locked */}
            {tier === "free" && signals.length > 3 && (
              <section aria-labelledby="sample-signals">
                <h2 id="sample-signals" className="font-display font-semibold mb-3">Premium Signals</h2>
                <BlurLock active>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {signals.slice(0, 3).map((s, i) => (
                      <MarketSignalCard key={`p-${s.id}`} index={i} asset={s.asset} direction={s.direction} signalType={s.signal_type} confidence={s.confidence} entryPrice={s.entry_price} targetPrice={s.target_price} stopPrice={s.stop_price} expectedEdgePct={s.expected_edge_pct} locked />
                    ))}
                  </div>
                </BlurLock>
              </section>
            )}

            {/* News */}
            <Card className="p-5 border-border bg-card">
              <header className="flex items-center justify-between mb-3">
                <h2 className="font-display font-semibold flex items-center gap-2"><Newspaper className="h-4 w-4 text-primary" /> News Feed</h2>
                <LiveBadge updatedAt={news.data?.updatedAt} />
              </header>
              {!news.data?.available ? (
                <Empty msg={news.data?.reason === "missing_api_key" ? "Add a Finnhub API key to enable news." : "News unavailable right now."} />
              ) : (
                <ul className="divide-y divide-border max-h-96 overflow-y-auto">
                  {news.data.data.map((n) => (
                    <li key={n.id} className="py-2.5">
                      <a href={n.url} target="_blank" rel="noreferrer" className="block group">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className={cn(
                            "text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded",
                            n.sentiment === "bullish" && "bg-bull/15 text-bull",
                            n.sentiment === "bearish" && "bg-bear/15 text-bear",
                            n.sentiment === "neutral" && "bg-muted text-muted-foreground"
                          )}>{n.sentiment}</span>
                          <span className="text-[11px] text-muted-foreground font-num shrink-0">{new Date(n.datetime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <h3 className="text-sm group-hover:text-primary leading-snug">{n.headline}</h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{n.source}</p>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Earnings + Options Flow */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-5 border-border bg-card">
                <header className="flex items-center justify-between mb-3">
                  <h2 className="font-display font-semibold flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" /> Earnings Calendar</h2>
                </header>
                {!earnings.data?.available ? (
                  <Empty msg={earnings.data?.reason === "missing_api_key" ? "Add a Finnhub API key to enable earnings." : "Earnings unavailable."} />
                ) : (
                  <ul className="divide-y divide-border max-h-72 overflow-y-auto text-sm">
                    {earnings.data.data.slice(0, 20).map((e, i) => (
                      <li key={`${e.symbol}-${i}`} className="py-2 flex items-center justify-between">
                        <div>
                          <span className="font-display font-semibold">{e.symbol}</span>
                          <span className="text-xs text-muted-foreground ml-2">{e.date} {e.hour && `· ${e.hour}`}</span>
                        </div>
                        <div className="text-xs font-num text-muted-foreground">
                          EPS est: {e.epsEstimate != null ? e.epsEstimate.toFixed(2) : "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="p-5 border-border bg-card">
                <header className="flex items-center justify-between mb-3">
                  <h2 className="font-display font-semibold flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Options Flow</h2>
                </header>
                {!flow.data?.available ? (
                  <Empty msg={flow.data?.reason === "missing_api_key" ? "Add a Polygon API key to enable options flow." : "Options flow unavailable."} />
                ) : (
                  <ul className="divide-y divide-border max-h-72 overflow-y-auto text-sm">
                    {flow.data.data.slice(0, 15).map((f, i) => (
                      <li key={`${f.symbol}-${i}`} className="py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-display font-semibold truncate">{f.symbol}</div>
                          <div className="text-[10px] text-muted-foreground font-num">{f.expiry} · ${f.strike}</div>
                        </div>
                        <span className={cn("text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded", f.type === "call" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear")}>{f.type}</span>
                        <div className="text-right">
                          <div className="text-xs font-num">${(f.premium / 1000).toFixed(1)}k</div>
                          <div className="text-[10px] text-muted-foreground font-num">vol {f.volume.toLocaleString()}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <PriceAlertsPanel />
          </TabsContent>

          <TabsContent value="watchlist"><WatchlistPanel /></TabsContent>
          <TabsContent value="portfolio"><PortfolioPanel /></TabsContent>
          <TabsContent value="alerts"><SmartAlertsPanel /></TabsContent>
          <TabsContent value="history"><SignalHistoryPanel /></TabsContent>
        </Tabs>
      </main>
      </div>
    </div>
  );
}

function StatItem({ label, value, positive }: { label: string; value: string | number; positive?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className={cn("font-num text-xl font-semibold", positive === true && "text-bull", positive === false && "text-bear")}>{value}</div>
    </motion.div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-sm text-muted-foreground py-6 text-center">{msg}</p>;
}

function MarketStatusCard() {
  // ET market hours: Mon-Fri 9:30–16:00 ET
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const d = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  const open = d >= 1 && d <= 5 && mins >= 570 && mins < 960;
  return (
    <Card className="p-5 border-border bg-card">
      <header className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold">Market Status</h3>
      </header>
      <div className="flex items-center gap-2 text-2xl font-display font-semibold">
        <span className={cn("h-2.5 w-2.5 rounded-full", open ? "bg-bull animate-pulse" : "bg-bear")} />
        Markets {open ? "Open" : "Closed"}
      </div>
      <p className="text-sm text-muted-foreground mt-2">Crypto markets trade 24/7.</p>
      <p className="text-xs text-muted-foreground mt-1 font-num">{et.toLocaleTimeString([], { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })} ET</p>
    </Card>
  );
}
