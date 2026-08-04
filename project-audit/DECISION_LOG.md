# DECISION_LOG.md

Every entry below is a real decision made during this project's
development, not a hypothetical example. Dates are approximate to the
work session in which each decision was made. Per
`ENGINEERING_CONSTITUTION.md` Section 15, any decision resting on an
unproven assumption cites the relevant `HYPOTHESIS_LOG.md` ID.

---

## D-01 — Fractional Kelly (40% of full Kelly), hard-capped at 25%, gated behind a 15-trade minimum

**Date:** 2026-08-04
**Decision:** Position-size Kelly adjustment uses 40% of the
theoretical full-Kelly fraction, never exceeds 25% of the account
regardless of formula output, and does not activate at all until a
signal has 15+ closed trades.

**Alternatives considered:**
- Full Kelly — rejected as too aggressive/high-variance given known
  sensitivity to input estimation error (see H4).
- Fixed-percentage sizing regardless of signal history — rejected
  because it ignores real, accumulating evidence entirely once it
  exists, wasting the value of the Bayesian learning system (H3).
- No minimum sample-size gate — rejected because it would act on
  statistically meaningless samples (a 2-trade "100% win rate" is noise,
  not edge).

**Reason chosen:** Standard risk-management practice for Kelly-based
sizing in the presence of estimation uncertainty — capture most of the
theoretical growth benefit while bounding the damage from being wrong
about the inputs.

**Expected impact:** Position sizes should modestly increase on
signals with demonstrated edge and modestly decrease on signals with
demonstrated weakness, once enough trade history exists per signal.
Currently near-inactive for most/all signals given the 15-trade floor.

**Future review criteria:** Revisit the 40%/25%/15 constants once real
Kelly-influenced trade outcomes exist (see `EXPERIMENTS.md` E-03) —
these numbers were chosen by reasoning from standard practice, not
fit to this system's own data, and should be checked against reality
once that's possible.

**Related hypothesis:** H4 (Kelly Criterion improves risk-adjusted
performance) — unresolved.

---

## D-02 — Kelly sizing uses the single most-observed active signal, not a blend of all active signals

**Date:** 2026-08-04
**Decision:** When multiple tracked signals are active on one proposed
trade, `computeKellySizeMultiplier` uses only the signal with the
largest sample size, not a statistically blended estimate across all
active signals.

**Alternatives considered:**
- Weighted blend across all active signals (weighted by sample size or
  inverse-variance) — a legitimate, more sophisticated approach that was
  deliberately not built.

**Reason chosen:** Correctly combining estimates with different sample
sizes and correlated underlying data (signals often co-occur on the
same trades) is a real, unsolved statistical modeling problem for this
system. The single-signal approach is simpler, more conservative, and
easier to explain and audit than a blended estimate that could look
sophisticated while quietly being wrong.

**Expected impact:** More conservative sizing than an optimal blended
estimator would produce, in exchange for correctness and auditability.

**Future review criteria:** Revisit only if the single-signal approach
is shown, with real evidence, to meaningfully underperform what a
correctly-built blended approach would have done — not on the basis of
the blended approach merely sounding more sophisticated
(`ENGINEERING_CONSTITUTION.md` Section 2, "simplicity" principle).

**Related hypothesis:** H4.

---

## D-03 — Fixed ~150-symbol universe (100 stocks, 30 crypto, 20 ETFs) instead of a dynamic screener

