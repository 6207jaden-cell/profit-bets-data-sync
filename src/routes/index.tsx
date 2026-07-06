import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { TrendingUp, Bell, LineChart, Bot, Trophy, Brain } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Trading & Market Signals — Autonomous strategies, real-time intel" },
      { name: "description", content: "AI-powered trading signals, autonomous strategies that backtest and paper-trade themselves, and a live strategy leaderboard." },
      { property: "og:title", content: "AI Trading & Market Signals" },
      { property: "og:description", content: "Autonomous AI strategies, live signals, smart alerts and a real-time strategy leaderboard." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            <span className="font-display font-semibold">Markets Dashboard</span>
          </div>
          <Link to="/auth"><Button size="sm">Sign in</Button></Link>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-6 py-24 text-center">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary border border-primary/30 rounded-full px-3 py-1 mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> LIVE
        </span>
        <h1 className="text-5xl md:text-6xl font-display font-bold tracking-tight mb-6">
          AI-powered trading signals, autonomous strategies, and real-time market intel.
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
          Daily AI signals, self-backtesting strategies, an autonomous Robinhood agent, and a live leaderboard of what's winning right now.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link to="/markets"><Button size="lg">Open dashboard</Button></Link>
          <Link to="/auth"><Button size="lg" variant="outline">Start for free</Button></Link>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-24 grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { icon: LineChart, title: "AI Market Signals", body: "Daily buy/sell and options flow signals with confidence scores." },
          { icon: Bot, title: "Autonomous Trading", body: "AI-generated strategies that backtest and paper-trade themselves." },
          { icon: Trophy, title: "Strategy Leaderboard", body: "See which strategies are winning in real time." },
          { icon: Bell, title: "Smart Alerts", body: "Multi-condition alerts on price, RSI, volume and more." },
        ].map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-card p-6">
            <f.icon className="h-5 w-5 text-primary mb-3" />
            <h3 className="font-display font-semibold mb-1">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
