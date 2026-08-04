# EXPERIMENTS.md

A scientific testing framework for this trading system. Every experiment
below is real and tied to a specific open hypothesis in
`HYPOTHESIS_LOG.md` — none are hypothetical examples. As of this
writing, **no experiment below has actually been run** — this file
documents the planned methodology so that when each becomes possible
(most require either real test infrastructure or accumulated trade
volume that doesn't exist yet), it's executed against a pre-committed
design rather than an after-the-fact rationalization of whatever the
data happens to show. That ordering — design before data — is the whole
point of this document existing separately from `HYPOTHESIS_LOG.md`.

**Required fields for every experiment:** objective, hypothesis (cross-
referenced to `HYPOTHESIS_LOG.md`), variables changed, baseline
comparison, success metrics, failure criteria, results (populated only
once the experiment actually runs).

---

## E-01 — Claude-driven selection vs. pure deterministic ranking

**Objective:** Determine whether Claude's trade selection outperforms
simply trading the top-N candidates by `bullScore`/`bearScore` with no
LLM decision step.

**Hypothesis:** H2 — "Claude adds value compared to deterministic rules
alone."

**Variables changed:** None traded — this is a shadow-logging
experiment. For every scan, log what the deterministic top-N ranking
would have selected (symbol, direction, implied size) alongside what
Claude actually selected and traded, without acting on the shadow picks.

**Baseline comparison:** Claude's actual realized trades vs. the
shadow deterministic picks' hypothetical realized outcomes (marked to
market using the same exit logic that would have applied).

**Success metrics:** Claude's picks show meaningfully better risk-
adjusted return (once `PerformanceMetricsPanel` exists — see
`TECHNICAL_DEBT.md` TD-12 — Sharpe/Sortino comparison, not just raw
P&L) than the shadow deterministic picks, over a sample large enough for
the difference to not plausibly be noise.

**Failure criteria:** Shadow deterministic picks perform equal to or
better than Claude's actual picks, or the difference is too small
relative to sample size to distinguish from noise.

**Prerequisite:** Shadow-logging infrastructure does not exist yet —
needs to be built before this experiment can run. Does not require
waiting for `PerformanceMetricsPanel` to START (raw P&L comparison can
begin immediately), but a confident conclusion requires it.

**Results:** Not yet run.

---

## E-02 — Adaptive signal weighting ON vs. OFF

**Objective:** Determine whether the Bayesian per-signal weight learning
system (`agent_signal_weights`, `applySignalWeights`) improves aggregate
outcomes versus static, neutral (1.0x) weights for all signals.

**Hypothesis:** H3 — "Adaptive signal weighting improves returns."

**Variables changed:** A feature flag forcing `applySignalWeights` to
treat every signal as weight 1.0 regardless of stored history, for a
defined period, compared against the system running normally
(adaptive weights active) for a matched period.

**Baseline comparison:** Aggregate P&L and win rate during the
weights-forced-neutral period vs. the adaptive-weights-active period,
matched as closely as possible for market regime (ideally alternating
weeks or a similar interleaving, not two arbitrary sequential blocks
that could differ for unrelated regime reasons).

**Success metrics:** Adaptive weighting period shows better risk-
adjusted performance by a margin unlikely to be explained by regime
difference alone.

**Failure criteria:** No meaningful difference, or the neutral-weights
period performs better — the latter would specifically support the
multiple-comparisons concern in `TECHNICAL_DEBT.md` TD-10.

**Prerequisite:** A feature flag for this doesn't exist yet — needs to
be built. Also requires enough trade volume per signal for the adaptive
mechanism to actually be active during its "ON" period (see H3 — most
signals are currently near the 15-trade Kelly floor or below).

**Results:** Not yet run.

---

## E-03 — Kelly-sized trades vs. flat-sized shadow control

**Objective:** Determine whether Kelly Criterion position sizing
(`computeKellySizeMultiplier`) improves risk-adjusted performance
versus flat, signal-agnostic sizing.

**Hypothesis:** H4 — "Kelly Criterion improves risk-adjusted
performance."

**Variables changed:** None traded — log the Kelly multiplier that was
actually applied to each trade alongside what the position size would
have been at a flat baseline (e.g., the AI's raw proposed
`allocation_pct` with `kelly.multiplier` fixed at 1.0), without altering
what's actually traded.

**Baseline comparison:** Realized portfolio growth and maximum drawdown
under actual Kelly-adjusted sizing vs. the hypothetical flat-sizing
shadow, computed from the same entries/exits.

**Success metrics:** Kelly-adjusted sizing shows better risk-adjusted
growth (higher return per unit of drawdown) than flat sizing, and
critically, this should be checked separately for trades where Kelly
was actually active (signal had 15+ trades) vs. inactive (where the
comparison is meaningless since Kelly multiplier was 1.0 anyway).

**Failure criteria:** Kelly-adjusted sizing shows worse or equal
risk-adjusted growth, or (a specific concern named in H4) shows better
raw return but worse drawdown — meaning it's increasing variance rather
than improving the risk/return tradeoff, the opposite of Kelly's
theoretical purpose.

**Prerequisite:** Needs real Kelly-active trades — currently gated
behind 15+ trades per signal, likely not yet met for most signals.

**Results:** Not yet run.

