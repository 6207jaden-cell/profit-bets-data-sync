-- Fixes TRADING_ENGINE_REVIEW.md Finding 5: no explicit lock/mutex
-- against overlapping cron invocations. Crypto and scalp scans both fire
-- every 30 minutes, exit-checks every 10 minutes — if any single
-- invocation runs long (many symbols, a slow upstream API), the next
-- scheduled invocation for the same session type could start before the
-- previous one finishes. This was an unverified architectural gap, not a
-- confirmed-safe pattern — closing it explicitly rather than relying on
-- Postgres-level constraints to happen to prevent the worst outcomes.
--
-- Same atomic pattern already used for rate limiting (see
-- 20260805010000_rate_limiting.sql): a row-locked SECURITY DEFINER
-- function rather than a naive TypeScript-side select-then-write, which
-- would have the exact same race condition this table exists to close.

CREATE TABLE IF NOT EXISTS public.cron_locks (
  lock_key    text        PRIMARY KEY,
  acquired_at timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL
);

ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages cron locks"
  ON public.cron_locks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.try_acquire_cron_lock(
  p_lock_key text,
  p_ttl_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_existing_expires_at timestamptz;
BEGIN
  -- Lock the row (if it exists) for the duration of this transaction so a
  -- concurrent acquire attempt for the same lock_key blocks until this
  -- one commits, making the check-and-acquire sequence atomic.
  SELECT expires_at INTO v_existing_expires_at
  FROM public.cron_locks
  WHERE lock_key = p_lock_key
  FOR UPDATE;

  IF NOT FOUND OR v_existing_expires_at < v_now THEN
    -- No lock exists, or a previous one expired (the holder likely
    -- crashed or ran unexpectedly long without releasing) — acquire it.
    INSERT INTO public.cron_locks (lock_key, acquired_at, expires_at)
    VALUES (p_lock_key, v_now, v_now + (p_ttl_seconds || ' seconds')::interval)
    ON CONFLICT (lock_key) DO UPDATE SET
      acquired_at = v_now, expires_at = v_now + (p_ttl_seconds || ' seconds')::interval;
    RETURN true;
  ELSE
    -- Lock is genuinely held by another in-progress invocation.
    RETURN false;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_cron_lock(p_lock_key text) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.cron_locks WHERE lock_key = p_lock_key;
$function$;

-- Cleanup so this table doesn't grow unbounded — reuses the same daily
-- cleanup cron pattern already established for rate_limit_state.
CREATE OR REPLACE FUNCTION public.cron_lock_cleanup() RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.cron_locks WHERE expires_at < now() - interval '1 hour';
$function$;
