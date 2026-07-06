# Port PROFIT_BETS.AI market features → this app

## What's being ported (20 components)

Grouped by fate:

**Replace weaker current version (5)** — PROFIT_BETS versions are more feature-rich:
- `MarketSignalCard` — adds Robinhood/options deep-links, quality badges, timeframe, broker chooser
- `WatchlistPanel` → `WatchlistTab` — asset drawer integration, richer rows
- `PortfolioPanel` → `MarketPortfolio` — position P&L, allocation, cost basis
- `PriceAlertsPanel` → `PriceAlerts` — multi-condition rules, snooze
- `SignalHistoryPanel` → `SignalHistory` + `CalibrationPlot` — resolved-signal audit + calibration chart

**Bring over new (15)**:
- `MarketsOverview` (dashboard hero + top movers)
- `MarketSignalsFeed` (filterable signal grid)
- `MultiTimeframeConsensus` (1m/5m/1h/1d agreement matrix)
- `AssetDetailDrawer` (per-ticker deep dive)
- `LivePriceTicker` (marquee)
- `MarketAnalytics` (win-rate, edge, prop-type charts)
- `OptionsFlowScanner` (Polygon options snapshot: unusual volume, sweeps)
- `CryptoOnChainMetrics` (CoinGecko: dominance, funding, active addresses)
- `EarningsCalendar` (Finnhub earnings)
- `NewsFeed` (Finnhub company/general news)
- `SignalOutcomePanel` (per-signal target/stop resolution)
- `SampleSignals` (unauthenticated demo cards)
- `MarketsOnboarding` (first-run tour)
- `MarketsSEO` (route head helper)
- `CalibrationPlot` (companion to SignalHistory)

## Where they live

**Markets dashboard (`/markets`)** gains new tabs so it becomes the analytics home:
```
Overview | Signals | History | Watchlist | Portfolio | Analytics | Alerts | Consensus | Options | News | Earnings
```
Plus `LivePriceTicker` above the tab strip and `AssetDetailDrawer` mounted globally.

**AI Trading dashboard (`/trading`)** gets one new tab: **Options** — houses `OptionsFlowScanner` filtered to Robinhood-eligible contracts, with buttons that either (a) deep-link to Robinhood app/web via `robinhood://options/chains/...`, or (b) route the order through your existing MCP Robinhood connection (reuses `mcp-client.functions.ts` + `AgentPanel` execution path).

## Data wiring (real, no mocks)

Uses secrets already in the project (`POLYGON_API_KEY`, `FINNHUB_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `LOVABLE_API_KEY`) plus one new free public endpoint (CoinGecko — no key). New server functions in `src/lib/`:

| Function | Source | Feeds |
|---|---|---|
| `getOptionsFlow.functions.ts` | Polygon `/v3/snapshot/options/{ticker}` | OptionsFlowScanner |
| `getOnChainMetrics.functions.ts` | CoinGecko `/coins/{id}` + `/global` | CryptoOnChainMetrics |
| `getEarnings.functions.ts` | Finnhub `/calendar/earnings` | EarningsCalendar |
| `getNews.functions.ts` | Finnhub `/news`, `/company-news` | NewsFeed |
| `getMultiTimeframe.functions.ts` | Polygon aggregates (1/5/60/D) + reuses `src/lib/indicators.ts` | MultiTimeframeConsensus |
| `getLiveTicker.functions.ts` | Finnhub `/quote` (batched) | LivePriceTicker |

All fetchers cache results in the client via TanStack Query (staleTime 30–60s).

## Robinhood

- Deep-link buttons on every `MarketSignalCard`, `OptionsFlowScanner` row, and `AssetDetailDrawer` (buy/sell/options-chain URLs for web + app schemes).
- "Execute via connected Robinhood" button that reuses your existing MCP path (`src/lib/mcp-client.functions.ts` → `AgentPanel`'s executor) when the Robinhood MCP connection is `ready`. Falls back to deep-link when not connected.
- Referral banner: skipped (tied to other project's referral code).

## New tables (migration)

- `market_news_cache` (source, ticker, headline, url, ts) — Finnhub news is rate-limited, this dedupes
- `options_flow_cache` (ticker, contract, volume, oi, type, strike, expiry, ts)
- `earnings_calendar` (ticker, date, eps_est, eps_actual, revenue_est)
- `signal_calibration` view over `market_signals` for `CalibrationPlot`

Each table gets `GRANT`s, RLS enabled, `TO authenticated` SELECT policies (public reference data).

## Cron

One new pg_cron job every 15 min hits `/api/public/refresh-market-cache` which populates the three cache tables above (using anon `apikey` header per project convention).

## Files touched / added

Added (~24):
- `src/features/markets/components/` — 15 new components + 5 replacements
- `src/lib/{options,onchain,earnings,news,ticker,multitimeframe}.functions.ts`
- `src/routes/api/public/refresh-market-cache.ts`
- `supabase/migrations/<ts>_market_cache_tables.sql`
- `supabase/migrations/<ts>_market_cache_cron.sql`

Edited:
- `src/features/markets/MarketsDashboard.tsx` — new tab structure + `LivePriceTicker` + `AssetDetailDrawer`
- `src/features/trading/TradingDashboard.tsx` — add "Options" tab
- 5 replaced components deleted after new versions land
- `src/integrations/supabase/types.ts` — regenerated

## Out of scope

- Referral banner (skipped, uses other project's code)
- `MarketsOnboarding` tour infrastructure (needs coach-tour context that doesn't exist here) — port as static empty-state instead
- Any sports/Kalshi/parlay code

## Verification

- Build + typecheck
- Playwright: load `/markets` on mobile viewport, cycle through every tab, screenshot each; verify OptionsFlowScanner and NewsFeed return real rows
- Manual: click a Robinhood deep-link, confirm URL scheme resolves; trigger `refresh-market-cache` via `net.http_post` and confirm cache tables populate