// Centralized authentication utility for /api/public/* cron-triggered
// endpoints. These routes are called by pg_cron via net.http_post with a
// fixed apikey header matching SUPABASE_PUBLISHABLE_KEY — they are not
// user-authenticated (that's requireSupabaseAuth's job for createServerFn
// routes) but they must still verify the caller holds the correct key,
// since they use supabaseAdmin (service-role, bypasses RLS) once inside.
//
// Built as a shared utility specifically because the previous state had
// this exact check duplicated inline across ~15 route files with
// inconsistent correctness: evaluate-alerts.ts had no check at all,
// sync-crons.ts checked presence but not the actual key value. A single,
// tested source of truth removes the possibility of that kind of drift
// recurring. See SECURITY_AUDIT.md Findings 1 and 2, BUG_TRACKER.md
// BUG-001 and BUG-002.

/**
 * Verifies the request's `apikey` header matches the expected secret.
 * Pure function of (request, expectedKey) — expectedKey is passed in
 * explicitly (rather than read from process.env inside this function)
 * specifically so this is unit-testable without needing to mock or set
 * real environment variables.
 */
export function verifyPublicApiKey(request: Request, expectedKey: string | undefined | null): boolean {
  if (!expectedKey) return false; // misconfigured server — never treat a missing expected key as "anything goes"
  const provided = request.headers.get("apikey");
  if (!provided) return false;
  return provided === expectedKey;
}

/** Standard 401 response for a failed public-endpoint auth check. */
export function unauthorizedResponse(): Response {
  return new Response("Unauthorized", { status: 401 });
}

/**
 * Convenience wrapper for the common case: verify against the real
 * SUPABASE_PUBLISHABLE_KEY env var. Route handlers call this directly;
 * verifyPublicApiKey (above) is what gets unit-tested with an explicit
 * expected key, since process.env isn't reliably mockable in every test
 * runner configuration and the underlying comparison logic is what
 * actually matters to test.
 */
export function verifyPublicApiKeyFromEnv(request: Request): boolean {
  return verifyPublicApiKey(request, process.env.SUPABASE_PUBLISHABLE_KEY);
}
