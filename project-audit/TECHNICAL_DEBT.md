# TECHNICAL_DEBT.md

Every item below is a real, currently-existing gap in this codebase —
not a hypothetical risk. Severity and priority follow
`ENGINEERING_CONSTITUTION.md`'s Critical/High/Medium/Low framework and
`ROADMAP.md`'s sequencing. This file is the single consolidated list;
`BUG_TRACKER.md` covers the same authorization/dependency items in more
implementation-level detail where relevant.

---

## TD-01 — Zero automated test coverage

**Severity:** Critical
**Impact:** Every trading-math function in `src/lib/` (ATR, correlation,
Kelly sizing, VWAP bands, slippage, Bayesian weight updates, breadth
scoring) has been verified only by human code review, TypeScript
compilation, and production build success — never by an automated
assertion checking a computed value against a known-correct expected
value. A silent regression in any of this math (a sign flip, an
off-by-one in a lookback window, a unit mismatch) could ship undetected
indefinitely.
**Workaround:** None — manual review and the layered deterministic guard
chain provide some defense in depth, but neither substitutes for a test
asserting the math itself is correct.
**Recommended solution:** Install Vitest (best fit given the existing
Vite build). Start with the 7 pure functions listed in
`ENGINEERING_CONSTITUTION.md` Section 8 as mandatory first targets.
**Status:** RESOLVED (Stage 1.5, 2026-08-05). Vitest installed, all 7
mandatory targets covered, later grew to 186 tests across 19 files as
Stage 2/3 work added more. Every test asserts a hand-computed expected
value, not just "does it run." Found and fixed 2 real bugs along the
way (see `CHANGELOG.md`'s Stage 1.5 entry): a real 127-error TypeScript
regression that had been silently accumulating, plus a genuine runtime
bug (`updateSignalWeights` called but never imported in the
circuit-breaker path).
**Priority:** Was Critical / immediate. Resolved.

---

## TD-02 — `evaluate-alerts.ts` has no authorization check

**Severity:** Critical
**Impact:** Anyone who discovers the endpoint URL can trigger
service-role-privileged execution with no authentication and no rate
limit. See `SECURITY_AUDIT.md` Finding 1 and `BUG_TRACKER.md` BUG-001.
**Workaround:** None currently in place.
**Recommended solution:** Add the standard
`apikey !== process.env.SUPABASE_PUBLISHABLE_KEY` guard used by every
sibling cron endpoint.
**Status:** RESOLVED (Stage 2, Priority 1, 2026-08-05). Fixed using a
new shared, tested utility (`src/lib/api-auth.ts`) rather than a one-off
inline check — see `SECURITY_AUDIT.md` Finding 1 (also corrected to
FIXED) and `CHANGELOG.md`.
**Priority:** Was Critical / immediate. Resolved.

---

## TD-03 — `sync-crons.ts` authorization check verifies presence, not correctness

**Severity:** High
**Impact:** Any non-empty `apikey` header value passes the check; the
actual key is never compared. See `SECURITY_AUDIT.md` Finding 2 and
`BUG_TRACKER.md` BUG-002.
**Workaround:** None.
**Recommended solution:** Change `if (!apikey)` to
`if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY)`.
**Status:** RESOLVED (Stage 2, Priority 2, 2026-08-05). Fixed using the
same shared utility as TD-02, deliberately — this bug and TD-02 shared
the same root cause (inline, duplicated auth checks with no single
source of truth). See `SECURITY_AUDIT.md` Finding 2 (also corrected to
FIXED).
**Priority:** Was High. Resolved.

---

## TD-04 — No application-level rate limiting anywhere

**Severity:** Was Critical while TD-02/TD-03 were open (now both
resolved); High in isolation, as originally scoped.
**Impact:** Every endpoint, correctly-authorized or not, can be called
at unlimited frequency. Compounded directly with TD-02 and TD-03 while
those were open.
**Workaround:** None.
**Recommended solution:** Token-bucket or fixed-window rate limiting,
either platform-level or a lightweight Postgres-table-backed
implementation.
**Status:** RESOLVED (Stage 2, Priority 3, 2026-08-05). Built as shared,
reusable, tested infrastructure (`src/lib/rate-limit.ts`) — Postgres-
backed, atomic via row-locking to avoid a real race condition under
concurrent cron overlaps — applied to all 15 `/api/public/*` endpoints,
each with a limit reasoned from its actual cron cadence. See
`SECURITY_AUDIT.md` Finding 4 (also corrected to FIXED) and
`CHANGELOG.md`.
**Priority:** Was Critical (given the TD-02/TD-03 interaction). Resolved.

---

## TD-05 — `iron_condor` is AI-selectable but not executable

**Severity:** Was Medium.
**Impact:** If Claude proposes `instrument: "iron_condor"` outside the
earnings-strategy module's control, the trade silently falls through to
incorrect stock-style position math instead of real 4-leg options
execution, producing a nonsensical position and wrong P&L.
**Workaround:** The earnings-strategy module routes its own
recommendations to credit spreads instead (`DECISION_LOG.md` D-05) —
prevents the bug from being triggered by that specific path only, not
the underlying gap for any other path.
**Recommended solution:** Either remove `"iron_condor"` from the AI's
JSON schema until real multi-leg execution exists, or build that
execution properly.
**Status:** RESOLVED (2026-08-06). Removed from the schema — real 4-leg
execution was out of scope and remains genuinely unbuilt if ever wanted
as a feature. Also fixed the root cause: the schema enum and the
execution math's options-check were two independently-maintained lists
that had drifted, which is what let this exist. Consolidated into a
single shared source of truth (`src/lib/instruments.ts`), closing the
drift risk generally, not just this one instance — a third duplicate
list was found and fixed along the way in `snapshot-portfolio.ts`. See
`BUG_TRACKER.md` BUG-003 for full detail, including one verification
step NOT performed (checking historical `paper_trades` for any
`iron_condor` rows that may have already fired) since it requires live
database access this process doesn't have.
**Priority:** Was Medium. Resolved.

---

## TD-06 — 2 known CVEs in production dependencies

**Severity:** High
**Impact:** `js-yaml` (quadratic-CPU DoS vector) and `postcss`
(arbitrary `.map` file disclosure via path traversal) — verified via
`npm audit --omit=dev`. See `SECURITY_AUDIT.md` Finding 6.
**Workaround:** None needed — resolved.
**Recommended solution:** `npm audit fix`, then re-verify `tsc --noEmit`
and production build before considering this closed.
**Status:** RESOLVED 2026-08-05 (Stage 2, Priority 4). 0 vulnerabilities.
**Priority:** Was High — `ROADMAP.md` item 5, now complete.

---

## TD-07 — No staleness check on price data across the fallback chain

**Severity:** Medium
**Impact:** `fetchQuotePrice`'s Yahoo → Finnhub → Polygon → Alpha
Vantage fallback chain returns the first successful response with no
timestamp/staleness validation.
**Workaround:** None.
**Recommended solution:** Add a staleness check; log a warning at
minimum when a fallback source is used, even before automated rejection
is built.
**Priority:** Medium — `ROADMAP.md` item 10.

---

## TD-08 — No cron-overlap guard

**Severity:** Medium
**Impact:** Scalp, crypto, and exit-check crons run on overlapping
schedules with no explicit "already running, skip this invocation"
lock. No confirmed incident, but no protection against it either.
**Workaround:** Postgres-level constraints likely prevent the worst
outcomes, but this has not been verified as a deliberate safeguard.
**Recommended solution:** A small `cron_locks` table with a TTL,
checked at the start of each relevant cron invocation.
**Priority:** Medium — `ROADMAP.md` item 11.

---

## TD-09 — `.env` tracked in git

**Severity:** Low (verified contents are publishable/anon-safe, not
secret)
**Impact:** Bad hygiene precedent — a future genuinely-secret value
could be added to this same file and committed by habit.
**Workaround:** None needed given current contents, but the underlying
gitignore gap remains.
**Recommended solution:** Add `.env` to `.gitignore`,
`git rm --cached .env`, verify deploy still works afterward.
**Priority:** Low — `ROADMAP.md` item 9.

---

## TD-10 — No multiple-comparisons correction in the per-signal Bayesian learning system

**Severity:** Medium (statistical/methodological debt, not a bug)
**Impact:** With ~18 independently-tracked signals, at least one
showing a spuriously high win rate purely by chance is statistically
likely even under a true null. See H3 in `HYPOTHESIS_LOG.md` and
`TRADING_ENGINE_REVIEW.md` Finding 1.
**Workaround:** The Beta(1,1) prior's shrinkage toward neutral and the
15-trade Kelly-activation floor both reduce, without eliminating, this
risk.
**Recommended solution:** Consider a formal correction once real data
volume exists to evaluate whether this is a practical problem, rather
than fixing it preemptively based on theory alone.
**Priority:** Medium — `ROADMAP.md` item 16.

---

## TD-11 — Correlation lookback windows (10–30 days) are statistically thin

**Severity:** Low-Medium
**Impact:** A Pearson correlation computed from 10 daily return
observations carries a large standard error. See H6 in
`HYPOTHESIS_LOG.md` and `TRADING_ENGINE_REVIEW.md` Finding 3.
**Workaround:** The existing `len < 8` null-return guard prevents the
most extreme small-sample cases, not the noise in the 8–15 range.
**Recommended solution:** Consider a wider default floor if false
correlation-based rejections/approvals are shown to be common in
practice.
**Priority:** Low-Medium — add to numbered roadmap once H6 is tested.

---

## TD-12 — No risk-adjusted performance metrics computed anywhere

**Severity:** High (foundational)
**Impact:** No Sharpe ratio, Sortino ratio, standalone maximum
drawdown, expectancy, or profit factor exists anywhere in the product.
The single most important question — "is this system actually better
than randomly investing in the market?" — currently cannot be answered
by anything the product shows.
**Workaround:** None — missing capability, not a partial fix.
**Recommended solution:** Build a `PerformanceMetricsPanel` computing
the above from `paper_trades`, with sample size shown alongside every
metric and a real benchmark comparison.
**Status:** RESOLVED for the core + benchmark comparison, 2026-08-05
(Stage 3, first slice + second slice same day). Sharpe, Sortino, max
drawdown, profit factor, expectancy, avg win/loss, win rate with a real
Wilson-score confidence interval, AND Beta/Alpha/correlation-to-SPY now
all exist (`src/lib/performance-metrics.ts`, 34 tests,
`src/lib/benchmark-comparison.functions.ts`, `PerformanceMetricsPanel`
in the History tab). The benchmark comparison uses REAL daily-aligned
data — `portfolio_snapshots` matched by calendar date against SPY's own
daily closes, not a synthetic approximation — since Beta/Alpha
specifically need genuine calendar-time alignment to mean anything.
Every figure shown alongside its sample size, with explicit "provisional,
not enough data yet" warnings below the evidence floor. Still open,
genuinely separate work: rolling metrics (rolling Sharpe/correlation over
time), exposure, holding-time/trade distribution, regime-conditional
performance, and all four attribution categories (portfolio/signal/
Claude/learning) from the full Stage 3 list.

**Update 2026-08-05 (same day, third slice):** Signal Attribution and
Claude Attribution — 2 of the 4 attribution categories — now also exist,
built by extending already-tested infrastructure rather than starting
from scratch: `computeSignalAttribution` (dollar P&L decomposition by
signal, `signal-learning.ts`) and `computeClaudeAttribution` (head-to-head
comparison of Claude's actual picks vs. what pure deterministic ranking
alone would have captured, `shadow-experiments.ts`, directly
operationalizing `HYPOTHESIS_LOG.md` H2 using data Experiment 1 has
already been collecting). Both surfaced in a new `AttributionPanel`.

**Update 2026-08-05 (same day, fourth slice):** Learning Attribution —
the 3rd of 4 attribution categories — also now exists
(`computeLearningAttribution`, `shadow-experiments.ts`), directly
operationalizing `HYPOTHESIS_LOG.md` H3 using Experiment 2's already-
collecting `shadow_weighting_comparison` data. Only Portfolio Attribution
remains of the original 4, plus rolling metrics, exposure, holding-time
distribution, and regime-conditional performance.

**Update 2026-08-05 (same day, fifth slice):** Portfolio Attribution —
the 4th and last of the 4 original attribution categories — now exists
(`computePortfolioAttribution`, new `src/lib/portfolio-attribution.ts`),
decomposing realized P&L by symbol and by asset class
(stock/etf/crypto/options). Unlike Signal Attribution, this IS a true
partition — every trade has exactly one symbol and one asset class, so
percentages sum to exactly 100%, not more — documented as a deliberate
contrast in both the code and the test suite. **All four attribution
categories are now built.**

**Update 2026-08-05 (same day, sixth slice):** Rolling win-rate/Sharpe/
Sortino now exist (`computeRollingMetrics`, `computeRollingTrend`,
`performance-metrics.ts`), shown as a trend chart in
`PerformanceMetricsPanel` — a single aggregate Sharpe number can hide a
strategy that's currently improving or deteriorating; this shows the
trend directly. Reuses the existing tested Sharpe/Sortino formulas
rather than re-deriving them. What remains of the full Stage 3 list:
rolling correlation specifically (Beta/Alpha rolling over time, not yet
built — only win-rate/Sharpe/Sortino roll so far), exposure,
holding-time/trade distribution, and regime-conditional performance.

**Update 2026-08-05 (same day, seventh slice):** Trade Distribution now
exists — `computeReturnDistribution` and `computeHoldingTimeDistribution`
(`performance-metrics.ts`), shown as two histograms in
`PerformanceMetricsPanel`. Fixed, documented bucket boundaries (not
data-dependent bins) so results are comparable across report runs. Both
are true partitions — bucket percentages sum to exactly 100%. What
remains of the full Stage 3 list: rolling correlation/Beta/Alpha,
exposure (cash vs. deployed, concentration), and regime-conditional
performance.

**Update 2026-08-05 (same day, eighth slice):** Exposure now exists
(`computeExposure`, new `src/lib/exposure.ts`) — a genuinely different
data shape than everything else built in Stage 3: reads CURRENT open
positions and current portfolio balance, not historical closed trades.
Shows cash vs. deployed capital and concentration via the
Herfindahl-Hirschman Index (standard concentration measure, same formula
used in antitrust economics for market concentration, applied here to
position sizing). Uses entry value as the position-size basis
(quantity × entry_price), not live mark-to-market — documented as a
deliberate tradeoff avoiding a live-quote fetch on every panel load.
New `ExposurePanel`, placed at the top of the History tab since "how am
I positioned right now" is naturally the first question before diving
into historical performance. What remains of the full Stage 3 list:
rolling correlation/Beta/Alpha and regime-conditional performance — the
last two items.

**Update 2026-08-05 (same day, ninth slice — FINAL):** Both remaining
items are now built.

*Rolling correlation/Beta/Alpha* (`computeRollingBenchmarkMetrics`,
`performance-metrics.ts`): extends the rolling-metrics infrastructure to
market exposure over time, reusing `computeBeta`/`computeAlpha`/
`computeDailyReturns`/`computeCorrelation` directly rather than
re-deriving any formula. Wired into `benchmark-comparison.functions.ts`
(20-day window) and shown as a rolling Beta chart in
`PerformanceMetricsPanel`. Caught a real, worth-documenting constraint
while testing: `computeCorrelation` has its own internal floor of ≥10
value points — a window smaller than that silently returns null
correlation (Beta/Alpha still compute fine, since they have no such
floor) — now documented directly in the function's own docstring rather
than left as a surprise.

*Regime-Conditional Performance* (`computeRegimePerformance`,
`performance-metrics.ts`, new `src/lib/regime-performance.functions.ts`):
a real design decision made and documented — regime is reconstructed
RETROACTIVELY from historical SPY data by re-running the exact same live
`detectMarketRegime` (indicators.ts) algorithm against a date-sliced view
of one broad SPY history fetch, rather than only recording regime
forward on new trades. The forward-only alternative would have been
simpler but would produce zero results until a large volume of new
trades accumulated; retroactive reconstruction works on trade history
that already exists today, at the cost of one broad fetch instead of a
new column. Surfaced as a new section in `PerformanceMetricsPanel`.

**CORRECTION (2026-08-06):** The claim below was wrong when written and
is being fixed here rather than left standing. "The full original Stage
3 list" was NOT built. Checked against the original 24-item request, three
items were never built and one was mischaracterized:

- **Average R** (return normalized by risk/stop distance, not raw %) —
  never built. Every Stage 3 metric uses percentage returns; R-multiples
  are a genuinely different, unbuilt calculation.
- **Volatility** as its own standalone reported figure — never built.
  Standard deviation exists internally inside the Sharpe/Sortino math but
  was never surfaced as its own number anywhere.
- **Risk Attribution** (which positions/signals contribute most to
  *drawdown or variance*, as opposed to *profit*) — never built. The
  original list named FIVE attribution categories (Portfolio, Signal,
  Claude, Learning, Risk); only four were built. "All four attribution
  categories" was true as a description of what got built, but was
  wrongly presented below as if it satisfied the full attribution
  requirement, which had five.
- **Session Performance** — NOT newly built in Stage 3, but already
  covered by pre-existing `SessionPerformancePanel` (built earlier in
  this project, breaks down by scalp/swing/crypto session type). Worth
  noting explicitly rather than silently counted as a "Stage 3" win.

Nine slices were genuinely built, tested, and fresh-clone verified —
that part is real. The claim that this constituted "the full original
list" was not. See `ROADMAP.md` for the corrected status.

**ALL NINE STAGE 3 SLICES ARE NOW COMPLETE — the full original Stage 3
list (Sharpe, Sortino, Max Drawdown, Profit Factor, Expectancy, Average
Win, Average Loss, Rolling Performance, Volatility, Alpha, Beta,
Correlation to SPY, Rolling Correlation, Exposure, Holding Time, Win
Rate, Trade Distribution, Session Performance, Regime Performance,
Portfolio/Signal/Claude/Learning Attribution) is built, tested, and
independently fresh-clone verified.** ~~TD-12 is fully resolved.~~ See
correction above — TD-12 is LARGELY resolved, not fully.

**Priority:** Was RESOLVED — corrected to LARGELY RESOLVED. Average R,
standalone Volatility, and Risk Attribution remain genuinely open, not
blocking, but real and not yet scheduled.

---

## TD-13 — Two different auth-check implementations across `/api/public/*` endpoints

**Severity:** Low (both variants correctly reject invalid keys — this is
drift/inconsistency, not a security hole like TD-02/TD-03 were)
**Impact:** Most endpoints use a direct
`apikey !== process.env.SUPABASE_PUBLISHABLE_KEY` comparison.
`daily-digest.ts`, `evaluate-strategies.ts`, `generate-strategies.ts`,
`resolve-signals.ts`, and `snapshot-portfolio.ts` use a different
variant that also falls back to `SUPABASE_ANON_KEY` and checks an
alternate `"Apikey"` header capitalization. Discovered while adding
rate limiting (Stage 2, Priority 3) — both patterns work correctly as
far as verified, but this is exactly the kind of undocumented drift
`ENGINEERING_CONSTITUTION.md`'s principles argue against, and the same
class of drift that caused BUG-001/BUG-002 to exist as two different
bugs in the first place.
**Workaround:** None needed — not currently broken, just inconsistent.
**Recommended solution:** Consolidate all 15 endpoints onto the single
`verifyPublicApiKeyFromEnv()` utility already built and tested for
Priorities 1–2 (`src/lib/api-auth.ts`), retiring both inline variants.
**Status:** RESOLVED (2026-08-06). All 5 endpoints migrated onto the
shared utility. Two things confirmed directly, not assumed, before
making the change: (1) the `"Apikey"` capitalized-header fallback was
genuinely dead code — verified with a real `Headers` object that
`.get("apikey")` and `.get("Apikey")` return identically, since the
Fetch API spec treats header names case-insensitively; (2)
`evaluate-strategies.ts` reused its `anon` variable downstream as an
outbound header value (calling `generate-strategies.ts` after retiring
a strategy) — preserved as its own variable rather than only inlined
into the auth check, so that usage kept working.
**Known, accepted behavior change:** the 5 migrated endpoints previously
returned a JSON body (`{ ok: false, error: "unauthorized" }`) on auth
failure; `unauthorizedResponse()` returns plain text ("Unauthorized").
Both are 401s. Checked whether anything parses the JSON body — these are
pg_cron-triggered background jobs, not endpoints a UI calls and inspects
error bodies from, so this is treated as a safe, minor consistency
improvement (matching the other 10 endpoints) rather than a risk.

**Correction (2026-08-06, same day):** the "Resolved" claim above was
itself imprecise when first written. It said "all 15 endpoints now use
the same shared utility" — actually true for only 7 (the 5 migrated here
plus `evaluate-alerts`/`sync-crons` from Priorities 1-2). The other 8
still had their own inline copy of the auth check: 7 used the correct,
safe direct comparison (`apikey !== process.env.SUPABASE_PUBLISHABLE_KEY`)
just not literally calling the shared function, and — this is the real
find — `agent-backtest.ts` had a THIRD, previously-uncaught auth variant
(`SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_ANON_KEY` fallback, no `"Apikey"`
capitalization check) that this document's own TD-13 investigation
missed entirely. Found while doing an unrelated methodology review of
`agent-backtest.ts`. All 8 now genuinely migrated onto
`verifyPublicApiKeyFromEnv()` — the claim is accurate now, verified by a
fresh sweep of every route file confirming the shared utility is
imported everywhere the apikey-header auth model applies (the OAuth
callback correctly remains excluded — different auth model entirely).
**Priority:** Was Low. Genuinely resolved now.

