-- Tier enum with ordered levels
CREATE TYPE public.app_tier AS ENUM ('free', 'pro', 'elite');

-- Ordinal helper (elite > pro > free)
CREATE OR REPLACE FUNCTION public.tier_rank(_tier public.app_tier)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _tier
    WHEN 'free' THEN 0
    WHEN 'pro' THEN 1
    WHEN 'elite' THEN 2
  END
$$;

-- Per-user tier assignment (separate from user_roles per security guidance)
CREATE TABLE public.user_tiers (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier public.app_tier NOT NULL DEFAULT 'free',
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_tiers TO authenticated;
GRANT ALL ON public.user_tiers TO service_role;

ALTER TABLE public.user_tiers ENABLE ROW LEVEL SECURITY;

-- Users can read their own tier
CREATE POLICY "Users read own tier"
  ON public.user_tiers FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admins can read/manage all tiers
CREATE POLICY "Admins read all tiers"
  ON public.user_tiers FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert tiers"
  ON public.user_tiers FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update tiers"
  ON public.user_tiers FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete tiers"
  ON public.user_tiers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER user_tiers_touch_updated_at
  BEFORE UPDATE ON public.user_tiers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SECURITY DEFINER check: does the user meet at least this tier?
CREATE OR REPLACE FUNCTION public.has_tier(_user_id UUID, _min public.app_tier)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT public.tier_rank(tier) FROM public.user_tiers WHERE user_id = _user_id),
    0
  ) >= public.tier_rank(_min)
$$;

-- Auto-provision a 'free' tier row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_tiers (user_id, tier)
  VALUES (NEW.id, 'free')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_tier
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_tier();

-- Backfill existing users at 'free'
INSERT INTO public.user_tiers (user_id, tier)
SELECT id, 'free' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;