
# Markets Dashboard — Build Plan

Before I write code, I need to flag a few important constraints and get a couple of decisions from you, because this spec is large (~30+ files, 8 edge functions, 4 third-party APIs, auth + tiers + realtime).

## Stack reality check

Your spec says "React 18 + Vite + Tailwind v3 + shadcn/ui." This project is actually:
- **TanStack Start** (React 19, file-based routing in `src/routes/`)
- **Tailwind v4** (CSS-first, `src/styles.css`)
- **shadcn/ui** ✅ (already installed)
- **No backend yet** — Lovable Cloud (Supabase) is not enabled

I'll build on the actual stack. The UI/UX, components, and behavior you described all map cleanly. Route will be `src/routes/markets.tsx` (your spec said `/markets`, not `/dashboard`).

Server logic will live in **TanStack server functions** (`createServerFn`) + **server routes** (`src/routes/api/*`), not Supabase Edge Functions — that's the correct boundary on this stack. Behavior is identical from the user's perspective.

## Decisions I need from you

1. **API keys** — I cannot build "no mock data" without these. You'll need to provide:
   - **Finnhub** (free tier OK) — for news + stock quotes fallback
   - **Polygon.io** (free tier OK) — primary stock quotes + options flow + earnings
   - **Alpha Vantage** (free) — secondary stock quote fallback
   - CoinGecko + Alternative.me Fear & Greed are keyless ✅
   - **Lovable AI Gateway** for signal generation — auto-provisioned ✅

   If you don't have all of these, tell me which you have and I'll degrade gracefully (e.g. skip options flow if no Polygon key, show "data unavailable" instead of mocks).

2. **Auth + tiers** — The spec requires per-user data (alerts, watchlist, signals), tier gating (free/starter/pro/premium), and admin roles. That means I need to enable Lovable Cloud and add full auth (email/password + Google). Confirm OK?

3. **Push notifications for `evaluate-alerts` cron** — Web push needs VAPID keys + service worker + user permission flow. That's a feature on its own. OK to ship alerts as **in-app realtime toasts only** for v1, and defer browser push to a follow-up?

4. **Portfolio "connected positions"** — Connecting a real brokerage (Plaid/SnapTrade) is a multi-week integration with paid APIs. OK to make Portfolio a **manual positions entry** (user adds ticker + shares + cost basis, we compute P&L from live quotes) for v1?

## What I'll build (assuming "yes, proceed with sensible defaults")

### Backend (Lovable Cloud)
- Enable Cloud, configure email + Google auth
- Migrations: `market_signals`, `market_tracking`, `price_alerts`, `manual_positions`, `user_roles` (+ `app_role` enum + `has_role` SECURITY DEFINER), `profiles` (for tier). All with explicit GRANTs + RLS scoped to `auth.uid()`.
- Cron: pg_cron calls `/api/public/evaluate-alerts` and `/api/public/resolve-signals` every 5 min (HMAC-signed).

### Server functions / routes
- `stock-prices.functions.ts` — Polygon → Alpha Vantage → Finnhub fallback chain
- `crypto.functions.ts` — CoinGecko quotes + on-chain
- `market-news.functions.ts` — Finnhub news + Gemini sentiment tag
- `earnings.functions.ts` — Polygon earnings calendar
- `options-flow.functions.ts` — Polygon unusual options
- `market-signals.functions.ts` — Gemini 2.5 Flash via Lovable AI Gateway, writes to `market_signals`
- `fear-greed.functions.ts` — alternative.me passthrough (cached 5 min)
- Public API routes: `/api/public/evaluate-alerts`, `/api/public/resolve-signals` (HMAC-verified)

### Frontend (`src/routes/_authenticated/markets.tsx`)
- Sidebar nav (collapsible, shadcn `Sidebar`)
- Tabs: **Overview** / **Watchlist** / **Portfolio** / **Signal History**
- Overview tab:
  - 4-metric stats bar (open signals, 30d win %, 30d avg P&L, tracked count)
  - Market Pulse row: Fear & Greed gauge, Market Status, AI Signals Today
  - Latest AI Signals grid (`MarketSignalCard`, 1/2/3 col responsive)
  - Sample Signals (blur-locked for free tier)
  - News Feed ticker w/ sentiment chips
  - Earnings Calendar + Options Flow (2-col)
  - Price Alerts panel (create + active + triggered lists)
- Watchlist tab: tracked assets, 60s auto-refresh
- Portfolio tab: manual positions, P&L, allocation donut (recharts)
- Signal History tab: past signals table + calibration scatter plot (recharts)
- `<LiveBadge>` with last-updated timestamp
- `<BlurLock>` wrapper for tier gating
- Realtime: Supabase channels on `price_alerts` + `market_signals`
- SEO `head()`: title "Markets Dashboard — [App]" (<60), meta desc (<160), single H1, semantic HTML

### Design
- Dark theme tokens in `src/styles.css`: bg `#0F172A`, card `#111827`, border subtle, accent `emerald-400` / `teal-400`
- Fonts: **Space Grotesk** (display) + **Inter** (body) via `<link>` in `__root.tsx` head
- Monospace (`JetBrains Mono`) for all numerics
- Framer Motion card entrance animations
- No purple/indigo

## Scope estimate
~35 files, ~6 migrations, ~10 server functions, 2 cron routes. This will take multiple build turns.

---

**Please reply with:**
1. Which API keys you have (or "I'll get them — proceed with what's possible")
2. OK to enable Cloud + add auth?
3. OK to skip web push (toasts only) for v1?
4. OK to make Portfolio manual entry for v1?

Once you confirm, I'll start with: enable Cloud → migrations → auth → core UI shell → fill in features.
