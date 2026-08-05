import { describe, it, expect, afterEach } from "vitest";
import {
  checkRateLimit, enforceRateLimit, endpointBucketKey, endpointAndIpBucketKey,
  resolveRateLimit,
} from "@/lib/rate-limit";

/**
 * Mock Supabase client simulating the rate_limit_increment RPC. Tracks
 * calls so tests can assert exactly what bucket/window was requested,
 * without needing a real Postgres instance — the RPC's own atomicity
 * (row-locking) is a database-level guarantee tested by the migration's
 * SQL, not something a JS-side mock can meaningfully re-verify; what's
 * tested here is that the TypeScript layer interprets the RPC's response
 * correctly and applies the right limit/window logic around it.
 */
function makeMockSupabase(initialCounts: Record<string, number> = {}) {
  const counts = { ...initialCounts };
  const calls: Array<{ bucket_key: string; window_start: string }> = [];
  const mock = {
    rpc: async (_fn: string, params: { p_bucket_key: string; p_window_start: string }) => {
      calls.push({ bucket_key: params.p_bucket_key, window_start: params.p_window_start });
      const bucketWindowKey = `${params.p_bucket_key}::${params.p_window_start}`;
      counts[bucketWindowKey] = (counts[bucketWindowKey] ?? 0) + 1;
      return { data: [{ request_count: counts[bucketWindowKey], is_new_window: counts[bucketWindowKey] === 1 }], error: null };
    },
  };
  return { mock: mock as any, calls };
}

