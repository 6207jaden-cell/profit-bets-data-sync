REVOKE EXECUTE ON FUNCTION public.rate_limit_increment(text, timestamptz) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rate_limit_cleanup() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.try_acquire_cron_lock(text, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.release_cron_lock(text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.cron_lock_cleanup() FROM anon, authenticated, public;

GRANT EXECUTE ON FUNCTION public.rate_limit_increment(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.rate_limit_cleanup() TO service_role;
GRANT EXECUTE ON FUNCTION public.try_acquire_cron_lock(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lock(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_lock_cleanup() TO service_role;