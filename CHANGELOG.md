# CHANGELOG.md

A running narrative of what shipped and why — distinct from git history,
which explains individual commits. This explains the story across them
for someone who wasn't present. Recommended in `ENGINEERING_CONSTITUTION.md`
Section 12 since the constitution was first written; this is its first
real entry.

Format per entry: date, what changed, why, files touched, verification
performed.

---

## 2026-08-05 — Stage 2, Priority 1: Fixed `evaluate-alerts.ts` authorization

**What changed:** `evaluate-alerts.ts` now verifies the caller's `apikey`
header before touching any data, returning 401 if it's missing or
incorrect.

**Why:** The endpoint had zero authorization — the handler didn't even
accept a `request` parameter, so the check its own code comment described
was never actually implemented. Anyone who discovered the URL could
trigger service-role-privileged execution with no rate limit. Found
during the Stage 1 security audit (`SECURITY_AUDIT.md` Finding 1,
`BUG_TRACKER.md` BUG-001), fixed as Stage 2's first priority per the
Critical-before-anything-else sequencing in `ROADMAP.md`.

**How it was fixed:** Rather than a one-off inline check (which is what
led to Finding 2's near-identical bug existing alongside this one —
`sync-crons.ts` checked presence but not correctness), built a shared,
unit-tested utility (`src/lib/api-auth.ts`) that both this fix and
Priority 2's fix use identically. `verifyPublicApiKey(request, expectedKey)`
is a pure function taking the expected key as an explicit parameter
specifically so it's testable without mocking environment variables.

**Files changed:**
- `src/lib/api-auth.ts` (new)
- `src/lib/__tests__/api-auth.test.ts` (new, 9 tests)
- `src/routes/api/public/evaluate-alerts.ts`
- `project-audit/SECURITY_AUDIT.md` (Finding 1 marked fixed)

**Tests added:** 9 tests covering: correct key accepted, incorrect key
rejected, missing header rejected, empty-string header rejected, the
exact BUG-002 regression pattern (any non-empty string incorrectly
passing a naive presence-only check) explicitly locked in as rejected,
case-sensitivity, whitespace handling (documented as platform/Headers-API
behavior, not application logic), and fail-safe behavior when the
server's own expected key is itself missing/misconfigured.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: clean (sandbox)
- `npx vitest run`: all passing including the new 9 (sandbox)
- Independent fresh-clone + fresh-install verification per the new
  Release Verification Rule (`ENGINEERING_CONSTITUTION.md` Section 8),
  since this change touches authentication — see verification log below.

**Remaining risk:** `sync-crons.ts` (Finding 2) still has its own,
different auth bug as of this entry — fixed next as Priority 2, using
the same shared utility. Rate limiting (Priority 3) is not yet in place,
so this endpoint — now correctly rejecting unauthorized callers — still
has no protection against a caller who *does* have the correct key
making unlimited requests.

---

## 2026-08-05 — Stage 2, Priority 2: Fixed `sync-crons.ts` authorization

**What changed:** `sync-crons.ts` now uses `verifyPublicApiKeyFromEnv()`
(the same shared utility built for Priority 1) instead of its previous
`if (!apikey)` presence-only check.

**Why:** The existing check verified the `apikey` header was non-empty
but never compared it against the real secret — any non-empty string
passed. Lower real-world severity than Priority 1's finding (the
operation is idempotent, re-registers a fixed cron list, doesn't expose
or mutate user data) but still improper access control on an
admin-privileged action. `SECURITY_AUDIT.md` Finding 2.

**How it was fixed:** Reused the exact same tested utility from Priority
1 rather than writing a second, potentially-inconsistent inline check —
this is precisely the pattern whose absence caused Findings 1 and 2 to
exist as two different bugs in the first place.

**Files changed:**
- `src/routes/api/public/sync-crons.ts`
- `project-audit/SECURITY_AUDIT.md` (Finding 2 marked fixed)

**Tests added:** None new — this fix is covered by the same 9 tests
added for Priority 1, since it calls the identical utility. The test
suite's "rejects ANY non-empty string" case is explicitly the regression
pattern this exact bug represents.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: clean (sandbox)
- `npx vitest run`: 77/77 passing (sandbox)
- Independent fresh-clone + fresh-install verification per the Release
  Verification Rule, since this touches authentication.

**Remaining risk:** Both Priority 1 and Priority 2's endpoints are now
correctly authorized but still have no rate limiting — Priority 3, next.

---

## 2026-08-05 — Stage 2, Priority 3: Application-level rate limiting

**What changed:** All 15 `/api/public/*` endpoints now enforce a rate
limit, checked after authentication succeeds. Exceeding the limit returns
429 with a `Retry-After` header.

**Why:** Zero rate limiting existed anywhere in the codebase
(`SECURITY_AUDIT.md` Finding 4). Combined with the now-fixed Findings 1
and 2, an endpoint with broken auth AND no rate limit was the worst-case
combination — even correctly-authorized endpoints had no ceiling on
request volume from a caller holding a valid (or leaked) key.

**How it was fixed:** Shared, reusable infrastructure
(`src/lib/rate-limit.ts`) rather than 15 separate implementations —
Postgres-backed (no Redis in this architecture), atomic via a row-locked
SECURITY DEFINER function to avoid a real race condition a naive
select-then-write would have under concurrent cron overlaps. Each
endpoint configures its own limit, window, and identifier strategy
(global-per-endpoint for cron-only endpoints; per-IP for the
browser-triggered `emergency-exit`; per-user for the expensive,
user-initiated `agent-backtest`) without duplicating any logic.

**Files changed:**
- `src/lib/rate-limit.ts` (new)
- `src/lib/__tests__/rate-limit.test.ts` (new, 17 tests)
- `supabase/migrations/20260805010000_rate_limiting.sql` (new — table +
  atomic increment function + cleanup function)
- `supabase/migrations/20260805010500_rate_limit_cleanup_cron.sql` (new
  — registers the cleanup cron; also registers `evaluate-alerts` as an
  actual cron job, discovered to be missing despite its own code comment
  claiming otherwise)
- All 15 route files under `src/routes/api/public/`
- `project-audit/SECURITY_AUDIT.md` (Finding 4 marked fixed)

**Tests added:** 17 — allowed/blocked at the limit boundary, window
reset (verified with a real timed wait, not simulated), bucket
independence, 3 distinct fail-open scenarios (RPC throws, RPC returns an
error field, RPC returns malformed data), the 429 response shape and
header, both bucket-key strategies, and env-var override configurability
including malformed-input handling.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox) — caught and fixed one real
  issue along the way: a variable name collision (`rl`) between the new
  rate-limit config and a pre-existing, unrelated variable in
  `generate-strategies.ts`
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 94/94 passing (17 new)
- Independent fresh-clone + fresh-install verification per the Release
  Verification Rule, since this touches database access and (via the
  route changes) authentication-adjacent request handling.

**Remaining risks:**
- Deliberately fails open on rate-limiter infrastructure errors — a
  documented tradeoff (availability of legitimate cron traffic over
  strict enforcement during a transient DB issue), not an oversight.
- Two different auth-check implementations across the 15 endpoints
  (discovered, not fixed — see `SECURITY_AUDIT.md` Finding 4 for detail
  and reasoning on why this was left for a follow-up rather than folded
  into this change).
- All Stage 2 Critical items (1–3) are now complete. Priority 4
  (dependency vulnerability remediation) remains.