describe("checkRateLimit", () => {
  it("allows requests under the limit", async () => {
    const { mock } = makeMockSupabase();
    const result = await checkRateLimit(mock, { key: "test-bucket", maxRequests: 5, windowSeconds: 60 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.limit).toBe(5);
  });

  it("blocks requests once the limit is exceeded within the same window", async () => {
    const { mock } = makeMockSupabase();
    const config = { key: "test-bucket-2", maxRequests: 3, windowSeconds: 60 };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await checkRateLimit(mock, config));
    expect(results[0].allowed).toBe(true);
    expect(results[1].allowed).toBe(true);
    expect(results[2].allowed).toBe(true);
    expect(results[3].allowed).toBe(false);
    expect(results[4].allowed).toBe(false);
  });

  it("provides an accurate resetAt time aligned to the window boundary", async () => {
    const { mock } = makeMockSupabase();
    const windowSeconds = 60;
    const before = Date.now();
    const result = await checkRateLimit(mock, { key: "test-bucket-3", maxRequests: 5, windowSeconds });
    const resetMs = result.resetAt.getTime();
    expect(resetMs).toBeGreaterThan(before);
    expect(resetMs - before).toBeLessThanOrEqual(windowSeconds * 1000 + 1000);
  });

  it("resets the counter in a new window (bucket_key includes window_start, so a stale window's count doesn't carry over)", async () => {
    const { mock, calls } = makeMockSupabase();
    const config = { key: "test-bucket-4", maxRequests: 1, windowSeconds: 1 };
    const first = await checkRateLimit(mock, config);
    expect(first.allowed).toBe(true);
    const second = await checkRateLimit(mock, config);
    expect(second.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const third = await checkRateLimit(mock, config);
    expect(third.allowed).toBe(true);

    const windowStarts = calls.filter((c) => c.bucket_key === "test-bucket-4").map((c) => c.window_start);
    expect(new Set(windowStarts).size).toBeGreaterThan(1);
  });

  it("different bucket keys are independent — one endpoint being rate limited doesn't affect another", async () => {
    const { mock } = makeMockSupabase();
    const configA = { key: "endpoint-a", maxRequests: 1, windowSeconds: 60 };
    const configB = { key: "endpoint-b", maxRequests: 1, windowSeconds: 60 };
    await checkRateLimit(mock, configA);
    const blockedA = await checkRateLimit(mock, configA);
    const allowedB = await checkRateLimit(mock, configB);
    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it("fails OPEN when the underlying RPC errors — a rate-limiter outage must not block legitimate cron traffic", async () => {
    const throwingMock = { rpc: async () => { throw new Error("simulated DB outage"); } };
    const result = await checkRateLimit(throwingMock as any, { key: "test-bucket-5", maxRequests: 5, windowSeconds: 60 });
    expect(result.allowed).toBe(true);
  });

  it("fails OPEN when the RPC returns an error field instead of throwing", async () => {
    const errorMock = { rpc: async () => ({ data: null, error: { message: "connection refused" } }) };
    const result = await checkRateLimit(errorMock as any, { key: "test-bucket-6", maxRequests: 5, windowSeconds: 60 });
    expect(result.allowed).toBe(true);
  });

  it("fails OPEN when the RPC returns malformed/unusable data", async () => {
    const malformedMock = { rpc: async () => ({ data: [{ not_a_count: "oops" }], error: null }) };
    const result = await checkRateLimit(malformedMock as any, { key: "test-bucket-7", maxRequests: 5, windowSeconds: 60 });
    expect(result.allowed).toBe(true);
  });
});

describe("enforceRateLimit (route-handler wrapper)", () => {
  it("returns null (proceed) when under the limit", async () => {
    const { mock } = makeMockSupabase();
    const response = await enforceRateLimit(mock, { key: "wrapper-test-1", maxRequests: 5, windowSeconds: 60 });
    expect(response).toBeNull();
  });

  it("returns a 429 Response with a Retry-After header when the limit is exceeded", async () => {
    const { mock } = makeMockSupabase();
    const config = { key: "wrapper-test-2", maxRequests: 1, windowSeconds: 60 };
    await enforceRateLimit(mock, config);
    const response = await enforceRateLimit(mock, config);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    expect(response!.headers.get("Retry-After")).not.toBeNull();
    const body = await response!.json();
    expect(body.error).toBe("rate_limited");
  });
});

describe("bucket key strategies", () => {
  it("endpointBucketKey produces a stable, predictable key for a given endpoint name", () => {
    expect(endpointBucketKey("evaluate-alerts")).toBe("endpoint:evaluate-alerts");
    expect(endpointBucketKey("evaluate-alerts")).toBe(endpointBucketKey("evaluate-alerts"));
  });

  it("endpointAndIpBucketKey produces DIFFERENT keys for different client IPs — this is what prevents one caller's abuse from exhausting another caller's quota", () => {
    const req1 = new Request("https://x.com", { headers: { "x-forwarded-for": "1.1.1.1" } });
    const req2 = new Request("https://x.com", { headers: { "x-forwarded-for": "2.2.2.2" } });
    const key1 = endpointAndIpBucketKey("test-endpoint", req1);
    const key2 = endpointAndIpBucketKey("test-endpoint", req2);
    expect(key1).not.toBe(key2);
  });

  it("endpointAndIpBucketKey degrades to a shared 'unknown' bucket rather than exempting IP-less requests from any limit", () => {
    const req = new Request("https://x.com");
    const key = endpointAndIpBucketKey("test-endpoint", req);
    expect(key).toContain("unknown");
  });

  it("endpointAndIpBucketKey uses only the first IP in a comma-separated x-forwarded-for chain", () => {
    const req = new Request("https://x.com", { headers: { "x-forwarded-for": "3.3.3.3, 4.4.4.4, 5.5.5.5" } });
    const key = endpointAndIpBucketKey("test-endpoint", req);
    expect(key).toContain("3.3.3.3");
    expect(key).not.toContain("4.4.4.4");
  });
});

describe("resolveRateLimit (env-var configurability)", () => {
  const originalMax = process.env.RATE_LIMIT_MAX_REQUESTS_OVERRIDE;
  const originalWindow = process.env.RATE_LIMIT_WINDOW_SECONDS_OVERRIDE;

  afterEach(() => {
    if (originalMax === undefined) delete process.env.RATE_LIMIT_MAX_REQUESTS_OVERRIDE;
    else process.env.RATE_LIMIT_MAX_REQUESTS_OVERRIDE = originalMax;
    if (originalWindow === undefined) delete process.env.RATE_LIMIT_WINDOW_SECONDS_OVERRIDE;
    else process.env.RATE_LIMIT_WINDOW_SECONDS_OVERRIDE = originalWindow;
  });

  it("uses the endpoint's own defaults when no env override is set", () => {
    delete process.env.RATE_LIMIT_MAX_REQUESTS_OVERRIDE;
    delete process.env.RATE_LIMIT_WINDOW_SECONDS_OVERRIDE;
    const result = resolveRateLimit(20, 300);
    expect(result).toEqual({ maxRequests: 20, windowSeconds: 300 });
  });

  it("uses the env override when set, ignoring the endpoint's own default — the operational 'tighten everything at once' lever", () => {
    process.env.RATE_LIMIT_MAX_REQUESTS_OVERRIDE = "5";
    process.env.RATE_LIMIT_WINDOW_SECONDS_OVERRIDE = "30";
    const result = resolveRateLimit(20, 300);
    expect(result).toEqual({ maxRequests: 5, windowSeconds: 30 });
  });

  it("ignores a malformed (non-numeric) env override and falls back to the default rather than producing NaN limits", () => {
    process.env.RATE_LIMIT_MAX_REQUESTS_OVERRIDE = "not-a-number";
    const result = resolveRateLimit(20, 300);
    expect(result.maxRequests).toBe(20);
  });
});
