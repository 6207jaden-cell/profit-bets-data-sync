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
5. **Fix BUG-005** — apply `npm audit fix` for the 2 dependency CVEs, then
   re-verify build.
6. **Review the `agent-backtest` endpoint** for the same rigor applied to
   the live trading path in this pass (look-ahead bias, fill assumptions,
   the survivorship-bias caveat from TRADING_ENGINE_REVIEW.md Finding 4).
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

8. **Fix BUG-003** (`iron_condor`) — either remove it from the AI's
   schema or build real multi-leg execution. Given it's already worked
   around for the earnings-strategy module, removing it from the general
   schema is the faster, lower-risk fix.
9. **Fix BUG-004** — untrack `.env`, verify deploy still works.
10. **Add a staleness check** to price-fetch fallbacks (TRADING_ENGINE_REVIEW.md
    Finding 6).
11. **Add a cron-overlap guard** (TRADING_ENGINE_REVIEW.md Finding 5).
12. **Harden the Robinhood OAuth `state` parameter** (SECURITY_AUDIT.md
    Finding 3) — low urgency given PKCE already protects the real attack
    surface, but correct to fix before this becomes a template for other
    OAuth integrations.

## LOW / deferred, needs more foundational work first

13. Full OWASP Top 10 pass, SSRF review of the many external fetch() calls.
13a. **Consolidate auth-check implementations** (TD-13, discovered
    2026-08-05 during Priority 3). 5 of 15 `/api/public/*` endpoints use
    a different (but not broken) auth-check variant than the other 10 —
    migrate all onto the single tested `verifyPublicApiKeyFromEnv()`
    utility from `src/lib/api-auth.ts`.
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
