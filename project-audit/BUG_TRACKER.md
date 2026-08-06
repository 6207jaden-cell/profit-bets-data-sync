# BUG_TRACKER.md
Last updated: 2026-08-06 (Pass 2 — corrected BUG-001/BUG-002 status, left stale since their actual fixes in Stage 2; Pass 1 content otherwise unchanged)

Format: severity, root cause, affected files, status, fix, verification steps.
Every entry here was directly verified by reading code — none are
speculative.

---

## BUG-001 — CRITICAL — `evaluate-alerts.ts` has no authorization check

**Severity:** Critical
**Root cause:** Handler function signature omits `request` parameter
entirely, so the intended apikey check (documented in the file's own
comment) was never implemented.
**Affected files:** `src/routes/api/public/evaluate-alerts.ts`
**Status:** FIXED (Stage 2, Priority 1, 2026-08-05). This entry was left
stale after the fix landed — corrected 2026-08-06 after a user question
prompted a full re-audit of this document against `SECURITY_AUDIT.md`
and the actual code, which had already been updated correctly. Fixed
using a new shared, tested utility (`src/lib/api-auth.ts`).
**Fix:** Add `{ request }: { request: Request }` to the handler signature
and the standard `apikey !== process.env.SUPABASE_PUBLISHABLE_KEY` guard
used by every sibling cron endpoint.
**Verification steps:** After fix, confirm (1) `tsc --noEmit` passes,
(2) a manual POST without the correct apikey header returns 401,
(3) the existing pg_cron job (which sends the correct header) still
succeeds — check `agent_decisions`/notification behavior is unaffected.

Full detail: see SECURITY_AUDIT.md Finding 1.

---

## BUG-002 — HIGH — `sync-crons.ts` auth check doesn't verify the key value

**Severity:** High
**Root cause:** `if (!apikey)` checks presence only, not correctness.
**Affected files:** `src/routes/api/public/sync-crons.ts`
**Status:** FIXED (Stage 2, Priority 2, 2026-08-05). Same staleness as
BUG-001 — corrected 2026-08-06. Fixed using the same shared utility as
BUG-001, deliberately, since both bugs shared the same root cause
(duplicated inline auth checks with no single source of truth).
**Fix:** Change to `if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY)`.
**Verification steps:** Same pattern as BUG-001 — confirm rejection with
wrong/missing key, confirm the Settings → "Sync Cron Jobs" button in the
app still works with the correct key.

Full detail: see SECURITY_AUDIT.md Finding 2.

---

## BUG-003 — MEDIUM — `iron_condor` instrument type is choosable by the AI but not executable

**Severity:** Medium (silent incorrect behavior, not a crash)
**Root cause:** The JSON schema in the swing system prompt
(`autonomous-agent.ts`) lists `"iron_condor"` as a valid `instrument`
value, but the trade-execution code's `isOptionsInstrument` check only
recognizes `["call", "put", "call_spread", "put_spread"]`. If Claude ever
proposed `instrument: "iron_condor"`, it would silently fall through to
stock-style position math (buying "shares" of a nonexistent 4-leg spread
"stock"), producing a nonsensical position and incorrect P&L.
**Affected files:** `src/routes/api/public/autonomous-agent.ts`
**Status:** FIXED (2026-08-06). Removed `"iron_condor"` from the JSON
schema (option (a) from the fix below — building real 4-leg execution
was out of scope for this fix and remains genuinely unbuilt). Also
fixed the ROOT CAUSE, not just this one symptom: the schema enum and
`isOptionsInstrument`'s check array were two independently-maintained
lists that had drifted apart — that's specifically what let this bug
exist. Extracted a single shared source of truth
(`src/lib/instruments.ts`, `ALL_PROPOSABLE_INSTRUMENT_TYPES` /
`isOptionsInstrumentType`) used to build BOTH the schema string and the
execution check, plus a third duplicate list found and consolidated in
`snapshot-portfolio.ts` along the way. 12 tests, including two
regression guards that read the actual route files' source text and
assert neither the string `"iron_condor"` nor a new hardcoded duplicate
list can silently reappear.
**Fix (not yet done):** Either (a) remove `"iron_condor"` from the JSON
schema entirely until real 4-leg spread execution is built, or (b)
build actual iron condor execution (multi-leg order construction, net
credit tracking, defined max-loss/max-gain P&L math instead of simple
quantity × price). ~~Not yet done~~ — (a) done, see Status above. (b)
remains open if 4-leg execution is ever wanted as a real feature.
**Verification steps:** Grep `agent_decisions.payload` / closed
`paper_trades.instrument` for any historical `iron_condor` entries to
confirm whether this has actually fired in production yet. If it has,
those trades' recorded P&L should be treated as unreliable. **This step
was NOT performed** — it requires live database access this review
process doesn't have (same constraint noted throughout Stage 3.5).
Worth checking directly against the live database when convenient.

---

## BUG-004 — LOW — `.env` tracked in git despite gitignore having no exclusion for it

**Severity:** Low (verified contents are publishable-safe, not secret)
**Root cause:** No `.env` pattern in `.gitignore`.
**Affected files:** `.env`, `.gitignore`
**Status:** FIXED 2026-08-06. See `SECURITY_AUDIT.md` Finding 5 for full
verification detail, including the one thing NOT independently
confirmable from this sandbox (actual Lovable deploy behavior).
**Fix:** Add `.env` to `.gitignore`, then `git rm --cached .env`.
**Verification steps:** Confirm the app still builds/runs after untracking
(Lovable Cloud likely injects these as real environment variables at
deploy time regardless of the tracked file, but verify rather than
assume).

Full detail: see SECURITY_AUDIT.md Finding 5.

---

## BUG-005 — HIGH (dependency) — 2 known CVEs in production dependencies

**Severity:** High
**Root cause:** Outdated `js-yaml` and `postcss` versions.
**Affected files:** `package.json` / `package-lock.json` (transitive deps)
**Status:** FIXED 2026-08-05 (Stage 2, Priority 4). `npm audit fix`
applied — `js-yaml` 4.2.0→4.3.1, `postcss` 8.5.15→8.5.25, both patch-
level, no major bumps. `npm audit --omit=dev` now reports 0
vulnerabilities. Full quality gates (tsc, build, vitest) re-run clean
afterward, plus independent fresh-clone verification.
**Fix:** `npm audit fix`, then re-run `tsc --noEmit` and `npm run build`
to confirm nothing broke.
**Verification steps:** Re-run `npm audit --omit=dev` after the fix and
confirm 0 vulnerabilities reported.

---

## Previously known, already fixed (for the record — not re-opening)

These were found and fixed in earlier sessions this project, listed here
only so this tracker is a complete historical record, not because they're
still open:

- Rules-of-Hooks violation crashing the Positions tab (hooks called after
  a conditional early return) — fixed.
- `journal.data!` and `trades.data!` non-null assertions crashing on
  first render before query data resolved — fixed, changed to `?? []`.
- `FetchResult` wrapper (`{ available, data }`) being treated as a bare
  array and having `.find()` called directly on it — fixed.
- Sector filter (`isSectorBullish`) silently blocking trades with no
  `debugSkips` entry, making 0-trades-executed scans unexplainable —
  fixed, now logs `sector_bearish` with detail.
- "Trim" (partial close) being a complete no-op despite the AI being told
  it could recommend it — fixed, now genuinely implemented.
- Trade-open notification multiplying already-whole-percent stop/target
  values by 100 (displaying e.g. "150%" instead of "1.5%") — fixed.