---

## E-04 — ATR-calibrated stops vs. shadow fixed-percentage stops

**Objective:** Determine whether ATR-calibrated stop/target distances
(`atrBasedStopTarget`) outperform the fixed-percentage stops used
before this project's Stage 1 work.

**Hypothesis:** H5 — "ATR-calibrated stops outperform fixed-percentage
stops."

**Variables changed:** None traded — for every open position, compute
and log what a fixed-percentage stop (matching the pre-Stage-1 defaults:
6% stop / 12% target for swing, session-appropriate equivalents for
scalp/crypto) would have triggered and when, alongside the real
ATR-calibrated stop's actual trigger, without acting on the shadow
value.

**Baseline comparison:** Realized P&L under actual ATR-based exits vs.
hypothetical P&L under shadow fixed-percentage exits, for the same set
of entries.

**Success metrics:** ATR-based exits show better aggregate realized P&L
and/or meaningfully fewer premature stop-outs on volatile names without
a corresponding increase in max-loss-per-trade on stable names.

**Failure criteria:** No meaningful difference, or ATR-based exits
underperform the fixed-percentage shadow — would suggest the
volatility-calibration logic itself needs revisiting despite strong
external precedent for the general approach.

**Prerequisite:** Shadow fixed-stop calculation logic doesn't exist yet
— needs to be built as a parallel, non-acted-upon calculation.

**Results:** Not yet run.

---

## E-05 — Correlation-based sizing gate ON vs. OFF

**Objective:** Determine whether the correlation-based position-size
reduction (`computeCorrelation`, 0.75/0.90 thresholds) reduces
portfolio-level risk more than it costs in foregone returns.

**Hypothesis:** H6 — "Correlation-based position sizing reduces
portfolio risk without materially reducing returns."

**Variables changed:** A feature flag forcing `correlationMult` to
always equal 1.0 (gate disabled) for a defined period, compared against
normal operation for a matched period.

**Baseline comparison:** Realized portfolio volatility (standard
deviation of daily returns) and maximum drawdown, gate-off period vs.
gate-on period.

**Success metrics:** Gate-on period shows meaningfully lower portfolio
volatility/drawdown without a proportionally larger reduction in
returns.

**Failure criteria:** No meaningful risk reduction from the gate (would
support the "10-day lookback is too noisy to detect real correlation"
concern in `TECHNICAL_DEBT.md` TD-11), or a large return cost relative
to whatever risk reduction is observed.

**Prerequisite:** Feature flag doesn't exist yet.

**Results:** Not yet run.

---

## E-06 — Fixed 150-symbol universe vs. a wider comparison universe

**Objective:** Determine whether the current fixed universe misses
meaningful opportunities that a wider universe would capture.

**Hypothesis:** H7 — "The fixed ~150-symbol universe is broad enough to
avoid meaningful missed-opportunity cost."

**Variables changed:** None traded — periodically score a wider
universe (e.g., top 500 by volume) using the same scoring pipeline,
purely for comparison, without adding it to the tradeable universe.

**Baseline comparison:** How often (and how highly) symbols outside the
current 150 would have scored, relative to the actual top-scoring
candidates within the current universe.

**Success metrics:** High-scoring candidates outside the current 150 are
rare and/or not meaningfully higher-scoring than the current universe's
top candidates — supports keeping the universe as-is.

**Failure criteria:** Frequent, meaningfully-higher-scoring candidates
found outside the current universe — would support expanding it despite
the added API cost.

**Prerequisite:** Requires either a higher API tier or a bounded,
periodic (not continuous) wider scan to control cost during the
experiment itself.

**Results:** Not yet run.

---

## E-07 — Slippage model calibration against real live fills

**Objective:** Determine whether `estimateSlippageBps`'s modeled fill
prices are close enough to real execution costs to make paper P&L a
reliable predictor of live P&L.

**Hypothesis:** H8 — "The slippage model approximates real execution
costs closely enough for paper P&L to predict live P&L."

**Variables changed:** None — for every live-mode (real Robinhood)
trade, log the actual fill price received alongside what the paper-mode
slippage model would have estimated for an equivalent hypothetical
trade at the same size and time.

**Baseline comparison:** Modeled slippage estimate vs. actual realized
slippage (difference between the quote at decision time and the actual
fill), per trade and in aggregate.

**Success metrics:** Modeled and actual slippage track closely enough
(within a reasonable tolerance, to be defined once real data exists to
calibrate what "reasonable" means for this system) that no recalibration
is needed.

**Failure criteria:** A persistent, directional gap between modeled and
actual slippage (e.g., real slippage consistently worse than modeled) —
would require recalibrating the liquidity-tier multipliers and base
spread constants in `slippage.ts`.

**Prerequisite:** Requires live-mode trading to actually be active —
cannot run in pure paper mode by definition.

**Results:** Not yet run.

---

## Discipline for adding new experiments

Per `ENGINEERING_CONSTITUTION.md` Section 17 (the Skeptic Rule) and
Section 13 (feature development rules), any new hypothesis added to
`HYPOTHESIS_LOG.md` should get a corresponding entry here describing how
it would actually be tested — even if the honest prerequisite is "not
possible yet, needs N more weeks of data" — rather than left as an
untestable belief.
