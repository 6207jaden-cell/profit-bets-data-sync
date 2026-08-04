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
**Priority:** Critical / immediate — `ROADMAP.md` item 4.

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
**Priority:** Critical / immediate — `ROADMAP.md` item 1.

---

## TD-03 — `sync-crons.ts` authorization check verifies presence, not correctness

**Severity:** High
**Impact:** Any non-empty `apikey` header value passes the check; the
actual key is never compared. See `SECURITY_AUDIT.md` Finding 2 and
`BUG_TRACKER.md` BUG-002.
**Workaround:** None.
**Recommended solution:** Change `if (!apikey)` to
`if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY)`.
**Priority:** High — `ROADMAP.md` item 2.

---

## TD-04 — No application-level rate limiting anywhere

**Severity:** Critical (given TD-02/TD-03 currently open; would be High
in isolation)
**Impact:** Every endpoint, correctly-authorized or not, can be called
at unlimited frequency. Compounds directly with TD-02 and TD-03.
**Workaround:** None.
**Recommended solution:** Token-bucket or fixed-window rate limiting,
either platform-level or a lightweight Postgres-table-backed
implementation.
**Priority:** Critical, specifically because of its interaction with
TD-02/TD-03 — `ROADMAP.md` item 3.

---

## TD-05 — `iron_condor` is AI-selectable but not executable

**Severity:** Medium
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
**Priority:** Medium — `ROADMAP.md` item 8.

---

## TD-06 — 2 known CVEs in production dependencies

**Severity:** High
**Impact:** `js-yaml` (quadratic-CPU DoS vector) and `postcss`
(arbitrary `.map` file disclosure via path traversal) — verified via
`npm audit --omit=dev`. See `SECURITY_AUDIT.md` Finding 6.
**Workaround:** None currently applied.
**Recommended solution:** `npm audit fix`, then re-verify `tsc --noEmit`
and production build before considering this closed.
**Priority:** High — `ROADMAP.md` item 5.

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
**Priority:** High — Phase 2 of the current roadmap direction,
deliberately sequenced after Phase 1's trustworthiness fixes
(TD-01 through TD-06).
