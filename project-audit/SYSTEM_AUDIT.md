# SYSTEM_AUDIT.md
Last updated: 2026-08-06 (Pass 2 — see update below; Pass 1 content preserved as historical record)

## How to read this document
This is the master tracker for an ongoing audit of PROFIT_BETS.AI. Every claim
in this file and its companions is either (a) verified directly by reading
code, running the compiler/build, running `npm audit`, or executing a real
check, or (b) explicitly marked as an estimate/opinion. Nothing here is
padded to look more thorough than it is. Where real data is needed and
doesn't exist yet (load testing, live P&L history, memory profiling), that
is stated plainly instead of a fabricated number.

---

## Pass 2 update (2026-08-06) — significant work completed since Pass 1

Everything below Pass 1's original findings (still shown intact further
down for the historical record) describes a state from before four major
efforts landed: Stage 1.5 (test infrastructure), Stage 2 (security
hardening), Stage 3 (performance analytics), and Stage 3.5 (skeptical
review of Stage 3's own tooling). This update was itself triggered by a
direct user question ("what else needs fixing") that prompted a real
re-audit — several of these corrections (`BUG_TRACKER.md` BUG-001/002,
`TECHNICAL_DEBT.md` TD-01 through TD-04) were found stale in that same
pass, not caught by this project's own review discipline. Worth stating
plainly rather than implying this document was kept current on its own.

**What's now resolved, contradicting Pass 1's risk list below:**
1. Zero test coverage → 186 tests across 19 files, every one asserting a
   hand-computed expected value (Stage 1.5).
2. Two endpoints with broken/missing authorization → both fixed via a
   shared, tested utility (Stage 2, Priorities 1-2).
3. No rate limiting anywhere → built, applied to all 15 endpoints
   (Stage 2, Priority 3).
4. 2 dependency CVEs → resolved, 0 vulnerabilities (Stage 2, Priority 4).

**What's now built that didn't exist in Pass 1:** a full performance-
analytics layer (Sharpe, Sortino, drawdown, profit factor, expectancy,
Alpha/Beta/correlation to SPY, all four built attribution categories,
rolling metrics, trade distribution, exposure, regime-conditional
performance — Stage 3), plus a skeptical review of that layer's own
methodology (Stage 3.5) that found and fixed one real gap (Regime
Performance's missing evidence floor) and documented three real
interpretive limitations.

**What is genuinely still true, unchanged from Pass 1 — this is now the
single most important open item:** Risk #4 below remains completely
accurate. No statistical validation of the trading edge exists. Every
tool needed to perform that validation now exists and is tested — but
the actual evidence requires real accumulated trade data, and this
review process has no live database access to check it. The "Unresolved
questions" section's "what's the actual current closed-trade count?" is
still exactly as unresolved as it was in Pass 1.

**Corrected overall health assessment:** the codebase itself has moved
from "functional but with known critical gaps" to "functional, security-
hardened, and instrumented for measurement" — a real, meaningful
improvement. It has NOT moved from "not yet live-money ready" — that
verdict stands, but now for a single, specific reason (no evidence the
trading edge is real) rather than the compound reasons Pass 1 listed.
Still: **FUNCTIONAL, PAPER-TRADING READY, NOT YET LIVE-MONEY READY.**

Remaining genuinely open items, unchanged from Pass 1 or newly found:
`BUG_TRACKER.md` BUG-003 (iron_condor) and BUG-004 (.env in git, low
severity), `TECHNICAL_DEBT.md` TD-13 (auth-pattern inconsistency, low
severity) and the newly-tracked Stage 3 gaps (Average R, standalone
Volatility, Risk Attribution — item 13b), the never-reviewed
`agent-backtest` endpoint, and the news/sentiment classifier accuracy
review. See `ROADMAP.md` for current sequencing.

---

## Pass 1 (2026-08-04) — original findings, preserved as historical record

## Overall health: FUNCTIONAL, PAPER-TRADING READY, NOT YET LIVE-MONEY READY

The trading logic is sophisticated and, as far as static analysis and code
review can confirm, sound. The platform has never been tested with an
automated test suite. Three real authorization gaps were found in this pass.
Zero live performance data exists yet to validate the trading edge
statistically. See TRADING_ENGINE_REVIEW.md and SECURITY_AUDIT.md for detail.

---

## Completed this pass (Pass 1 — 2026-08-04)

- Full architecture read: routing (TanStack Router/Start), Supabase (Postgres
  + RLS + pg_cron + pg_net), 12 autonomous cron jobs, ~150-symbol scan
  pipeline, Claude-based decision layer, exit management, learning system.
- Verified every `/api/public/*` route for authorization coverage
  (found 2 real gaps — see SECURITY_AUDIT.md, BUG-001 and BUG-002).
- Verified `.env` tracking status in git (tracked, but contents are
  publishable/anon-safe keys only — see SECURITY_AUDIT.md).
- Ran `npm audit` against production dependencies — 2 real high-severity
  CVEs found with available fixes (js-yaml, postcss).
- Confirmed zero test infrastructure exists (no runner installed, no test
  files, no `test` script).
- Confirmed zero application-level rate limiting exists on any endpoint.
- Reviewed the Robinhood OAuth callback's CSRF model in detail (uses
  user_id as `state` rather than a random nonce — non-standard but PKCE
  provides the actual protection at token exchange, verified by reading
  the exchange call).

## Active investigations (not yet complete)

- Full dependency tree review beyond the automated `npm audit` pass
  (supply-chain risk, unused/abandoned packages) — not started.
- Bundle size / code-splitting analysis — not started.
- Query efficiency review across all Supabase calls (N+1 patterns,
  missing indexes) — partial, needs a dedicated pass.
- AI_SYSTEM_REVIEW.md (full prompt-by-prompt review of all 3 system
  prompts, token cost estimation, hallucination-risk analysis) — not
  started as a dedicated document; scattered findings exist throughout
  this conversation's build history but haven't been consolidated.
- PERFORMANCE_REPORT.md — explicitly NOT started. This requires actual
  runtime profiling (API latency, memory, CPU under load) that cannot be
  produced from static code review. Flagging this honestly rather than
  inventing numbers.

## Remaining work (see FEATURE_GAP_ANALYSIS.md and roadmap below)

- Test suite: zero coverage today. Given this system makes financial
  decisions, this is the single highest-leverage piece of remaining work.
- Fix the 2 real auth gaps (BUG-001, BUG-002) and 1 hardening item
  (Robinhood OAuth state) — see SECURITY_AUDIT.md.
- Statistical validation of the trading edge — cannot be done yet; there
  isn't enough closed-trade history. This needs either (a) weeks of live
  paper-trading data, or (b) a proper walk-forward backtest across the
  full ~150-symbol universe (the codebase has an "agent-backtest" endpoint
  — its output has not yet been reviewed for correctness in this audit).

## Unresolved questions

- Is there a target date for connecting a live brokerage account? This
  materially changes prioritization — rate limiting and the auth gaps
  become non-negotiable before that happens, not just "should fix."
- What's the actual current closed-trade count? This determines whether
  a statistical confidence review is even possible yet, or whether the
  honest answer is "come back in N more weeks of live paper trading."

## Assumptions made in this audit

- Assumed Lovable's auto-generated files (auth-middleware.ts, routeTree.gen.ts,
  types.ts) are correct as generated and out of scope for line-by-line
  review, since editing them directly is explicitly discouraged by their
  own header comments. Spot-checked auth-middleware.ts anyway given its
  security relevance — found it sound.
- Assumed the Supabase publishable/anon key IS meant to be public
  (per Supabase's own security model — RLS enforces the real boundary).
  If this project has non-standard requirements around that, revisit.

## Risks (ranked by this pass's findings)

1. **No test coverage on money-moving logic.** Every number in
   TRADING_ENGINE_REVIEW.md's math has been checked by reading the code
   carefully and confirming the formulas are textbook-correct, NOT by an
   automated test asserting `computeATR([...]) === expectedValue`. A
   silent regression in a future edit could go undetected indefinitely.
2. **Two endpoints with broken/missing authorization** on service-role
   (RLS-bypassing) database access. See BUG-001, BUG-002.
3. **No rate limiting anywhere.** Combined with #2, a public endpoint with
   no auth check and no rate limit is the worst-case combination.
4. **No statistical validation of the trading edge yet.** Every piece of
   logic built this project is individually well-reasoned (ATR-based
   stops, Kelly sizing, correlation limits, etc.) but the SYSTEM as a
   whole has not been proven to produce positive expected value with real
   evidence — only with reasoning. Reasoning is not the same as evidence.

---

## Next: see ROADMAP.md for prioritized sequencing of fixes.
