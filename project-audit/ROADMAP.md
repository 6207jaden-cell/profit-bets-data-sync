# ROADMAP.md
Last updated: 2026-08-05 (Pass 2)

Sequenced per the requested order: correctness/bugs → statistical
soundness → risk management → performance → UI/UX → new features →
growth. Nothing below has been auto-implemented — this is the plan,
awaiting direction on what to execute next.

---

## COMPLETED SINCE PASS 1 (2026-08-05) — measurement infrastructure, not fixes

The four items below are genuinely done — built, compiled, built, and
pushed — but they do NOT change any of the CRITICAL items' urgency below.
Measurement infrastructure and security/reliability fixes are independent
tracks; completing these did not touch authorization, rate limiting, or
test coverage.

- **Experiment 1 (Claude Value Test)** — shadow-logs deterministic
  ranking vs. Claude's actual decisions. Live since commit `784852f`.
- **Experiment 2 (Adaptive Learning Test)** — shadow-compares real
  adaptive-weighted scoring against neutral-weighted scoring for the
  same candidates. Live since commit `c892f06`.
- **Experiment 3 (Trading Cost Reality Test)** — fee modeling + gross-
  vs-net expectancy tracking by session type. Live since commit
  `64885fc`.
- **Experiment 4 (Signal Contribution Analysis)** — present-vs-absent
  Bayesian tracking per signal, pure observation, does not feed real
  scoring. Live since commit `cb7dda4`.

See `HYPOTHESIS_LOG.md` (now 9 entries, H1–H9) and `EXPERIMENT_RESULTS.md`
for full status — every experiment above has genuinely zero results yet,
infrastructure only just started collecting data.

---

## STAGE 2 AND STAGE 3 COMPLETE (2026-08-05)

**Stage 2 (Foundation and Security Hardening)** — all four Critical
priorities done and independently fresh-clone verified: `evaluate-alerts.ts`
auth fix, `sync-crons.ts` auth fix, application-level rate limiting on
all 15 `/api/public/*` endpoints, dependency vulnerability remediation
(0 known CVEs). See `CHANGELOG.md`'s Stage 2 entries.

**Stage 3 (Performance Analytics)** — nine slices built, tested, and
independently fresh-clone verified: Sharpe, Sortino, Max Drawdown,
Profit Factor, Expectancy, Average Win, Average Loss, Rolling
Performance (win rate/Sharpe/Sortino AND correlation/Beta/Alpha), Alpha,
Beta, Correlation to SPY, Exposure, Holding Time distribution, Win Rate
(with a real Wilson-score confidence interval), Trade Distribution,
Regime Performance, and four of the five originally-requested
attribution categories (Portfolio, Signal, Claude, Learning — Risk
Attribution was not built). **Correction (2026-08-06):** this was
previously described here as "the full original list" — that was
inaccurate and has been fixed in `TECHNICAL_DEBT.md` TD-12. Three items
from the original 24-item request were never built: Average R,
standalone Volatility, and Risk Attribution. See `TECHNICAL_DEBT.md`
TD-12 (now marked LARGELY RESOLVED, not fully) and `CHANGELOG.md`'s
Stage 3 entries for full detail on each slice's design decisions and
honest limitations.

**Test suite status:** 186 tests across 19 files as of this writing, all
passing, every one asserting a hand-computed expected value.

**Stage 3.5 (Statistical Validation) — methodological review complete,
2026-08-06.** A skeptical review of the Stage 3 analytics infrastructure
itself found and fixed one real gap (Regime Performance's missing
evidence floor) and documented three real interpretive limitations
(Signal Attribution/Kelly-sizing circularity, an expanded multiple-
comparisons surface across every Stage 3 grouped breakdown, and the
SPY-only benchmark not cleanly separating equity skill from crypto
movement). See `TRADING_ENGINE_REVIEW.md` Findings 7-10. **What Stage
3.5 could NOT do:** answer any of its own named empirical questions
(does Claude/adaptive learning/each signal add value, which regimes
generate positive expectancy) — that requires querying the live
database for real accumulated trade results, which this process has no
access to. The tools to answer them are built and tested; the answers
themselves remain genuinely unknown. See `EXPERIMENT_RESULTS.md`'s
Stage 3.5 addendum and `HYPOTHESIS_LOG.md` H1/H10 for the specific
cross-references.

