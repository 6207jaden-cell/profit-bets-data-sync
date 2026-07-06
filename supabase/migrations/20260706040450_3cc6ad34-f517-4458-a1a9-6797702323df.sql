-- Pin search_path on tier_rank
CREATE OR REPLACE FUNCTION public.tier_rank(_tier public.app_tier)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _tier
    WHEN 'free' THEN 0
    WHEN 'pro' THEN 1
    WHEN 'elite' THEN 2
  END
$$;

-- Restrict EXECUTE on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.has_tier(uuid, public.app_tier) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_tier(uuid, public.app_tier) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user_tier() FROM PUBLIC, anon, authenticated;