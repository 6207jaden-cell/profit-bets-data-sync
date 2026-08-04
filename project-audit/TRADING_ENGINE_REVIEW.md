# TRADING_ENGINE_REVIEW.md
Last updated: 2026-08-04 (Pass 1)

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

## Sound, but worth documenting why

- **No look-ahead bias found in the live decision path.** Every fetch
  (`fetchBars`, `fetchQuotePrice`, `fetchVwapBars`) requests data up to
  "now" — there's no code path that could see future bars during live
  scanning, since this is genuinely live, not simulated-over-history.
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

- **`agent-backtest` endpoint correctness** — this project has a backtest
  engine referenced throughout its history but this specific audit pass
  has not read it line-by-line for look-ahead bias, incorrect date
  handling, or optimistic fill assumptions. Given Finding 4 above
  (survivorship bias) already applies to whatever it measures, this
  needs its own dedicated review before its output is treated as
  meaningful evidence of edge.
- **Statistical confidence review of live/paper performance** — cannot
  be done without knowing the actual current closed-trade count. If it's
  in the single or low double digits, no statistical claim of any kind
  should be made yet. This needs an actual query against the live
  database, not an estimate.
- **News/sentiment classification quality** (the earnings-beat detector,
  Robinhood live news context) — the keyword-based bullish/bearish
  classifier in `market.functions.ts` was not re-audited for accuracy in
  this pass.

---

## Bottom line

The individual pieces of trading logic are built with real care and are,
as far as static review can confirm, each internally sound. The honest
gap is between "each piece is well-reasoned" and "the system as a whole
has been shown, with evidence, to work" — that gap can only be closed
with real trade history and time, not more code review. Recommend
treating every stage built this project as **hypotheses under test**,
not **proven improvements**, until enough closed trades exist to check.
