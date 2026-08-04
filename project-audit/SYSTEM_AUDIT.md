# SYSTEM_AUDIT.md
Last updated: 2026-08-04 (Pass 1)

## How to read this document
This is the master tracker for an ongoing audit of PROFIT_BETS.AI. Every claim
in this file and its companions is either (a) verified directly by reading
code, running the compiler/build, running `npm audit`, or executing a real
check, or (b) explicitly marked as an estimate/opinion. Nothing here is
padded to look more thorough than it is. Where real data is needed and
doesn't exist yet (load testing, live P&L history, memory profiling), that
is stated plainly instead of a fabricated number.

---

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
