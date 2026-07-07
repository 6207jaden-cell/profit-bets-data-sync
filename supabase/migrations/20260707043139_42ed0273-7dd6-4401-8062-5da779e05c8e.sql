
ALTER TABLE public.strategies ADD COLUMN IF NOT EXISTS explanation text;
ALTER TABLE public.strategies ADD COLUMN IF NOT EXISTS style text;

CREATE TABLE IF NOT EXISTS public.user_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  webhook_url text NOT NULL,
  events text[] NOT NULL DEFAULT ARRAY['trade_open','trade_close','signal_hit','strategy_retired'],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_webhooks TO authenticated;
GRANT ALL ON public.user_webhooks TO service_role;

ALTER TABLE public.user_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_webhooks" ON public.user_webhooks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_strategies_style ON public.strategies(style);
CREATE INDEX IF NOT EXISTS idx_user_webhooks_user ON public.user_webhooks(user_id);

CREATE TRIGGER touch_user_webhooks_updated_at
  BEFORE UPDATE ON public.user_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
