import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { TrendingUp, Bell, Eye, LineChart } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Markets Dashboard — Live AI signals & alerts" },
      { name: "description", content: "Real-time AI market signals, price alerts, watchlists, options flow and financial news in one dark dashboard." },
      { property: "og:title", content: "Markets Dashboard" },
      { property: "og:description", content: "Live AI signals, price alerts, watchlists and news." },
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
          AI signals, alerts and market intel — all in one dashboard.
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
          Real-time options flow, earnings, financial news with sentiment, customizable price alerts and AI-generated trade signals.
        </p>
        <Link to="/markets"><Button size="lg">Open dashboard</Button></Link>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-24 grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: LineChart, title: "AI Market Signals", body: "Daily call/put and buy/sell signals with confidence, entry, target and stop." },
          { icon: Bell, title: "Price Alerts", body: "Set above/below price triggers on stocks & crypto. Realtime notifications." },
          { icon: Eye, title: "Watchlist & News", body: "Track assets and read sentiment-tagged financial news as it breaks." },
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
