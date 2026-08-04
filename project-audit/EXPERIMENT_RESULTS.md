# EXPERIMENT_RESULTS.md

Status as of 2026-08-05: **infrastructure built and verified for all four
experiments below. Zero results exist yet for any of them.** This is
stated plainly rather than filled with placeholder numbers, per
`ENGINEERING_CONSTITUTION.md` Section 2 ("never fake confidence") — every
experiment needs either accumulated trade volume or a resolution horizon
(1–4 days depending on session type) to pass before its first row becomes
eligible for analysis. Nothing has had that time yet.

This document will be updated with real numbers as they become available.
Per `ENGINEERING_CONSTITUTION.md`'s cross-reference discipline, when an
experiment here produces a result, the corresponding `HYPOTHESIS_LOG.md`
entry's confidence and conclusion must be updated in the same change.

---

## Experiment 1 — Claude Value Test

**Status:** Infrastructure live since commit `784852f`. Logging on every
scan; resolution cron (`resolve-shadow-experiments`, runs daily 5am UTC)
active.

**What's being collected:** `shadow_candidate_log` — every candidate
shown to Claude, its deterministic rank (1 = top by combined bull/bear
score × confidence), whether Claude traded it, and an agreement
classification (`agree_traded` / `disagree_claude_skipped` /
`disagree_claude_added` / `agree_skipped`).

**How to read results once they exist:** Query `shadow_candidate_log`
where `resolved = true`, grouped by `agreement`. The key comparison:
average `hypothetical_return_pct` for `agree_traded` + `disagree_
claude_added` (Claude's actual picks, using real outcomes where
`actual_trade_id` is set) versus what the deterministic top-6 would have
returned in aggregate (`disagree_claude_skipped` rows' hypothetical
returns, representing what was left on the table).

**Minimum sample before any conclusion:** No fewer than 30 resolved rows
per comparison group — below that, a difference either direction is not
distinguishable from noise given typical trade-outcome variance.

**Results:** None yet. First rows become resolution-eligible 1–4 days
after logging began (2026-08-05), depending on session type.

---

## Experiment 2 — Adaptive Learning Test

**Status:** Infrastructure live since commit `c892f06`. Same daily
resolution cron covers this table alongside Experiment 1's.

**What's being collected:** `shadow_weighting_comparison` — every
candidate scored twice per scan (real adaptive weights vs. hypothetical
neutral weights, reusing the identical `applySignalWeights` function for
both), with `rank_delta` capturing how much adaptive weighting moved a
candidate's rank relative to neutral.

**How to read results once they exist:** Split resolved rows into two
buckets by `rank_delta` sign: adaptive-promoted (`rank_delta > 0`) and
adaptive-demoted (`rank_delta < 0`). Compare average
`hypothetical_return_pct` between the two buckets. If promoted candidates
outperform demoted ones by a meaningful margin, that's real evidence the
learning system has signal. If there's no difference — or promoted
candidates do worse — that directly supports the multiple-comparisons
concern already documented in `TECHNICAL_DEBT.md` TD-10.

**Important interpretive note:** Because adaptive weighting is currently
near-neutral for most signals (few have crossed the 15-trade Kelly
threshold as of this writing), `rank_delta` is expected to be small for
most candidates early on. A meaningful test of this hypothesis requires
waiting until enough signals have real, non-neutral weights — checking
this too early will show "no difference" for the trivial reason that
adaptive and neutral are nearly the same thing right now, not because
the mechanism doesn't work.

**Results:** None yet.

---

## Experiment 3 — Trading Cost Reality Test

**Status:** Infrastructure live since commit `64885fc`. Cost fields
(`entry_quoted_price`, `exit_quoted_price`, `entry_slippage_bps`,
`exit_slippage_bps`, `estimated_fees`) populate on every new trade going
forward — no resolution job needed, since this data is already complete
at trade close, not deferred.

**What's being collected:** Every closed trade now carries both its
pre-slippage "quoted" prices and its actual post-slippage realized
prices, plus a modeled fee.

**How to read results once enough trades exist:** Call
`computeCostRealityReport(trades)` from `src/lib/cost-reality.ts` against
closed `paper_trades` — it groups by session type (scalp/swing/crypto/
other, parsed from rationale tags) and reports `avgGrossReturnPct`
(before slippage/fees), `avgNetReturnPct` (after — the real number), and
`stillPositiveAfterCosts` per group. This directly answers the question
Experiment 3 exists for.

**Minimum sample before any conclusion:** At least 20 trades per session
type with cost data populated (`tradesWithCostData` in the report output)
— fewer than that and the gross/net comparison is too noisy to trust,
especially for scalp trades where the whole concern is a THIN margin
being eaten by costs; a thin margin estimated from 5 trades is not
distinguishable from randomness.

**Results:** None yet — zero trades have cost data populated as of this
writing, since the fields only started being written going forward from
commit `64885fc`.

---

## Experiment 4 — Signal Contribution Analysis

**Status:** Infrastructure live since commit `cb7dda4`.

**What's being collected:** `agent_signal_weights` now tracks both
present-side (already existed, feeds real scoring) and absent-side
(new, pure observation, never feeds scoring) Bayesian win-rate and
average-return stats for all 18 tracked signals.

**How to read results once enough trades exist:** Call
`computeSignalContribution(supabaseAdmin, userId)` from
`src/lib/signal-learning.ts` — returns, per signal, `contributionPct`
(present-side average return minus absent-side average return) and
`hasMinimumEvidence` (both sides ≥10 samples). A signal with a
consistently positive `contributionPct` and `hasMinimumEvidence: true`
is showing real evidence of adding value; near-zero or negative
contribution with sufficient evidence is real evidence it isn't.

**Interpretive caveats, stated up front:**
- For the 5 mutually-exclusive signal pairs (flagged via
  `isMutuallyExclusivePair` in the report), "absent" conflates the
  neutral zone and the opposite extreme — read these results with that
  in mind, not as a clean two-way split.
- `hasMinimumEvidence`'s 10-sample floor is a "don't over-read this yet"
  gate, not a statistical significance test.
- Per `TECHNICAL_DEBT.md` TD-10, with 18 signals tracked simultaneously,
  at least one showing a spuriously high `contributionPct` by chance
  alone is statistically expected even under a true null. Do not act on
  a single standout signal without checking whether its result replicates
  over a later, independent sample.

**Results:** None yet.

---

## What NOT to do with this document

Per the explicit instruction for this phase: **do not use any result
here to automatically adjust a weight, a threshold, or a sizing
parameter.** These experiments exist to produce evidence for
`HYPOTHESIS_LOG.md` and inform future, deliberate decisions logged in
`DECISION_LOG.md` — not to trigger automatic optimization. When a result
here is strong enough to justify a change, that change should be made
explicitly, documented as its own `DECISION_LOG.md` entry citing this
document, and treated with the same scrutiny as any other change to the
position-sizing or scoring chain per `ENGINEERING_CONSTITUTION.md`
Section 6.
