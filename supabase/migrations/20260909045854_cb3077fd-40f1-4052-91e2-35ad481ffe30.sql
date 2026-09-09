CREATE OR REPLACE FUNCTION public.rate_limit_increment(p_bucket_key text, p_window_start timestamp with time zone)
 RETURNS TABLE(request_count integer, is_new_window boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_variable
DECLARE
  v_existing_window_start timestamptz;
  v_count integer;
BEGIN
  SELECT s.window_start, s.request_count INTO v_existing_window_start, v_count
  FROM public.rate_limit_state s
  WHERE s.bucket_key = p_bucket_key
  FOR UPDATE;

  IF NOT FOUND OR v_existing_window_start <> p_window_start THEN
    INSERT INTO public.rate_limit_state (bucket_key, window_start, request_count, updated_at)
    VALUES (p_bucket_key, p_window_start, 1, now())
    ON CONFLICT (bucket_key) DO UPDATE SET
      window_start = p_window_start, request_count = 1, updated_at = now();
    RETURN QUERY SELECT 1, true;
  ELSE
    UPDATE public.rate_limit_state s
    SET request_count = s.request_count + 1, updated_at = now()
    WHERE s.bucket_key = p_bucket_key
    RETURNING s.request_count INTO v_count;
    RETURN QUERY SELECT v_count, false;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.rate_limit_increment(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rate_limit_increment(text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.rate_limit_increment(text, timestamptz) TO service_role;