import { createFileRoute } from "@tanstack/react-router";
import MarketsDashboard from "@/features/markets/MarketsDashboard";

export const Route = createFileRoute("/_authenticated/markets")({
  head: () => ({
    meta: [
      { title: "Markets Dashboard — Live signals & alerts" },
      { name: "description", content: "Live AI market signals, price alerts, watchlist, options flow, earnings and financial news." },
      { property: "og:title", content: "Markets Dashboard" },
      { property: "og:description", content: "Live AI signals, price alerts, watchlist and news." },
    ],
  }),
  component: MarketsDashboard,
});
