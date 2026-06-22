
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.user_tier AS ENUM ('free', 'starter', 'pro', 'premium');
CREATE TYPE public.signal_type AS ENUM ('options_flow', 'buy_sell');
CREATE TYPE public.signal_direction AS ENUM ('call', 'put', 'buy', 'sell');
CREATE TYPE public.signal_result AS ENUM ('open', 'hit_target', 'hit_stop', 'stale');
CREATE TYPE public.asset_type AS ENUM ('stock', 'crypto');
CREATE TYPE public.alert_direction AS ENUM ('above', 'below');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  tier public.user_tier NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- ============ AUTO-CREATE PROFILE ON SIGNUP ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ MARKET SIGNALS ============
CREATE TABLE public.market_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  signal_type public.signal_type NOT NULL,
  direction public.signal_direction NOT NULL,
  confidence NUMERIC(5,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  entry_price NUMERIC(18,6),
  target_price NUMERIC(18,6),
  stop_price NUMERIC(18,6),
  expected_edge_pct NUMERIC(8,2),
  thesis TEXT,
  result public.signal_result NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  resolved_pnl_pct NUMERIC(8,2),
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX market_signals_created_at_idx ON public.market_signals (created_at DESC);
CREATE INDEX market_signals_user_id_idx ON public.market_signals (user_id);
GRANT SELECT ON public.market_signals TO authenticated;
GRANT ALL ON public.market_signals TO service_role;
ALTER TABLE public.market_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read public signals" ON public.market_signals FOR SELECT TO authenticated USING (is_public = true OR auth.uid() = user_id);

-- ============ MARKET TRACKING (watchlist) ============
CREATE TABLE public.market_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  asset_type public.asset_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, asset, asset_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_tracking TO authenticated;
GRANT ALL ON public.market_tracking TO service_role;
ALTER TABLE public.market_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own tracking" ON public.market_tracking FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ PRICE ALERTS ============
CREATE TABLE public.price_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  asset_type public.asset_type NOT NULL,
  target_price NUMERIC(18,6) NOT NULL,
  direction public.alert_direction NOT NULL,
  triggered BOOLEAN NOT NULL DEFAULT false,
  triggered_at TIMESTAMPTZ,
  triggered_price NUMERIC(18,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX price_alerts_user_id_idx ON public.price_alerts (user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_alerts TO authenticated;
GRANT ALL ON public.price_alerts TO service_role;
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own alerts" ON public.price_alerts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ MANUAL POSITIONS (portfolio) ============
CREATE TABLE public.manual_positions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  asset_type public.asset_type NOT NULL,
  shares NUMERIC(18,6) NOT NULL,
  cost_basis NUMERIC(18,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX manual_positions_user_id_idx ON public.manual_positions (user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_positions TO authenticated;
GRANT ALL ON public.manual_positions TO service_role;
ALTER TABLE public.manual_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own positions" ON public.manual_positions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ REALTIME ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.price_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.market_signals;
