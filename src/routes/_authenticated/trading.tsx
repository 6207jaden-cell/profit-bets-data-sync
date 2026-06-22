import { createFileRoute } from "@tanstack/react-router";
import TradingDashboard from "@/features/trading/TradingDashboard";

export const Route = createFileRoute("/_authenticated/trading")({
  head: () => ({
    meta: [
      { title: "AI Trading Engine — Strategies, Backtests & Execution" },
      { name: "description", content: "AI-powered trading: strategy builder, historical backtesting, paper trading execution, and risk controls. Paper-first, broker-optional." },
      { property: "og:title", content: "AI Trading Engine" },
      { property: "og:description", content: "Build strategies, backtest, and execute trades safely with paper-first AI automation." },
    ],
  }),
  component: TradingDashboard,
});
