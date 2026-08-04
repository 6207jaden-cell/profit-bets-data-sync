# ROADMAP.md
Last updated: 2026-08-04 (Pass 1)

Sequenced per the requested order: correctness/bugs → statistical
soundness → risk management → performance → UI/UX → new features →
growth. Nothing below has been auto-implemented — this is the plan,
awaiting direction on what to execute next.

---

## CRITICAL (before any live-money connection, no exceptions)

1. **Fix BUG-001** — `evaluate-alerts.ts` has zero authorization.
2. **Fix BUG-002** — `sync-crons.ts` auth check doesn't verify the key.
3. **Add basic rate limiting** to every `/api/public/*` endpoint (Finding 4,
   SECURITY_AUDIT.md) — becomes far more urgent once 1 and 2 are fixed,
   since an attacker without those two open doors would otherwise just
   try unlimited-frequency requests against whatever remains.

## HIGH

4. **Stand up real test infrastructure.** Zero tests exist today on a
   system that makes financial decisions. Recommend Vitest (fastest
   integration with the existing Vite build) starting with the pure,
   easily-testable math functions first: `computeATR`, `computeCorrelation`,
   `computeVwap`, `computeKellySizeMultiplier`, `estimateSlippageBps`,
   `computeBreadthScore` — all are pure functions with no I/O, ideal first
   targets, and exactly the functions this whole session's work depends on
   being correct.
5. **Fix BUG-005** — apply `npm audit fix` for the 2 dependency CVEs, then
   re-verify build.
6. **Review the `agent-backtest` endpoint** for the same rigor applied to
   the live trading path in this pass (look-ahead bias, fill assumptions,
   the survivorship-bias caveat from TRADING_ENGINE_REVIEW.md Finding 4).
7. **Get an honest read on actual closed-trade count** and, if low, be
   explicit with the user that no statistical claims about edge are valid
   yet — set a real re-evaluation date once enough data exists.

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
