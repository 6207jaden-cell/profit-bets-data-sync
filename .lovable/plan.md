# Let the agent actually close positions it decides to exit

## What's wrong

Each scan, the AI is told it may exit a position by proposing it with `direction="close"`. Those
proposals are then thrown away as malformed and logged as a warning, e.g. AAVE-USD on 2026-09-19
with a "lock in 12.65% profit" rationale. Nothing in the agent knows how to act on a close
proposal, so the only way a position ever exits is the automatic stop-loss, trailing stop, or
take-profit check. Nobody sees this happening.

## What to build

1. **Accept close proposals as valid.** In the response validator, treat `direction: "close"` as
   its own shape: symbol + rationale required, allocation/stop/take-profit/conviction not required
   (close proposals legitimately send 0). Entry proposals keep today's stricter rules unchanged.

2. **Handle them in the scan.** Before the entry loop in the agent, split the proposals into
   closes and entries. For each close, find the matching open position for that user and close it
   using the same path the circuit-breaker closure already uses in this file: fetch a trusted
   quote, apply slippage and fees, write exit price / P&L / closed_at, run the data-quality flag
   check, apply the cash delta atomically, log the execution, and feed the outcome to the learning
   loop. A close with no matching open position is skipped with a recorded reason, not an error.

3. **Mirror closes to Robinhood in live mode.** Reuse the exit mirroring already implemented in
   the 10-minute exit checker: scale the sell quantity from paper quantity to the live position
   and place the sell; skip unsupported positions the same way it does today.

4. **Make it visible.** Record each AI-initiated close in the agent decision payload so it shows
   in the audit log, and count them alongside trades opened.

## Technical notes

- Files: `src/lib/ai-response-validation.ts`, `src/routes/api/public/autonomous-agent.ts`.
- Pattern to copy for the close mechanics: the circuit-breaker block in `autonomous-agent.ts` and
  `runExitForUser` in `src/routes/api/public/autonomous-exit-check.ts` (slippage, fees,
  `flagTradeIfImplausible`, `apply_paper_cash_delta`, `scaleSellQuantity`).
- New unit tests: validator accepts a close proposal with zeroed numeric fields and still rejects
  malformed entries; close-proposal matching handles the no-open-position case.
- Verify with `bunx tsgo --noEmit`, `bunx vitest run`, and a build.
