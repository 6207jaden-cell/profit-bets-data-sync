# SECURITY_AUDIT.md
Last updated: 2026-08-04 (Pass 1)

Every finding below was verified by directly reading the relevant file and,
where applicable, tracing the actual data flow. Severity ratings reflect
real, reasoned impact — not worst-case dramatization.

---

## FINDING 1 — CRITICAL: `evaluate-alerts.ts` has no authorization check at all

**File:** `src/routes/api/public/evaluate-alerts.ts`

The handler signature is `POST: async () => { ... }` — it doesn't even
accept a `request` parameter, so it structurally cannot check any header.
It immediately uses `supabaseAdmin` (service-role, bypasses all RLS) to
read every user's `price_alerts` and write `notifications` + update
`price_alerts` for any user whose alert triggers.

The code's own comment says: *"Called by pg_cron every 5 minutes via the
project's anon key in the `apikey` header"* — describing intended behavior
that was never implemented. This is almost certainly a regression, not a
deliberate design choice, given every sibling cron endpoint (evaluate-
strategies, snapshot-portfolio, autonomous-agent, etc.) correctly checks
`apikey !== process.env.SUPABASE_PUBLISHABLE_KEY`.

**Real-world impact:** Anyone who discovers this URL can POST to it
repeatedly with no rate limit (see Finding 4) and no authentication. The
JSON response itself only returns counts (`{ ok, checked, triggered }`),
so this is not a direct data-exfiltration path. The real risk is (a)
unbounded free execution of service-role-privileged logic by anyone, (b)
cost/quota exhaustion on the price-lookup calls it makes, (c) spurious
`notifications` writes for arbitrary users if their alerts happen to be
triggerable.

**Fix:** Add the same guard every other route in this codebase already
uses:
```ts
POST: async ({ request }: { request: Request }) => {
  const apikey = request.headers.get("apikey");
  if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }
  ...
```

**Status:** FIXED 2026-08-05 (Stage 2, Priority 1). The handler now
accepts `{ request }`, calls the new shared `verifyPublicApiKeyFromEnv()`
utility (`src/lib/api-auth.ts`), and returns 401 via `unauthorizedResponse()`
when the check fails — before any `supabaseAdmin` access. Built as a
centralized, unit-tested utility (9 tests in `src/lib/__tests__/api-auth.test.ts`
covering valid/invalid/missing/malformed keys, including a test that
specifically locks in the exact regression pattern from Finding 2 below —
a naive presence-only check accepting any non-empty string) rather than
a one-off inline fix, so Finding 2's identical root cause gets the same
correct, tested logic instead of a second hand-written copy. Verified on
an independent fresh clone + fresh install, not sandbox-local state only
— see `ENGINEERING_CONSTITUTION.md`'s Release Verification Rule (Section 8).

---

## FINDING 2 — HIGH: `sync-crons.ts` auth check is present but ineffective

**File:** `src/routes/api/public/sync-crons.ts`

```ts
const apikey = request.headers.get("apikey");
if (!apikey) return new Response("Unauthorized", { status: 401 });
```

This only verifies the header is *non-empty*. It never compares it against
`process.env.SUPABASE_PUBLISHABLE_KEY`. Any request with `apikey: x` (or
any other non-empty string) passes this check and can trigger
`register_all_crons()` via a `SECURITY DEFINER` RPC (service-role
privileges).

This was caught by manual review after an automated grep initially reported
this file as "protected" — the string `SUPABASE_PUBLISHABLE_KEY` does
appear in the file, but only later, unrelated to the actual auth check.
Documenting this explicitly because it's a good example of why automated
pattern-matching isn't sufficient for a security review.

**Real-world impact:** Lower than Finding 1 — the operation itself
(re-registering the same fixed set of cron jobs) is idempotent and doesn't
expose or mutate user data. Still improper access control on an
admin-privileged action, and a caller could spam it.

**Fix:** Change to the correct comparison:
```ts
if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
  return new Response("Unauthorized", { status: 401 });
}
```

**Status:** FIXED 2026-08-05 (Stage 2, Priority 2). Now uses the same
`verifyPublicApiKeyFromEnv()` shared utility as Finding 1's fix, so this
exact regression pattern (naive presence-only check) is covered by the
same 9-test suite in `src/lib/__tests__/api-auth.test.ts` — specifically
the test explicitly named as locking in this bug's exact pattern.
Verified on an independent fresh clone + fresh install.

