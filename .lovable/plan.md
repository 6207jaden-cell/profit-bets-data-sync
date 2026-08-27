# Live mode: percentage-based sizing instead of dollar mirroring

Today, when execution mode is `live`, the agent mirrors each paper trade's exact dollar amount into Robinhood (`quantity × entry_price`). Since the Robinhood Agentic account holds a different amount of money than the $10k-style paper account, that either over-spends or under-spends badly. This change makes live orders use the same **percentage of account capital** as the paper trade used, not the same dollars.

## How it will work

1. Before placing live orders, read the live account's size from Robinhood (portfolio value + buying power). If that call fails, fall back to the most recent recorded Robinhood balance; if neither is available, skip live execution for that scan and log a clear message instead of sending a wrong-size order.
2. For each trade the agent just opened, compute its weight as a percentage of the paper account's equity (`trade notional ÷ paper equity`).
3. Place the live buy for that same percentage of the live account's portfolio value, capped at available buying power.
4. Guardrails:
   - Skip if the scaled amount is below $1 (Robinhood rejects dust).
   - Never exceed remaining buying power; track it across trades within one scan so several trades in the same scan can't collectively overspend.
   - Keep the existing per-position max cap (percentage-based, so it applies naturally).
5. Sells / closes: sell the same **fraction of the live position** that the paper trade represents of the paper position, instead of the paper share count. If the live account holds no matching position, the sell is skipped with a logged reason.
6. Each trade's rationale note records both figures, e.g. `[LIVE: 4.2% of account → $312.40, order_id=…]`, so paper and live sizing are auditable side by side.
7. The agent's scan message and log will state that live orders were scaled, including the live account value used.

## Notes on current behavior worth flagging

- The 10-minute exit checker currently contains no live-Robinhood selling at all — it only closes paper positions. So stops/targets are not being mirrored to the real account today. This plan keeps that scope unchanged; say the word and I'll add percentage-based live exits as part of the same change.

## Technical details

- `src/routes/api/public/autonomous-agent.ts` (live execution block, ~lines 1902-1943): replace the direct `allocCash` mirror with a scaling step; add a helper that resolves live account value/buying power (Robinhood MCP `get_account_info`, falling back to the latest `robinhood_snapshots` row) and a pure `scaleNotional(paperNotional, paperEquity, liveEquity, buyingPowerLeft)` function.
- The pure scaling helper goes in `src/lib/robinhood-live.ts` (or a small `src/lib/live-sizing.ts`) with unit tests covering: normal scale-down, scale-up, dust skip, buying-power clamp, and zero/missing equity.
- No database schema changes required.
