
-- user_settings table
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  autonomous_mode boolean NOT NULL DEFAULT false,
  autonomous_execution_mode text NOT NULL DEFAULT 'paper' CHECK (autonomous_execution_mode IN ('paper','live')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_settings" ON public.user_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- agent_learnings
CREATE TABLE IF NOT EXISTS public.agent_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  analysis text NOT NULL,
  key_insights jsonb NOT NULL DEFAULT '[]'::jsonb,
  adjustments jsonb NOT NULL DEFAULT '[]'::jsonb,
  trades_analyzed integer NOT NULL DEFAULT 0,
  win_rate numeric,
  avg_pnl_pct numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_learnings TO authenticated;
GRANT ALL ON public.agent_learnings TO service_role;
ALTER TABLE public.agent_learnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_learnings" ON public.agent_learnings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- agent_decisions
CREATE TABLE IF NOT EXISTS public.agent_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_type text NOT NULL,
  regime text,
  market_assessment text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  trades_opened integer NOT NULL DEFAULT 0,
  trades_closed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_decisions TO authenticated;
GRANT ALL ON public.agent_decisions TO service_role;
ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_decisions" ON public.agent_decisions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_user_created ON public.agent_decisions(user_id, created_at DESC);

-- agent_messages
CREATE TABLE IF NOT EXISTS public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'assistant',
  content text NOT NULL,
  is_autonomous boolean NOT NULL DEFAULT false,
  session_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_messages TO authenticated;
GRANT ALL ON public.agent_messages TO service_role;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_messages" ON public.agent_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_user_created ON public.agent_messages(user_id, created_at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_messages;

-- paper_trades additional columns
ALTER TABLE public.paper_trades ADD COLUMN IF NOT EXISTS hold_duration text;
ALTER TABLE public.paper_trades ADD COLUMN IF NOT EXISTS stop_loss_pct numeric;
ALTER TABLE public.paper_trades ADD COLUMN IF NOT EXISTS take_profit_pct numeric;
ALTER TABLE public.paper_trades ADD COLUMN IF NOT EXISTS instrument text NOT NULL DEFAULT 'stock';
ALTER TABLE public.paper_trades ADD COLUMN IF NOT EXISTS options_details jsonb;
ALTER TABLE public.paper_trades ADD COLUMN IF NOT EXISTS rationale text;
CREATE INDEX IF NOT EXISTS idx_paper_trades_hold_duration ON public.paper_trades(hold_duration) WHERE is_open = true;