---

## FINDING 3 — LOW: Robinhood OAuth callback uses `user_id` as the `state` parameter

**File:** `src/routes/api/public/mcp/robinhood/callback.ts`

OAuth's `state` parameter exists specifically as an anti-CSRF nonce — a
random, unguessable value generated at flow start and checked on return.
This implementation sets `state = user_id` directly rather than a separate
random value.

**Why this is LOW and not HIGH severity, verified:** the actual token
exchange (`exchangeCode(...)`) passes `code_verifier: row.code_verifier` —
meaning PKCE is enforced. Robinhood's token endpoint will reject a code
exchange where the `code_verifier` doesn't match the original
`code_challenge`. An attacker attempting to inject their own authorization
`code` against a victim's `state`(=user_id) would fail at this step
regardless, because they don't possess the victim's `code_verifier`.
Combined with Supabase user IDs being non-sequential UUIDs (not practically
guessable), the real-world exploitability here is low. This is a
"not textbook-correct, but not exploitable given the other layer" finding.

**Fix (hardening, not urgent):** Generate a separate random `state` value
at flow initiation, store it alongside `code_verifier`, and verify it
matches on callback — independent of PKCE, as defense in depth.

**FIXED 2026-08-06.** New `generateOAuthState()`/`verifyOAuthState()`
(`mcp-oauth.server.ts`), a genuine random nonce stored in a new
`mcp_connections.oauth_state` column (deliberately not reusing the
existing `state` column on that table, which tracks connection lifecycle
status — a different concept, would have been a real, confusing
collision).

**A real architectural discovery made while fixing this, worth
recording:** this codebase has TWO separate OAuth completion paths for
Robinhood, not one. `completeRobinhoodConnection`
(`mcp-client.functions.ts`) is the genuinely live flow — the UI has the
user paste a full callback URL after Robinhood redirects to a loopback
address (`http://localhost:1455/callback`), confirmed by
`AgentPanel.tsx`'s own placeholder text. `callback.ts`
(`src/routes/api/public/mcp/robinhood/callback.ts`, the file this
finding originally named) is a registered, still-reachable route that
the CURRENT initiation flow never generates a URL pointing to — it may
be legacy/unused, but "probably unreachable" isn't a reason to leave a
real gap unfixed, so both paths were updated with the same nonce
generation/verification, not just the confirmed-live one. `callback.ts`
was additionally changed to look up its connection row BY the nonce
value directly (`eq("oauth_state", state)`) rather than by a
caller-claimed `user_id` — the more correct pattern regardless, since
the caller should never need to assert whose connection this is; only
possessing the exact nonce from the original redirect should prove that.

10 new tests for `generateOAuthState`/`verifyOAuthState`: non-empty
output, uniqueness across calls, URL-safe characters, a sanity floor on
entropy, exact-match verification, mismatch rejection, missing-state
handling on both sides independently (receiving nothing must never
match storing nothing), and case sensitivity.

**Status:** FIXED. Real-world exploitability was already low (PKCE
prevented the attack), so this closes a defense-in-depth gap rather than
an actively exploitable hole — consistent with this finding's original
severity assessment.

---

## FINDING 4 — MEDIUM: No application-level rate limiting anywhere

