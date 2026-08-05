-- Stage 2, Priority 3: application-level rate limiting. Fixed-window
-- counter backed by Postgres (no Redis in this architecture) — the only
-- approach that works correctly across serverless invocations, where an
-- in-memory counter would reset on every cold start and provide no real
-- protection.
--
-- The increment is done via a SECURITY DEFINER function using `FOR UPDATE`
-- row locking rather than a naive TypeScript-side select-then-write, which
-- would have a real race condition: two concurrent requests could both read
-- the same count and both believe they're under the limit, allowing an
-- overcount. This matters here specifically because several endpoints
-- (autonomous-agent) are legitimately called by multiple near-simultaneous
-- cron schedules.

CREATE TABLE IF NOT EXISTS public.rate_limit_state (
  bucket_key    text        PRIMARY KEY,
  window_start  timestamptz NOT NULL,
  request_count integer     NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rate_limit_state ENABLE ROW LEVEL SECURITY;

-- Pure infrastructure bookkeeping — no user ever needs to read this
-- directly, unlike the analytics/snapshot tables elsewhere in this project.
CREATE POLICY "Service role manages rate limit state"
  ON public.rate_limit_state FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.rate_limit_increment(
  p_bucket_key text,
  p_window_start timestamptz
) RETURNS TABLE(request_count integer, is_new_window boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_window_start timestamptz;
  v_count integer;
BEGIN
  -- Lock the row (if it exists) for the duration of this transaction so a
  -- concurrent call for the same bucket_key blocks until this one commits,
  -- making the read-check-increment sequence atomic.
  SELECT window_start, request_count INTO v_existing_window_start, v_count
  FROM public.rate_limit_state
  WHERE bucket_key = p_bucket_key
  FOR UPDATE;

  IF NOT FOUND OR v_existing_window_start <> p_window_start THEN
    -- Either the bucket has never been seen, or the window has rolled over
    -- since the last request — reset to a fresh count of 1.
    INSERT INTO public.rate_limit_state (bucket_key, window_start, request_count, updated_at)
    VALUES (p_bucket_key, p_window_start, 1, now())
    ON CONFLICT (bucket_key) DO UPDATE SET
      window_start = p_window_start, request_count = 1, updated_at = now();
    RETURN QUERY SELECT 1, true;
  ELSE
    UPDATE public.rate_limit_state
    SET request_count = request_count + 1, updated_at = now()
    WHERE bucket_key = p_bucket_key
    RETURNING public.rate_limit_state.request_count INTO v_count;
    RETURN QUERY SELECT v_count, false;
  END IF;
END;
$function$;

-- Periodic cleanup so this table doesn't grow unbounded — a bucket not
-- updated in 24h is definitely stale (the longest window any endpoint uses
-- is measured in hours, not days).
CREATE OR REPLACE FUNCTION public.rate_limit_cleanup() RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.rate_limit_state WHERE updated_at < now() - interval '24 hours';
$function$;