**Date:** Pre-dates this audit; formalized across multiple sessions.
**Decision:** The scan universe is a hardcoded, manually-curated list
rather than a daily-regenerated dynamic screen (e.g., "top 500 by
volume today").

**Alternatives considered:**
- Fully dynamic daily universe by volume/market cap — rejected due to
  unbounded and unpredictable API cost, and because it would make
  day-over-day breadth/correlation comparisons less stable (the
  comparison baseline would itself be shifting).
- A much smaller, narrower universe (e.g., 20–30 symbols) — rejected as
  too limited for meaningful breadth measurement and diversification.

**Reason chosen:** Bounded, predictable API cost per scan; stable
baseline for `computeBreadthScore` and correlation calculations, both of
which depend on comparing against the same universe over time.

**Expected impact:** Predictable operating cost; introduces structural
survivorship bias for any backtest run against this universe (does not
affect forward live/paper decisions — see
`TRADING_ENGINE_REVIEW.md` Finding 4).

**Future review criteria:** Revisit if API budget allows expansion, or
if H7 (universe breadth sufficiency) is tested and shows meaningful
missed opportunity outside the current list.

**Related hypothesis:** H7.

---

## D-04 — Market breadth composite dropped the put/call ratio component rather than approximate it

**Date:** 2026-08-04
**Decision:** `computeBreadthScore` uses a 3-factor composite
(advance/decline ratio 44%, % above SMA50 33%, new-high/low ratio 23%)
instead of the originally-designed 4-factor version that would have
included a market-wide put/call ratio.

**Alternatives considered:**
- Approximate a market-wide put/call ratio from the per-symbol options
  flow data already being fetched for a handful of scanned candidates —
  rejected.
- Pay for/integrate a dedicated market-wide options data feed —
  not pursued, cost/complexity not justified for one sub-component of a
  weighted composite.

**Reason chosen:** The per-symbol options flow data available is not a
representative sample of market-wide put/call positioning — it's
filtered to "unusual activity" on specific candidates, not a market-wide
average. Approximating from mismatched data would produce a number that
*looks* like a real signal while actually being noise, which directly
violates `ENGINEERING_CONSTITUTION.md` Section 2 ("never fake
confidence"). Omitting it and renormalizing the remaining three
weights was the more honest choice.

**Expected impact:** Breadth score is a genuine, defensible 3-factor
measure rather than an inflated 4-factor measure with one fake
component.

**Future review criteria:** Revisit if a real market-wide put/call data
source becomes available at reasonable cost.

**Related hypothesis:** None directly — this was a data-integrity
decision, not a trading-hypothesis decision.

---

## D-05 — Earnings "sell premium" strategies map to credit spreads, not iron condors

**Date:** 2026-08-04
**Decision:** `classifyEarningsStrategy` in `src/lib/earnings-strategy.ts`
recommends `sell_call_spread`/`sell_put_spread` for high-IV/rich-options
setups, never `iron_condor`, despite `iron_condor` being a conceptually
closer match to a "sell premium around earnings" strategy.

**Alternatives considered:**
- Recommend `iron_condor` and fix its execution path first —
  rejected as out of scope for the earnings-strategy feature itself;
  would have blocked shipping a working feature behind an unrelated bug
  fix.
- Delay the earnings-strategy feature entirely until `iron_condor`
  execution is fixed — rejected as unnecessarily conservative given a
  fully-working alternative (credit spreads) already existed.

**Reason chosen:** `iron_condor` is listed in the AI's JSON schema but
does not actually execute correctly (`BUG_TRACKER.md` BUG-003,
`ENGINEERING_CONSTITUTION.md` Section 3's named example of the
prompt/execution mismatch failure mode). Recommending a broken
execution path would have been worse than recommending a working
alternative that captures most of the same strategic intent.

**Expected impact:** Earnings strategy recommendations always execute
correctly. Does NOT fix the underlying gap — Claude can still
independently propose `iron_condor` directly in a normal scan, outside
the earnings-strategy module's control (see BUG-003's open status).

**Future review criteria:** Revisit once `iron_condor` execution is
either fixed or removed from the schema entirely
(`ROADMAP.md` item 8) — at that point credit-spread-only routing may be
loosened back to include true iron condors where they're a better fit.

**Related hypothesis:** None directly.

---

## D-06 — Exit-check AI review uses a lighter model (gemini-2.5-flash) than entry decisions

**Date:** Pre-dates this audit pass; confirmed during Stage 1 exit-check
work, 2026-08-04.
**Decision:** `autonomous-exit-check.ts`'s hold/trim/exit review and
`autonomous-learning.ts`'s weekly summary use `google/gemini-2.5-flash`
via Lovable's gateway, while entry decisions in `autonomous-agent.ts`
use Claude.

**Alternatives considered:**
- Same (more capable, more expensive) model for every AI call —
  rejected as unnecessary cost for a narrower, more structured task.

**Reason chosen:** Exit review is a bounded, structured decision (given
explicit numeric inputs — P&L%, RSI, MACD histogram, days held — decide
hold/trim/exit) that doesn't require the same open-ended reasoning depth
as an entry decision synthesizing full market context. Matching model
cost to task stakes, per `ENGINEERING_CONSTITUTION.md` Section 11.

**Expected impact:** Lower operating cost; faster cycle time, relevant
since exit-check now runs every 10 minutes (see D-07) rather than every
2 hours.

**Future review criteria:** Revisit if exit-decision quality is shown to
be meaningfully worse than entry-decision quality in a way that matters
to outcomes — not merely because a more expensive model is available.

**Related hypothesis:** H2 (Claude vs deterministic rules) is adjacent —
this decision assumes SOME LLM reasoning is valuable for exit decisions
without fully resolving whether it's more valuable than a pure
rule-based hold/trim/exit check would be.

---

## D-07 — Exit-check cadence set to every 10 minutes, not 5 or 15

**Date:** 2026-08-04
**Decision:** The exit-check cron runs every 10 minutes, 24/7 (was
every 2 hours, market-hours-only, before this change).

**Alternatives considered:**
- Every 5 minutes — rejected due to shared Polygon free-tier rate
  limits across every other cron hitting the same API key
  simultaneously; risked cascading rate-limit failures platform-wide.
- Every 15–30 minutes — rejected as still leaving a meaningfully large
  window (up to 30 min) where an adverse price move goes unprotected.

**Reason chosen:** Balance between materially faster loss protection
(12x faster than the previous 2-hour cadence) and not overwhelming the
shared rate-limited API budget.

**Expected impact:** Stop/target/trailing-stop checks are now stale by
at most 10 minutes instead of up to 2 hours; crypto positions gained
exit protection outside US market hours for the first time (previously
zero coverage nights/weekends).

**Future review criteria:** Revisit if the API tier is upgraded
(removing the rate-limit constraint) or if 10-minute staleness is shown
in practice to still be too slow for the observed volatility of open
positions.

**Related hypothesis:** None directly — an infrastructure/risk-control
decision, not a trading-edge hypothesis.

---

## D-08 — "Trim" represented as a new closed-trade row + reduced quantity, not a schema change

**Date:** 2026-08-04
**Decision:** Partial position closes create a genuine new closed
`paper_trades` row for the trimmed portion and reduce the original open
row's `quantity`, rather than adding new columns/tables to track
partial-close state explicitly.

**Alternatives considered:**
- A dedicated partial-close tracking table or additional columns
  (e.g., `original_quantity`, `trimmed_at`) — rejected as unnecessary
  schema complexity given the existing model already supports this.

**Reason chosen:** `paper_trades` already follows a one-row-per-
quantity-lot pattern (e.g., scale-ins already create separate rows).
Trims fit the same pattern with zero schema changes required.

**Expected impact:** Trims are fully queryable, real trade history —
they show up correctly in `ClosedTradesHistory`, feed
`agent_signal_weights` learning with their own realized P&L%, and
require no new UI logic beyond what already reads `paper_trades`.

**Future review criteria:** Revisit if a future feature needs to track
a position's full multi-trim lineage as an explicitly linked chain
(e.g., "this row is 50% of original position X") rather than
independent, unlinked rows — the current model doesn't preserve that
lineage explicitly, only implicitly via matching asset/timing.

**Related hypothesis:** None directly.

---

## D-09 — Governance documents split between `/project-audit/` (point-in-time findings) and repo root (permanent constitution)

**Date:** 2026-08-04
**Decision:** `ENGINEERING_CONSTITUTION.md` lives at repo root;
`SYSTEM_AUDIT.md`, `BUG_TRACKER.md`, `SECURITY_AUDIT.md`,
`TRADING_ENGINE_REVIEW.md`, `ROADMAP.md`, `HYPOTHESIS_LOG.md`,
`DECISION_LOG.md`, `TECHNICAL_DEBT.md`, and `EXPERIMENTS.md` live in
`/project-audit/`.

**Alternatives considered:**
- Everything in one folder — rejected, blurs the distinction between
  "what we believe and require" (constitution, rarely changes) and
  "what we currently know" (audit documents, updated every pass).
- Everything at repo root — rejected, clutters the root with documents
  of very different update cadences and purposes.

**Reason chosen:** Clear separation of concerns: the constitution is
the stable reference; the audit folder is the living, frequently-updated
record it's grounded in.

**Expected impact:** Future agents/developers know where to look for
which kind of information without needing to read every file to
determine its purpose.

**Future review criteria:** N/A — organizational choice, revisit only if
this split proves confusing in practice.

**Related hypothesis:** None.
