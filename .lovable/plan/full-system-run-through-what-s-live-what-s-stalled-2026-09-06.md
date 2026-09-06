# Full system run-through: what's live, what's stalled

## What I checked and found

The hosted backend is awake and healthy, and both the preview and the live site load. The scheduled jobs (30 of them) are all switched on. But the system was effectively asleep from Sep 1 to today.

Confirmed findings:

1. **Scheduled jobs stopped for 5 days.** Job history shows ~820 runs/day through Sep 1, then nothing until they resumed at 17:40 today (Sep 6). This lines up with the backend having gone to sleep. They are running again now (exit check, strategy evaluation, and alert checks have all fired successfully in the last few minutes).
2. **The AI agent has made no real decision since Aug 28.** Every scan from Aug 28 midday onward recorded an AI error: 48/48 on Aug 29, 48/48 on Aug 30, 45/46 on Aug 31, 24/24 on Sep 1. Cause: the AI allowance was used up (top-up balance is now at zero). A fresh monthly allowance started Sep 6 and a successful AI call went through at 17:46 today, so this should clear on its own — worth confirming with one live scan.
3. **Crypto strategy checks fail on symbol format.** The strategy evaluator keeps returning "market data unavailable" for `ETH/USD`, `SOL/USD`, and `BTC`, while the agent's own universe uses `BTC-USD` style. The saved strategies use a format the price lookup does not normalize.
4. **The Robinhood connection is stale.** The stored access token expired Sep 1 and hasn't been refreshed since Aug 31. Live-mode execution is currently switched on, so real orders would fail until the connection refreshes or is reconnected.
5. **No trades since Aug 28** and no portfolio snapshot since Sep 1 — both are downstream of 1 and 2, not separate bugs.

## What I'd do

1. **Prove the agent works again end to end.** Trigger one crypto scan and one exit check against the live app, then read back the recorded decision to confirm the AI step succeeded (no error flag) and that any resulting trade wrote cash correctly.
2. **Fix crypto symbol normalization in the strategy evaluator.** Normalize saved strategy symbols (`ETH/USD`, `BTC`, `eth`) to the canonical `ETH-USD` form before the price lookup, so the every-5-minute strategy loop stops erroring. Add unit tests for the normalization cases.
3. **Refresh the Robinhood link and surface its health.** Attempt a token refresh using the stored refresh token. If it fails, the Agent tab should clearly show "reconnect needed" instead of appearing ready, and live mode should warn rather than silently skip orders.
4. **Add a low-credit / blocked-AI guard for scans.** The blocked-AI notification exists but a whole week of failed scans produced no visible warning. Make repeated AI failures raise one in-app notification and an agent message so a stall is obvious the same day.
5. **Catch up the missing daily data.** Write today's portfolio snapshot so the equity curve has no 5-day gap, and confirm the daily digest fires tomorrow.
6. **Publish** so the production schedules run the current code.

## Technical notes

- Symbol normalization belongs in the shared helper used by `src/lib/indicators.ts` price/bar fetching, with `evaluate-strategies.ts` calling it before lookups; the agent universe format (`BTC-USD`) is the canonical target.
- Robinhood refresh path: `getValidToken` in `src/lib/robinhood-live.ts` plus `mcp-oauth.server.ts`; expose the derived state to `AgentPanel.tsx` so `state: ready` with an expired token no longer reads as connected.
- Stall alerting: extend the existing `ai-gateway-block.ts` classification so consecutive `ai_error` decisions (not just 402/403) trigger `notifyGatewayBlocked`-style notification, throttled to once per day.
- Snapshot backfill is a single insert into `portfolio_snapshots` from the current portfolio row; no schema change.