**Next per the original staged protocol:** Stage 4 (Optimization)
explicitly requires evidence from Stage 3/3.5 before any change — since
that evidence doesn't exist yet (no live data access), Stage 4 cannot
responsibly begin. The actual next step is querying the live database
once enough real trade volume exists, not more infrastructure work.

---

## CRITICAL (before any live-money connection, no exceptions)

1. ~~**Fix BUG-001** — `evaluate-alerts.ts` has zero authorization.~~
   **DONE 2026-08-05** (Stage 2, Priority 1). See `CHANGELOG.md`.
2. ~~**Fix BUG-002** — `sync-crons.ts` auth check doesn't verify the key.~~
   **DONE 2026-08-05** (Stage 2, Priority 2). See `CHANGELOG.md`.
3. ~~**Add basic rate limiting** to every `/api/public/*` endpoint~~
   **DONE 2026-08-05** (Stage 2, Priority 3). All 15 endpoints covered.
   See `CHANGELOG.md`, `SECURITY_AUDIT.md` Finding 4.

**All Stage 2 Critical items are now complete.**

## HIGH

4. ~~**Stand up real test infrastructure.**~~ **DONE** (Stage 1.5,
   2026-08-05). Vitest installed, 94 tests across 11 files as of this
   writing, including all originally-named targets (`atr`,
   `computeCorrelation`, `computeVwap`, `computeKellySizeMultiplier`,
   `estimateSlippageBps`, `computeBreadthScore`) plus
   `computeDirectionalScores`, the auth utility, and the rate limiter.
   See `src/lib/__tests__/`.
5. ~~**Fix BUG-005** — apply `npm audit fix` for the 2 dependency CVEs, then
   re-verify build.~~ **DONE 2026-08-05** (Stage 2, Priority 4).
6. ~~**Review the `agent-backtest` endpoint** for the same rigor applied to
   the live trading path in this pass (look-ahead bias, fill assumptions,
   the survivorship-bias caveat from TRADING_ENGINE_REVIEW.md Finding 4).~~
   **DONE 2026-08-06.** Found 3 real methodology issues — see
   `TRADING_ENGINE_REVIEW.md` Findings 11-13: a same-bar execution bias
   (fix flagged, not yet applied — real methodology change), a header
   comment overclaiming regime-alignment simulation (corrected), and no
   slippage/fee modeling (fix flagged, not yet applied). This endpoint's
   output should not be treated as credible evidence of edge until at
   least the execution-bias finding is addressed.
6a. **Fix `agent-backtest.ts`'s same-bar execution bias** (Finding 11,
    discovered 2026-08-06). Entry currently uses the identical price
    index that generated the momentum score — change to enter at the
    NEXT bar (close or open) after the signal, not the same bar. Touches
    every subsequent index calculation in the backtest loop; needs its
    own careful review and tests, not a quick inline edit.
6b. **Apply real cost modeling to `agent-backtest.ts`** (Finding 13,
    discovered 2026-08-06). Pipe `estimateSlippageBps`/`applySlippage`/
    `estimateFees` (already built, already applied to every real paper
    trade) through the backtest's trade loop so its reported returns
    aren't systematically more optimistic than what the same rule would
    show under realistic costs.
7. **Get an honest read on actual closed-trade count** and, if low, be
   explicit with the user that no statistical claims about edge are valid
   yet — set a real re-evaluation date once enough data exists.
