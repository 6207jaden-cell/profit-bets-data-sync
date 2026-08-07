// TRADING_ENGINE_REVIEW.md Finding 5: no explicit lock/mutex against
// overlapping cron invocations. This is the shared, reusable utility any
// cron-triggered endpoint can use to guard against a slow-running
// invocation overlapping with the next scheduled one for the same
// session type — built once, applied wherever needed, rather than each
// endpoint growing its own copy (the exact drift risk that caused
// BUG-001/BUG-002 and TD-13 elsewhere in this project).

type SupabaseAdminClient = any; // same documented pattern as rate-limit.ts and the other Stage 2/3 shared modules

export type LockAcquireResult = {
  acquired: boolean;
};

/**
 * Attempts to acquire a lock for `lockKey`, valid for `ttlSeconds`. Returns
 * `{ acquired: true }` if this call got the lock (the caller should
 * proceed and call `releaseCronLock` when done), or `{ acquired: false }`
 * if another invocation genuinely holds it right now (the caller should
 * skip this run rather than risk overlapping work).
 *
 * Fails OPEN on infrastructure errors (DB unreachable, RPC failure) — the
 * same deliberate tradeoff already documented for rate-limit.ts: this is
 * a defense-in-depth safeguard against overlap, not the primary
 * correctness guarantee for trading behavior. If the lock check itself
 * becomes unavailable, blocking all scheduled trading scans would be a
 * worse outcome than occasionally risking (rather than reliably
 * preventing) an overlap during a transient infrastructure issue.
 */
export async function tryAcquireCronLock(
  supabaseAdmin: SupabaseAdminClient,
  lockKey: string,
  ttlSeconds: number,
): Promise<LockAcquireResult> {
  try {
    const { data, error } = await supabaseAdmin.rpc("try_acquire_cron_lock", {
      p_lock_key: lockKey,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) throw error;
    return { acquired: data === true };
  } catch (e) {
    console.warn("[cron-lock] acquire check failed, failing open:", String(e));
    return { acquired: true };
  }
}

/**
 * Releases a lock this invocation acquired, so the NEXT scheduled
 * invocation doesn't have to wait out the full TTL once this one finishes
 * normally. Best-effort — if release fails (e.g. a crash before this
 * line runs, or a transient DB error), the lock still self-clears via its
 * TTL, so a failed release is not a correctness problem, just a slightly
 * longer wait for the next invocation in the rare case it happens.
 */
export async function releaseCronLock(supabaseAdmin: SupabaseAdminClient, lockKey: string): Promise<void> {
  try {
    await supabaseAdmin.rpc("release_cron_lock", { p_lock_key: lockKey });
  } catch (e) {
    console.warn("[cron-lock] release failed (non-fatal, will self-clear via TTL):", String(e));
  }
}
