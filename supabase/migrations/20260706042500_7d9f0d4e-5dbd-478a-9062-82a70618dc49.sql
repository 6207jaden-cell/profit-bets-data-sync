CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT _user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id
        AND role = _role
    )
$$;

CREATE OR REPLACE FUNCTION public.has_tier(_user_id UUID, _min public.app_tier)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT _user_id = auth.uid()
    AND COALESCE(
      (SELECT public.tier_rank(tier) FROM public.user_tiers WHERE user_id = _user_id),
      0
    ) >= public.tier_rank(_min)
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_tier(uuid, public.app_tier) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_tier(uuid, public.app_tier) TO service_role;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_tier(uuid, public.app_tier) FROM anon;