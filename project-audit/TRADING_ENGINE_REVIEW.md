# TRADING_ENGINE_REVIEW.md
Last updated: 2026-08-06 (Pass 2 — Stage 3.5 skeptical review of the Stage 3 analytics infrastructure added; Pass 1's trading-logic findings below unchanged)

This review actively tries to disprove the trading system's soundness
rather than describe its features. Findings are split into: genuine
methodological concerns worth acting on, things that are sound but worth
documenting why, and things I could not verify without data that doesn't
exist yet.

---

## Genuine concerns

### 1. Multiple-comparisons risk in the per-signal learning system

~18 distinct named signals are tracked independently per user (momentum,
RSI oversold/overbought, MACD bullish/bearish, Bollinger bands, volume
surge, etc.). Each gets its own Bayesian win-rate estimate. With that many
independently-tracked hypotheses, the probability that *at least one*
shows a spuriously high win rate purely by chance — even if every signal
actually has zero real edge — is materially higher than the probability
for any single signal in isolation. This is the classic multiple-
comparisons problem.

**Partial mitigation that already exists:** the Beta(1,1) prior shrinks
early estimates toward 50% (neutral), and Kelly sizing is gated behind a
15-trade minimum. This reduces but does not eliminate the risk — 15
trades is still a small sample, and shrinkage toward 50% doesn't correct
for testing 18 hypotheses simultaneously.

**Not yet done:** no multiple-comparisons correction (e.g., a stricter
sample-size floor scaled to the number of signals being tracked, or a
False Discovery Rate style adjustment) exists. Worth considering once
real data volume allows evaluating whether this matters in practice for
this specific system, rather than fixing it preemptively based on theory
alone.

### 2. Kelly sizing operates on point estimates with wide confidence intervals near the threshold

The 15-trade minimum sample size is a reasonable floor to prevent acting
on nearly nothing, but it's worth being explicit about how much
uncertainty still exists exactly at that floor. A signal showing "68% win
rate over 24 trades" — used as an illustrative example in the UI copy —
has a 95% Wilson-score confidence interval of roughly 48%–84%. The true
win rate could plausibly still be at or below 50% even when the point
estimate looks good. Kelly sizing amplifies bet size based on the point
estimate, not the confidence interval, meaning it can act confidently on
numbers that are genuinely still quite uncertain.

**Not a bug** — this is an inherent property of small-sample Kelly sizing,
not a coding error. Documenting it because the fractional-Kelly (40%) and
hard 25% cap already in place are the correct mitigations, and it's worth
being honest that these are damage-control measures, not a guarantee the
sizing is well-calibrated at the 15-trade floor.

### 3. Correlation windows are short enough to be statistically noisy

The correlation-based position-sizing check uses a 10-day lookback during
elevated volatility, 30 days otherwise. A Pearson correlation computed
from 10 daily return observations has a large standard error — informally,
a "true" correlation of 0.3 and a "true" correlation of 0.7 can both
easily produce a similar-looking sample correlation at n=10. The
*direction* of shortening the window during high-vol regimes is
conceptually right (correlations do shift faster then), but the specific
window sizes chosen are a judgment call, not derived from a proper
statistical power analysis.

**Not yet done:** no minimum-observation-count sanity check beyond the
existing `len < 8` null-return guard in `computeCorrelation`. Worth
considering a wider default floor (perhaps 15–20 observations minimum
even in the "short window" case) if false correlation-based rejections or
approvals turn out to be common in practice.

### 4. Survivorship bias is structurally present in the fixed ~150-symbol universe

The scan universe is a hardcoded, fixed list of currently-well-known
large/mid-cap stocks and popular cryptocurrencies. This is unavoidable
survivorship bias by construction: these are assets that have already
proven liquid and relevant *today*. This does not distort **forward**
paper/live trading (the universe is fixed going forward, so there's no
hindsight involved in future decisions) — but it would meaningfully
distort any **backtest** run against this same universe's historical
data, since the list wasn't reconstructed to reflect what was actually
liquid/relevant at each historical point in time.

**Action:** the codebase has an `agent-backtest` endpoint whose
correctness has not yet been reviewed in this audit pass (see "Not yet
reviewed" below). If it backtests against the current fixed universe over
historical dates, its results should be read with this bias explicitly in
mind, not treated as an unbiased estimate of historical strategy
performance.

### 5. No explicit lock/mutex against overlapping cron invocations

Cron schedules overlap in principle: crypto scans fire every 30 minutes,
scalp scans every 30 minutes, exit-checks every 10 minutes, and if any
single invocation runs long (many symbols, a slow upstream API), there is
no explicit "scan already in progress, skip this invocation" guard found
in the code. I did not find evidence this has caused a problem, and
Postgres-level constraints (unique position IDs, etc.) would likely
prevent the worst outcomes (e.g., true duplicate trade rows), but this
is an unverified architectural gap rather than a confirmed-safe pattern.

**Not yet done:** add an explicit in-progress flag (e.g., a row in a
small `cron_locks` table with a TTL) so a slow-running scan can't overlap
with the next scheduled one for the same session type.

### 6. No staleness check on price data across fallback sources

`fetchQuotePrice` tries Yahoo Finance, then Finnhub, then Polygon, then
Alpha Vantage in sequence, returning the first successful response. None
of these responses are checked against a timestamp/staleness threshold —
if a fallback source returns a quote that's technically valid but several
minutes old, it's used exactly as if it were live. For daily-bar-based
swing decisions this matters little; for scalp entries and exit-check
stop/target comparisons, a stale quote could mean acting on a price the
market has already moved away from.

**Not yet done:** no staleness validation exists on any price fetch path.

---

### 7. Signal Attribution's dollar-P&L figures are contaminated by the system's own sizing decisions (Stage 3.5 finding)

Signal Attribution (`computeSignalAttribution`) sums realized dollar P&L
per signal to show which signals the money actually came from. But Kelly
sizing already allocates MORE capital to signals with a stronger observed
track record. This creates a real circularity: a signal that Kelly
favored will show a larger dollar-P&L total partly *because* more capital
was put behind it, not purely because it's a better signal. A signal with
genuinely identical per-trade edge but a shorter track record (and
therefore smaller Kelly allocation) will show smaller total dollar
attribution for reasons that have nothing to do with its actual quality.

This is a different, more subtle issue than the already-documented
"credit sharing" caveat (percentages summing to >100% for co-occurring
signals) — that caveat is about attribution being non-exclusive; this one
is about attribution being non-independent of the system's own past
decisions. `computeSignalContribution` (Experiment 4, present-vs-absent
AVERAGE return comparison, not dollar totals) is NOT subject to this same
confound, since it compares average returns rather than summing dollars —
that function remains the better tool for asking "does this signal have
real edge," with Signal Attribution better suited to "where did the
actual money come from," a genuinely different, sizing-inclusive
question. Not fixed — a modeling choice worth being explicit about rather
than a bug, but one that should not be silently conflated with a clean
per-signal-quality measure.

### 8. Multiple-comparisons risk now spans every Stage 3 grouping dimension, not just the original 18 signal weights

Finding 1 above (multiple-comparisons in the per-signal learning system)
was written before Stage 3 existed. The same statistical risk now applies
to every "find the best X" grouping Stage 3 added: Signal Attribution's
per-signal dollar totals (~18 signals), Portfolio Attribution's per-symbol
totals (as many symbols as have been traded), and Regime Performance's 3
buckets. None of these apply a multiple-comparisons correction — they
report raw per-group figures for direct comparison. Looking across any of
these tables for "the standout performer" carries the same risk already
documented for the signal-weights case: with enough categories, at least
one will look spuriously good by chance even if nothing has real edge.
This is not a flaw unique to Stage 3 — it's the same underlying issue
appearing in more places now that more grouped breakdowns exist. Every
grouped Stage 3 view shows sample size directly (trade count per row) as
partial mitigation, but sample size alone does not correct for testing
many groups simultaneously.

### 9. Regime Performance had no minimum-evidence gate — found and fixed during this review

Unlike Claude Attribution and Learning Attribution (which both gate at 30
resolved rows per side) and Signal Contribution (which gates at 10),
`computeRegimePerformance` originally reported every regime bucket with
equal visual weight regardless of sample size — a regime with 2 trades
displayed identically to one with 200. This directly violated the
project's own stated standard ("never present a metric with more
confidence than its sample size supports," `PerformanceMetricsPanel`'s
`MetricCard` docstring). **Fixed as part of this review**, not just
noted: `hasMinimumEvidence` (10-trade floor, matching Signal
Contribution's threshold for consistency) added to
`RegimePerformanceRow`, with a visible "low n" badge in the UI for any
regime below it. Worth being honest that a 10-trade floor is itself loose
— the Wilson-interval work in H4 already demonstrated that even 24
observations leaves a ~35-percentage-point confidence interval on a win
rate. The floor prevents the most misleading cases (2-3 trade "regimes"
presented as if meaningful) but a regime bucket sitting just above 10
should still be read with real caution, not treated as settled.

**Related, not separately fixed:** regime labels come from
`detectMarketRegime`'s SMA50/SMA200 crossover logic, which is a lagging
indicator by construction — this is inherent to the live regime-detection
function itself (unchanged by the retroactive-reconstruction work), not
a new flaw. It means trades made right at a genuine regime turning point
will likely be labeled with the OLD regime for some time after the
market has actually turned, systematically blurring the boundary between
regime buckets rather than randomly misclassifying trades.

### 10. Beta/Alpha/Correlation use SPY as the sole benchmark for a portfolio that also trades crypto

The benchmark comparison (`benchmark-comparison.functions.ts`) computes
Beta, Alpha, and correlation entirely against SPY, a US equity index. For
a portfolio that's purely stocks/ETFs, this is the standard, correct
choice. But this system also trades crypto, which has a fundamentally
different risk/return profile than US equities and is not well-explained
by SPY's movements. A portfolio with meaningful crypto exposure could
show a Beta/Alpha relative to SPY that doesn't cleanly separate "market-
timing skill in equities" from "crypto happened to move independently of
stocks during this period" — the single-benchmark figure conflates both
into one number. Not fixed — would require either a blended benchmark
(weighted by the portfolio's actual stock/crypto split) or reporting
Beta/Alpha separately per asset class, both real, non-trivial pieces of
work beyond this review's scope. Flagged as a genuine interpretive
limitation on the existing figures, not a bug in their calculation.

---

### 11. `agent-backtest.ts` has a real same-bar execution bias — its results are systematically optimistic

The single most important finding from finally reviewing this endpoint
(flagged as deferred since the original Pass 1 audit). The scoring and
the trade entry use the SAME index into the same price array:

```ts
const price = u.closes[day];              // used to compute the momentum score
...
const entry = c.u.closes[day];             // used as the trade's entry price
```

Both read `u.closes[day]` — the identical bar. This means the backtest
computes a signal FROM a closing price and then assumes it can enter
the trade AT that exact same closing price, with zero latency. In live
trading this isn't achievable: a closing price isn't known until the
bar closes, and any real reaction — human or automated — happens after
that moment, not at it. The live `autonomous-agent.ts` system has this
same structural gap in spirit (it scores candidates using the most
recent available bar and then executes near-immediately), but the
backtest makes the assumption absolute and unhedged: no execution delay,
no next-bar entry, no slippage to account for the gap between "signal
generated" and "order filled." This systematically flatters the
backtest's reported returns relative to what a live version of the same
rule would actually achieve, in a way that compounds over every single
trade in the simulation.

**Fix (not done — flagging for a dedicated pass, not attempting inline):**
Enter at `u.closes[day + 1]` (next bar's close) or, more realistically,
next bar's open, rather than the same bar used to generate the score.
This is a real methodology change to the backtest's core loop, not a
one-line fix — it changes every subsequent index calculation in the
function and deserves its own careful review and testing, not a rushed
edit alongside finding it.

**FIXED 2026-08-06.** Extracted the core scoring/entry/exit logic into
a pure, independently testable function (`simulateBacktestDay`,
`src/lib/backtest-simulation.ts`) rather than editing the inline loop —
consistent with this project's standard that any change to trading-
relevant calculations needs real tests, and this one genuinely needed
them given how easy an off-by-one is to introduce here. Entry is now
`opens[day + 1]` (the next trading session's open, the more realistic
of the two options considered above — you see a day's close after the
fact, decide to act, and the earliest achievable fill is the following
session's open) and exit is `closes[day + 1 + holdDays]`. 7 new tests,
including one that hand-computes a full day's simulation (momentum
scoring across two symbols, correct symbol selection, and the exact
entry/exit/return values) and one that explicitly asserts the entry
price is never equal to the scoring price — the precise invariant this
fix exists to guarantee. See `src/lib/__tests__/backtest-simulation.test.ts`.

### 12. `agent-backtest.ts`'s own header comment overclaims what it simulates — "regime alignment" is not implemented

The file's top comment states it "Simulates the autonomous agent's core
rule (momentum + regime alignment)." Grepped the entire file for
"regime" — it appears exactly once, in that comment. There is no regime
detection, no regime-conditional filtering, and no regime-alignment
bonus anywhere in the actual scoring loop; the backtest is pure
momentum-vs-SMA50 ranking with equal-weight sizing. This means the
backtest doesn't actually simulate the live system's core rule as
documented — it simulates a simpler, narrower strategy, and its results
say nothing about the value (or cost) of the regime-alignment logic the
live system actually runs. Not a code bug — the code does exactly what
it does correctly — but a real documentation-vs-implementation mismatch
that could mislead anyone reading the comment and trusting it describes
the simulation's actual scope. Fixed by rewriting the comment to
describe what the function genuinely does, rather than building out
full regime simulation to match the comment's original claim (a much
larger undertaking, and not requested).

### 13. `agent-backtest.ts` has zero slippage or fee modeling — a real inconsistency with the rest of this project's own cost work

Returns are computed as raw `(exit - entry) / entry` — no slippage
(`src/lib/slippage.ts`, built and applied to every real paper trade),
no fees (`src/lib/cost-reality.ts`, same), no bid/ask spread. This means
the backtest's reported win rate, average return, and Sharpe are
systematically more optimistic than what the SAME rule would show once
run through this project's own cost model — a real, direct
inconsistency, since realistic cost modeling for exactly this kind of
analysis already exists elsewhere in the codebase and simply isn't
applied here. Not fixed in this pass — would require piping
`estimateSlippageBps`/`applySlippage`/`estimateFees` through the
backtest's trade loop, a moderate, well-scoped follow-up rather than a
quick inline change.

**FIXED 2026-08-06.** `simulateBacktestDay` now applies
`estimateSlippageBps`/`applySlippage` to both entry and exit, using a
documented `ASSUMED_ORDER_NOTIONAL` constant ($10,000 — this backtest
doesn't track real position sizing, so this is an explicit, reasonable
default, not derived from any specific account) and `isCryptoSymbol`
(reused from `indicators.ts`, not reinvented) to apply the correct
crypto-vs-stock slippage tier. Average daily volume is passed as unknown
for every symbol — this backtest doesn't fetch historical volume data,
so it correctly lands in the conservative "unknown liquidity" tier
rather than assuming best-case liquidity. Fees are deliberately still
NOT modeled: `estimateFees()` only charges for options instruments, and
this backtest's fixed 30-symbol universe never includes any — calling it
would always return $0, so it's omitted with that reasoning documented
directly in the code rather than called pointlessly. 2 new tests added
(on top of updating the existing entry/exit test for the new
slippage-adjusted values): one confirming slippage always makes the
reported return worse than the raw return in both directions (a win
gets smaller, a loss gets larger — never the reverse), and one
confirming crypto symbols get a measurably wider slippage adjustment
than stocks, reflecting the real formula's higher crypto base spread and
liquidity multiplier.

**Combined impact of Findings 11-13, updated 2026-08-06:** All three
findings are now resolved except the strategy-scope limitation noted in
Finding 12's fix (this backtest still only tests momentum-vs-SMA50, not
the full live decision logic — documented directly in the file's own
header comment, not something that needs "fixing" so much as
understanding). Finding 11 (same-bar execution bias) and Finding 13 (no
cost modeling) — the two findings that made the reported numbers
systematically optimistic — are both fixed. `agent-backtest.ts`'s output
is now a meaningfully more credible signal than it was, though it should
still be read as "a realistic simulation of a narrower momentum rule,"
not as evidence about the full live system's actual edge.

---

## Sound, but worth documenting why

- **No look-ahead bias found in the live decision path.** Every fetch
  (`fetchBars`, `fetchQuotePrice`, `fetchVwapBars`) requests data up to
  "now" — there's no code path that could see future bars during live
  scanning, since this is genuinely live, not simulated-over-history.
- **No look-ahead bias found in retroactive regime reconstruction either
  (Stage 3.5 check).** `findRegimeAtDate` (`regime-performance.functions.ts`)
  explicitly slices the fetched SPY history to end AT each trade's own
  entry date before calling `detectMarketRegime` — it structurally cannot
  see bars after that date, since the slice never includes them. Verified
  by reading the slicing logic directly, not assumed.
- **ATR, RSI, MACD, Bollinger Band, Stochastic RSI formulas** were
  re-checked against their standard textbook definitions during this
  pass — all textbook-correct as implemented in `indicators.ts`. This is
  a code-reading confirmation, not a test-suite confirmation (see
  SYSTEM_AUDIT.md's top risk about zero test coverage).
- **VWAP + band calculation** (`computeVwap`) correctly uses volume-
  weighted variance for the bands, not a simple unweighted stdev — this
  is the textbook-correct version, not a shortcut.
- **Timezone handling** for market-hours logic uses `Intl`/
  `toLocaleString` with an explicit `America/New_York` timezone, which
  correctly handles DST transitions automatically via Node's ICU data —
  not manually hardcoded UTC offsets, which would break twice a year.
  Not exhaustively tested across actual DST boundary days in this pass.

---

## Not yet reviewed (explicitly deferred, not silently skipped)

- ~~**`agent-backtest` endpoint correctness**~~ — **REVIEWED 2026-08-06.**
  See Findings 11-13 above: a real same-bar execution bias, a header
  comment that overclaimed regime-alignment simulation (corrected), and
  no slippage/fee modeling despite this project having both built
  elsewhere. Finding 4's survivorship-bias concern also applies to this
  endpoint's fixed 30-symbol universe, as originally suspected. None of
  Findings 11-13 were fixed in this pass except the comment (11 and 13
  are real methodology changes flagged for dedicated follow-up work, not
  quick inline fixes) — but the endpoint is now understood, not unknown.
- **Statistical confidence review of live/paper performance** — cannot
  be done without knowing the actual current closed-trade count. If it's
  in the single or low double digits, no statistical claim of any kind
  should be made yet. This needs an actual query against the live
  database, not an estimate.
- **News/sentiment classification quality** (the earnings-beat detector,
  Robinhood live news context) — the keyword-based bullish/bearish
  classifier in `market.functions.ts` was not re-audited for accuracy in
  this pass.

### Stage 3.5's named empirical questions — genuinely unanswered, not silently skipped

The Stage 3.5 protocol asks specific questions: does Claude outperform
deterministic rules, does adaptive weighting improve returns, does Kelly
improve risk-adjusted performance, does each signal add predictive value,
which regimes generate positive expectancy. **None of these can be
honestly answered right now.** The infrastructure to answer every one of
them exists and is tested (`computeClaudeAttribution`,
`computeLearningAttribution`, `computeSignalContribution`,
`computeRegimePerformance` — all built across Stage 3) — but answering
them requires querying the live database for real accumulated results,
which this review process has no access to. Fabricating a plausible-
sounding answer here would be worse than stating the gap plainly: this
review confirms the MEASUREMENT TOOLS are sound (see Findings 7-10 above
for where they aren't yet, now fixed or documented), not that a
particular conclusion about Claude, adaptive learning, or any signal is
true. `EXPERIMENT_RESULTS.md` remains the authoritative "how to actually
check once data exists" reference for each of these questions.

---

## Bottom line

The individual pieces of trading logic are built with real care and are,
as far as static review can confirm, each internally sound. The honest
gap is between "each piece is well-reasoned" and "the system as a whole
has been shown, with evidence, to work" — that gap can only be closed
with real trade history and time, not more code review. Recommend
treating every stage built this project as **hypotheses under test**,
not **proven improvements**, until enough closed trades exist to check.

**Updated 2026-08-06 (Stage 3.5 pass):** the same principle now applies
to the Stage 3 analytics infrastructure itself, not just the trading
logic — the measurement TOOLS have been reviewed and are sound (one real
gap found and fixed: Regime Performance's missing evidence floor; three
real interpretive limitations documented: Signal Attribution's sizing
circularity, the expanded multiple-comparisons surface, and the
single-benchmark crypto limitation). What the tools will eventually SHOW
about Claude, adaptive learning, and individual signals remains, as of
this writing, completely unknown — and should stay described as unknown
rather than implied by the sheer amount of infrastructure built around
measuring it.
