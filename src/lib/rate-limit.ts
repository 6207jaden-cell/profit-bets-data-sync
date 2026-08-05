// Stage 2, Priority 3: shared rate-limiting infrastructure for every
// /api/public/* endpoint. Postgres-backed fixed-window counter (no Redis
// in this architecture — this is the only approach that works correctly
// across serverless invocations, where in-memory state resets on every
// cold start). Atomic via a row-locked SECURITY DEFINER function
// (rate_limit_increment, see the migration) rather than a naive
// TypeScript-side select-then-write, which would have a real race
// condition under concurrent calls.
//
// Built as ONE shared module specifically so every endpoint gets the same
// tested logic — this is the same lesson BUG-001/BUG-002 already taught
// about auth checks (inline, duplicated logic drifts and diverges). Each
// endpoint configures its OWN limit, window, and identifier strategy by
// passing a RateLimitConfig; none of that requires touching this file.

export type SupabaseAdminClient = any; // see api-auth.ts / signal-learning.ts for the same documented pattern

export type RateLimitConfig = {
  /** Bucket identifier — build with endpointBucketKey() or a custom strategy. */
  key: string;
  maxRequests: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
};

/**
 * Checks and increments the rate limit counter for a bucket in one atomic
 * database round-trip. Fails OPEN on infrastructure errors (DB unreachable,
 * RPC failure) — a deliberate, documented tradeoff: rate limiting is
 * defense-in-depth layered on top of the actual authorization check
 * (api-auth.ts), not the primary security boundary. If the rate limiter
 * itself becomes unavailable, blocking all legitimate cron traffic
 * (including the actual trading scans) would be a worse outcome than
 * briefly operating without this specific layer of protection. Failing
 * CLOSED only happens when a real, successfully-checked limit is exceeded.
 */
export async function checkRateLimit(
  supabaseAdmin: SupabaseAdminClient,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const { key: bucketKey, maxRequests, windowSeconds } = config;
  const windowMs = windowSeconds * 1000;
  const nowMs = Date.now();
  const currentWindowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const resetAt = new Date(currentWindowStart.getTime() + windowMs);

  try {
    const { data, error } = await supabaseAdmin.rpc("rate_limit_increment", {
      p_bucket_key: bucketKey,
      p_window_start: currentWindowStart.toISOString(),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const requestCount = Number(row?.request_count);
    if (!Number.isFinite(requestCount)) throw new Error("rate_limit_increment returned no usable count");

    if (requestCount > maxRequests) {
      return { allowed: false, remaining: 0, resetAt, limit: maxRequests };
    }
    return { allowed: true, remaining: Math.max(0, maxRequests - requestCount), resetAt, limit: maxRequests };
  } catch (e) {
    console.warn("[rate-limit] check failed, failing open:", String(e));
    return { allowed: true, remaining: maxRequests, resetAt, limit: maxRequests };
  }
}

// ── Identifier strategies ────────────────────────────────────────────────
// Each builds a bucket key differently. Endpoints pick whichever strategy
// fits their actual traffic pattern rather than this module imposing one.

/**
 * Global limit per endpoint, regardless of caller. Appropriate for this
 * project's actual traffic pattern: every /api/public/* endpoint is called
 * by a small, fixed set of pg_cron schedules with a known, predictable
 * cadence — the realistic threat is a stolen/leaked apikey being used to
 * spam the endpoint, not distinguishing between many different legitimate
 * callers (there is normally only one: the cron scheduler itself). This is
 * the default/recommended strategy for this project.
 */
export function endpointBucketKey(endpointName: string): string {
  return `endpoint:${endpointName}`;
}

/**
 * Per-endpoint, per-client-IP limit — finer-grained defense in depth.
 * Available for any endpoint where distinguishing callers matters (e.g. if
 * an endpoint is ever exposed to genuinely multiple legitimate callers).
 * Falls back to a shared "unknown" bucket when no IP header is present
 * (some serverless/edge runtimes don't reliably forward one) — this
 * intentionally degrades toward the global-limit behavior rather than
 * silently exempting IP-less requests from any limit at all.
 */
export function endpointAndIpBucketKey(endpointName: string, request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  return `endpoint:${endpointName}:ip:${ip}`;
}

// ── Env-var configurability ──────────────────────────────────────────────

/**
 * Resolves an endpoint's effective limit: its own hardcoded defaults
 * (chosen per-endpoint based on real cron cadence, generous headroom above
 * legitimate traffic), overridable globally via env vars without a
 * redeploy — e.g. to tighten every endpoint at once during an active abuse
 * incident. Per-endpoint env var overrides aren't provided (that would need
 * one env var per endpoint for 15+ endpoints); the global override is the
 * operationally useful lever, and normal operation uses the per-endpoint
 * defaults each route passes in.
 */
export function resolveRateLimit(defaultMaxRequests: number, defaultWindowSeconds: number): { maxRequests: number; windowSeconds: number } {
  const envMax = process.env.RATE_LIMIT_MAX_REQUESTS_OVERRIDE;
  const envWindow = process.env.RATE_LIMIT_WINDOW_SECONDS_OVERRIDE;
  const maxRequests = envMax && Number.isFinite(Number(envMax)) ? Number(envMax) : defaultMaxRequests;
  const windowSeconds = envWindow && Number.isFinite(Number(envWindow)) ? Number(envWindow) : defaultWindowSeconds;
  return { maxRequests, windowSeconds };
}

// ── Route-handler convenience wrapper ────────────────────────────────────

/**
 * The pattern every route handler uses: one call, returns either a ready-
 * to-send 429 Response (rate limited) or null (proceed). Keeps route files
 * to a single added line rather than requiring each one to know about
 * RateLimitResult's shape or build its own 429 response.
 */
export async function enforceRateLimit(
  supabaseAdmin: SupabaseAdminClient,
  config: RateLimitConfig,
): Promise<Response | null> {
  const result = await checkRateLimit(supabaseAdmin, config);
  if (result.allowed) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
  return Response.json(
    { ok: false, error: "rate_limited", limit: result.limit, retry_after_seconds: retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
