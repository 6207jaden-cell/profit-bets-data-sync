# Get the agent trading stocks and options again

## What's actually happening (confirmed)

The scans are running fine. Cron history shows the morning scan, midday scan and every scalp slot fired successfully during market hours. The agent simply refuses to buy anything that isn't crypto, and it says so in its own words:

- Midday scan: "The current candidates are not crypto assets, and **per learned rules, only crypto trades are permitted**."
- Scalp scan: "No suitable crypto scalp opportunities... **strict adherence to the crypto-only rule**."
- Crypto scans: "All existing SPY positions are non-crypto instruments and must be closed. This is a critical rule violation."

The source is the weekly self-learning loop. Its saved "adjustments" are injected into every scan prompt under the heading **"LEARNED RULES FROM PAST PERFORMANCE (treat as hard rules)"**. Three stored weekly reviews contain text like "Continue to focus exclusively on crypto assets" and "implement a hard pre-trade filter... to prevent any non-crypto assets from being considered."

Those conclusions came from a period when stock trades were failing for unrelated technical reasons (the old forbidden-instrument bug). The reviewer read those zero-P&L stock trades as "stocks don't work", wrote a permanent ban, and every scan since has obeyed it as a hard rule. The agent locked its own universe down to crypto and cannot escape without intervention.

## The fix

1. **Clear the poisoned rules from history.** Strip the universe-restricting sentences out of the three stored weekly reviews so no future scan can read them. Keep the useful parts of each review (sizing, stops, hold-duration insights) intact — only the asset-class bans are removed.

2. **Stop the model narrowing its own universe again.** Add a guardrail module that detects any "trade only crypto" / "avoid stocks, ETFs, options" style adjustment and drops it in two places: when a weekly review is saved, and when old reviews are read back into the scan prompt. Even if a stale row survives somewhere, it can never reach the prompt again.

3. **Tell the weekly reviewer it's out of bounds.** Add explicit scope limits to the review prompt: which asset classes are tradeable is system policy, not the model's decision. Bad performance in a group of trades becomes an observation about sizing/timing/exits, never a ban on that asset class.

4. **Soften the prompt framing.** "LEARNED RULES ... (treat as hard rules)" is what turned an opinion into an unbreakable law. Reframe as performance guidance that is explicitly subordinate to the system's own trading rules, so the standard stock/ETF/options rules always win a conflict.

5. **Keep crypto-session memories out of equity scans.** Crypto scans run roughly 28x per day versus one morning scan, so the shared memory pool is almost entirely crypto observations, which biases stock sessions too. Market-observation memories will be tagged by session and loaded per session type, so a morning stock scan reads stock-market context, not last night's Bitcoin RSI notes.

6. **Verify with a real scan.** After the changes, trigger a morning/midday scan directly and read the resulting agent message and decision payload to confirm stock and ETF candidates are being proposed again, and that any rejection is a genuine risk decision rather than a universe rule.

## Technical detail

- New `src/lib/learning-guardrails.ts`: `isUniverseRestrictingAdjustment`, `sanitizeLearningAdjustments`, plus a `LEARNING_SCOPE_INSTRUCTION` string for the reviewer prompt. Unit tests in `src/lib/__tests__/learning-guardrails.test.ts` covering the exact sentences found in the live rows.
- `src/routes/api/public/autonomous-learning.ts`: append the scope instruction to the review system prompt; run `sanitizeLearningAdjustments` before the `agent_learnings` insert.
- `src/routes/api/public/autonomous-agent.ts` (~lines 841-846, 1258-1263, 1380): sanitize `adjustments` on read for both `learningsSummary` and `learningAdjustments`, and change the prompt heading to guidance subordinate to the trading rules.
- `src/lib/agent-memory.ts`: add a session scope to market-observation saves/loads so crypto-session observations don't dominate equity sessions.
- SQL: an `UPDATE` on `agent_learnings` removing the offending array elements from `adjustments` (and the matching sentences in `analysis`) for the three affected rows. No table or column changes.
