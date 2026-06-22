## AI Trading Engine — V2 Extension for /markets

Big scope. Proposing a phased build so we ship value incrementally instead of one mega-PR that's hard to validate.

### Scope confirmation
- Extends existing `/markets` dashboard — keeps current theme, tier system, realtime, sidebar.
- Adds a new top-level section "AI Trading Engine" with tabs: Overview, Strategies, Backtesting, Execution, Risk.
- Paper trading is default. Live trading is Premium-tier, opt-in, with confirmation modal.
- Broker abstraction: Paper (default), Alpaca (live), Interactive Brokers (stub).
- All data real (Polygon → Alpha Vantage → Finnhub fallback already wired).

### Phased delivery

**Phase 1 — Foundation (this turn)**
- DB migration: `strategies`, `paper_portfolios`, `paper_trades`, `signals_executions`, `strategy_performance`, `risk_limits`, `broker_connections`, `smart_alerts`. RLS + GRANTs.
- Realtime publication for `paper_trades`, `signals_executions`, `smart_alerts`.
- New route `/_authenticated/trading` with 5-tab shell + sidebar entry.
- Paper portfolio auto-init ($10k) on first visit.
- Overview tab: portfolio equity, balance, open positions, recent executions (all live from Supabase).

**Phase 2 — Strategy Engine**
- Server fn `generateStrategyFromPrompt` using Lovable AI Gateway (`google/gemini-3-flash-preview`) → structured JSON (indicators, entry/exit, timeframes).
- Strategies CRUD UI with NL prompt input + JSON preview.
- Per-strategy execution mode toggle: OFF / PAPER / LIVE (LIVE gated to Premium).

**Phase 3 — Backtesting**
- Server fn `runBacktest`: fetches historical bars (Polygon aggs → Alpha Vantage TIME_SERIES_DAILY fallback), evaluates strategy rules, computes win rate, ROI, max drawdown, Sharpe approx.
- Equity curve (Recharts), trade log table.
- Results persisted to `strategy_performance`.

**Phase 4 — Paper Execution + Risk Engine**
- Server fn `executeTrade`: validates against `risk_limits` (max daily loss %, max position %, cooldown), gets live quote, writes `paper_trades` + updates `paper_portfolios.balance/equity`.
- Server fn `evaluateRisk`: sector exposure, drawdown, correlation grouping.
- Risk Controls tab: limit editors + live exposure panel.
- AI signal → auto-execute hook: when strategy has `auto_execute='paper'` and a new signal arrives, call `executeTrade`.

**Phase 5 — Live Execution Layer (Premium)**
- `broker_connections` table stores per-user broker credentials (encrypted via secret reference, not raw).
- Alpaca adapter (paper or live endpoints based on connection mode).
- IBKR stub returns "coming soon".
- Execution Settings panel: connect broker, toggle live trading (default OFF), confirmation modal for every live order.
- BlurLock for non-Premium.

**Phase 6 — Smart Alerts + Portfolio Intelligence**
- Smart alert condition builder (IF/AND/OR over price %, RSI, EPS surprise).
- Server fn `aiPortfolioCommentary`: AI-generated rebalancing + drift insights.
- Extend existing PortfolioPanel with commentary card.

### Technical details

- All AI calls server-side via Lovable AI Gateway, `google/gemini-3-flash-preview` default.
- All market data uses existing `getStockQuotes` / `getMarketNews` with fallback chain.
- Live status badge in header polls `signals_executions` last row + measures p99 latency.
- Framer Motion already installed; reuse for trade row entrance.
- Monospace numerics via existing `font-mono` utility.
- Tier check via existing `useProfile` hook; BlurLock component already exists.
- Broker secrets: request `ALPACA_API_KEY_ID` + `ALPACA_SECRET_KEY` only when user connects Alpaca (Phase 5).

### Tier matrix
| Feature | Free | Starter | Pro | Premium |
|---|---|---|---|---|
| Paper trading | ✓ | ✓ | ✓ | ✓ |
| Strategies | 2 | 5 | 20 | ∞ |
| Backtesting | — | ✓ | ✓ | ✓ |
| Auto paper exec | — | — | ✓ | ✓ |
| Live execution | — | — | — | ✓ |
| Smart alerts | 1 | 5 | 25 | ∞ |

### What I'll build this turn
**Phase 1 only** (DB + shell + Overview). Then I'll pause for you to verify before continuing through Phases 2–6. This keeps each step reviewable and avoids a 30-file blob.

Confirm and I'll start with the migration.