7a. **Review the 4 experiments' results** (added 2026-08-05, infrastructure
   complete — see the "Completed Since Pass 1" section above and
   `EXPERIMENT_RESULTS.md`). Not actionable yet — each experiment has a
   minimum sample-size floor before any conclusion should be drawn (30
   resolved rows for Experiment 1, similar for Experiment 2, 20 trades
   per session type for Experiment 3, 10 samples both sides per signal
   for Experiment 4). Suggested check-in: 2–3 weeks from infrastructure
   going live, enough time for scalp/crypto's shorter resolution horizons
   to produce meaningful volume even if swing trades are still sparse.
   When reviewed, update `HYPOTHESIS_LOG.md` H1–H9 per the cross-reference
   discipline in `ENGINEERING_CONSTITUTION.md` — do not leave a hypothesis
   marked "Unresolved" once its experiment has actually produced a result.

## MEDIUM

8. ~~**Fix BUG-003** (`iron_condor`) — either remove it from the AI's
   schema or build real multi-leg execution.~~ **DONE 2026-08-06.**
   Removed from the schema; also fixed the root cause (schema and
   execution-check were two independently-maintained lists) via a new
   shared `src/lib/instruments.ts`. See `BUG_TRACKER.md` BUG-003.
9. ~~**Fix BUG-004** — untrack `.env`, verify deploy still works.~~
   **DONE 2026-08-06.** See `BUG_TRACKER.md` BUG-004.
10. **Add a staleness check** to price-fetch fallbacks (TRADING_ENGINE_REVIEW.md
    Finding 6).
11. **Add a cron-overlap guard** (TRADING_ENGINE_REVIEW.md Finding 5).
12. **Harden the Robinhood OAuth `state` parameter** (SECURITY_AUDIT.md
    Finding 3) — low urgency given PKCE already protects the real attack
    surface, but correct to fix before this becomes a template for other
    OAuth integrations.

## LOW / deferred, needs more foundational work first

13. Full OWASP Top 10 pass, SSRF review of the many external fetch() calls.
13a. ~~**Consolidate auth-check implementations** (TD-13, discovered
    2026-08-05 during Priority 3). 5 of 15 `/api/public/*` endpoints use
    a different (but not broken) auth-check variant than the other 10 —
    migrate all onto the single tested `verifyPublicApiKeyFromEnv()`
    utility from `src/lib/api-auth.ts`.~~ **DONE 2026-08-06.** All 15
    endpoints now use the same shared, tested utility. See
    `TECHNICAL_DEBT.md` TD-13.
13b. **Complete the remaining Stage 3 analytics items** (discovered
    2026-08-06 — previously miscounted as complete, see `TECHNICAL_DEBT.md`
    TD-12 correction): Average R (risk-normalized return, not raw %),
    standalone Volatility as its own reported figure (currently only
    exists internally inside the Sharpe/Sortino calculation), and Risk
    Attribution (which positions/signals contribute most to drawdown or
    variance, not profit — the 5th originally-requested attribution
    category, distinct from the 4 that were built).
14. Bundle size / code-splitting analysis.
15. Real performance profiling (latency, memory, CPU) — needs actual
    running-system access, not static review.
16. Multiple-comparisons correction for the per-signal learning system
    (TRADING_ENGINE_REVIEW.md Finding 1) — worth revisiting once real
    data shows whether this is a practical problem or a theoretical one
    that doesn't materialize with this system's actual signal count and
    trade volume.
17. Business/growth features (education content, professional-tier
    features, richer analytics) — deliberately last, consistent with not
    building on top of an unverified foundation.

---

## What I will NOT claim

- No numeric "Production Readiness Score" is given in this pass. A
  meaningful score needs the HIGH-priority items above (especially real
  test coverage and the auth fixes) to exist first — assigning a number
  now would imply more confidence than the evidence supports.
- No "Statistical Confidence Review" of the trading edge is given. This
  requires actual closed-trade data at a volume this audit did not query
  for and cannot assume.

## Honest summary of where this stands

The platform is well-architected for what it is — a paper-trading system
with a genuinely sophisticated decision layer built incrementally with
real care. It is **not yet** ready to be trusted with live capital: two
real authorization gaps, zero automated test coverage on the logic that
would be moving that capital, and no rate limiting are disqualifying
until fixed, independent of how good the trading logic itself might be.
The trading logic's soundness is a separate question from its safety —
this pass focused on both and found real issues in each, at different
severities.