Verified by search — zero rate-limiting logic exists on any endpoint,
authenticated or public. The only `429` handling found in the codebase is
the app correctly reacting to being rate-limited BY an external API
(Lovable's AI gateway), not the app protecting itself from abuse.

**Real-world impact:** Every `createServerFn` (user-authenticated) and
every `/api/public/*` endpoint (cron-key-authenticated, when correctly
implemented) can be called at unlimited frequency by anyone holding a
valid credential. Combined with Findings 1 and 2, this makes those two
gaps materially worse — no rate limit means no natural ceiling on abuse
even after the auth issue itself is understood.

**Fix:** Supabase Edge Functions and most serverless platforms support
either platform-level rate limiting or a lightweight token-bucket check
against a Postgres table/Redis. Given the financial nature of this app,
recommend this before any live-money connection, not just "eventually."

**Status:** FIXED 2026-08-05 (Stage 2, Priority 3). Built shared,
reusable infrastructure (`src/lib/rate-limit.ts`) — a Postgres-backed
fixed-window counter (no Redis in this architecture), made atomic via a
row-locked (`FOR UPDATE`) SECURITY DEFINER function
(`rate_limit_increment`) rather than a naive select-then-write, which
would have had a real race condition under concurrent calls (relevant
here specifically because `autonomous-agent` is legitimately called by
multiple overlapping cron schedules). Applied to all 15
`/api/public/*` endpoints, each with a limit/window reasoned from its
actual cron cadence (not a copy-pasted default) — e.g. daily-cadence
endpoints get a tight 3-per-hour limit, the every-10-minute exit-check
gets 6-per-5-minutes, the user-triggered `agent-backtest` gets a
per-user (not global) bucket since it's computationally expensive and
legitimately multi-user.

Deliberately fails OPEN on infrastructure errors (DB unreachable, RPC
failure) — documented as a considered tradeoff, not an oversight: rate
limiting is defense-in-depth layered on top of the Finding 1/2 auth
fixes, not the primary security boundary, and blocking all legitimate
cron traffic (including actual trading scans) during a transient DB
issue would be a worse outcome than briefly operating without this
specific layer.

17 tests in `src/lib/__tests__/rate-limit.test.ts` covering: allowed
under limit, blocked over limit, window reset (verified with a real
timed wait past the window boundary, not simulated), bucket
independence (bypass prevention — one endpoint's limit exhaustion
doesn't affect another), fail-open on 3 distinct RPC failure modes
(throw, error field, malformed data), the 429 response shape and
`Retry-After` header, both identifier strategies (global-per-endpoint
and per-IP), and env-var override configurability including malformed-
input handling.

Configurable via `RATE_LIMIT_MAX_REQUESTS_OVERRIDE` /
`RATE_LIMIT_WINDOW_SECONDS_OVERRIDE` env vars — a global lever to
tighten every endpoint at once during an active incident without a
redeploy.

**Discovered while fixing this:** `evaluate-alerts.ts`'s own code
comment claimed it was "called by pg_cron every 5 minutes," but it was
never actually present in `register_all_crons()`'s job list — meaning
the price-alert-checking feature has likely never run in production.
Registered it as part of this fix.

**Also discovered, not fixed in this pass (flagged for follow-up):**
two different auth-check implementations exist across the 15 endpoints
— most use a direct `apikey !== process.env.SUPABASE_PUBLISHABLE_KEY`
comparison, but `daily-digest`, `evaluate-strategies`,
`generate-strategies`, `resolve-signals`, and `snapshot-portfolio` use
a variant that also falls back to `SUPABASE_ANON_KEY` and checks an
alternate `"Apikey"` header capitalization. Both appear to correctly
reject invalid keys — this is not a BUG-001/002-style hole — but it's
real, undocumented drift the constitution's own principles argue
against. Left alone in this pass specifically to avoid scope creep
(Priority 3's job was rate limiting, not further auth consolidation);
candidate for `TECHNICAL_DEBT.md`.

**Update 2026-08-06 — fixed:** all 5 endpoints migrated onto
`verifyPublicApiKeyFromEnv()`. See `TECHNICAL_DEBT.md` TD-13 for full
detail, including why the `"Apikey"` fallback was confirmed genuinely
dead code (Fetch API header lookups are case-insensitive) before being
removed, and the one downstream reuse (`evaluate-strategies.ts` reusing
the key value for an outbound call) that was preserved rather than
dropped.

Verified on an independent fresh clone + fresh install per the Release
Verification Rule.

**Status:** FIXED 2026-08-06.

---

## FINDING 5 — LOW: `.env` is tracked in git

**File:** `.env` (repo root)

Confirmed via `git ls-files` that this file is committed, and `.gitignore`
has no pattern excluding it.

**Why this is LOW and not CRITICAL, verified:** read the actual tracked
contents. All six values are `SUPABASE_PROJECT_ID`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_URL`, and their `VITE_`-prefixed client-side equivalents — these
are the Supabase *publishable/anon* key and public project identifiers,
which Supabase's own security model is explicitly designed to allow being
public (client-side bundles ship this key to every browser; Row Level
Security is the actual data boundary, not secrecy of this key). This is
NOT the service-role key, and none of `FINNHUB_API_KEY`, `POLYGON_API_KEY`,
or `LOVABLE_API_KEY` appear in this file (those are set as Lovable
environment secrets server-side, confirmed by their exclusive use via
`process.env.X` throughout the server route files, never referenced in
this `.env`).

**Fix (hygiene, not urgent given contents):** Add `.env` to `.gitignore`
and untrack it, to prevent a future genuinely-secret value from being
added to this same file and committed by habit/muscle-memory.

**Status:** FIXED 2026-08-06. `.env`/`.env.local`/`.env.*.local` added to
`.gitignore`; `.env` untracked from git (`git rm --cached`) while the
file itself remains present on disk, unchanged, so local development
isn't disrupted. Verified locally: `tsc --noEmit` (0 errors), `npm run
build` (clean), and the full test suite (186/186) all still succeed with
the file present-but-untracked.

**Stronger verification, added same day:** an independent fresh clone
of the post-fix commit genuinely has NO `.env` file at all (untracked
files aren't part of a clone) — this is a real test of whether the
static build toolchain itself depends on this file, not just a
"nothing broke" check. Result: `tsc --noEmit` (0 errors), `npm run
build` (clean, full production build completes), and the full test
suite (186/186) all succeed with zero `.env` present anywhere. This is
real evidence the build process has no hard dependency on this file.

**One thing still NOT independently verifiable from this environment:**
Lovable Cloud's actual DEPLOY pipeline (as opposed to the static build
toolchain just tested) — whether it injects these values at deploy time
the same way this sandbox's build tooling apparently doesn't need them.
The build succeeding without the file is meaningful evidence toward the
original assumption, but isn't the same as confirming a real Lovable
deploy still works end-to-end. Worth an actual deploy-and-check before
considering this fully closed in production, not just verified here.

---

## FINDING 6 — HIGH (dependency): 2 known CVEs in production dependencies

Verified via `npm audit --omit=dev`:

| Package | Severity | Issue | Fix available |
|---|---|---|---|
| `js-yaml` 4.0.0–4.2.0 | High | YAML merge-key chains cause quadratic CPU consumption (DoS vector) — [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) | Yes, via `npm audit fix` |
| `postcss` ≤8.5.22 | High | Path traversal in source-map auto-loading allows arbitrary `.map` file disclosure — [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | Yes, via `npm audit fix` |

**Status:** FIXED 2026-08-05 (Stage 2, Priority 4). `npm audit fix`
applied both patches at the patch-version level, no major version
bumps: `js-yaml` 4.2.0 → 4.3.1, `postcss` 8.5.15 → 8.5.25. Both are
transitive build-tooling dependencies (via `@tanstack/react-start`/
`eslint` and `vite` respectively), not direct application code — lower
risk than a runtime dependency change. `npm audit --omit=dev` now
reports 0 vulnerabilities. Re-verified `tsc --noEmit` (0 errors),
`npm run build` (exit 0), and the full test suite (94/94) after
applying the fix, then again on an independent fresh clone + fresh
install per the Release Verification Rule — dependency changes are
explicitly one of the change categories that rule covers.

---

## What's solid (verified, not assumed)

- **Auth middleware (`auth-middleware.ts`)**: Lovable-generated, correctly
  validates Bearer JWT structure, calls `supabase.auth.getClaims()` against
  real Supabase Auth, and scopes the resulting client to the user's own
  session — not service-role. Every `createServerFn` using
  `.middleware([requireSupabaseAuth])` inherits proper RLS scoping.
- **10 of 12 checked `/api/public/*` cron endpoints** correctly implement
  the `apikey !== process.env.SUPABASE_PUBLISHABLE_KEY` check before any
  service-role database access.
- **RLS policies exist and follow a consistent pattern** across every new
  table added this project (`agent_signal_weights`, `btc_dominance_snapshots`,
  `market_breadth_snapshots`, `iv_history_snapshots`, `robinhood_snapshots`)
  — authenticated users can only read, service_role does all writes.

## Not yet reviewed in this pass

- Full OWASP Top 10 checklist (only auth/authz, injection-via-Supabase-client
  patterns, and dependency CVEs have been checked so far — XSS surface,
  SSRF via the many external fetch() calls to Polygon/Finnhub/Binance/
  CoinGecko, and insecure deserialization have not been explicitly audited)
- Supply-chain review beyond the automated CVE scan
- Whether Supabase Storage (if used) has appropriate bucket policies
