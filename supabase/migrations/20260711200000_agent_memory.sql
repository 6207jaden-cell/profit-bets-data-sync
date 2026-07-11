-- Agent memory: persists key facts between autonomous scan sessions so the
-- agent builds genuine context over time rather than starting fresh each run.

CREATE TABLE IF NOT EXISTS public.agent_memory (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users NOT NULL,
  symbol      text,                          -- nullable: global memories have no symbol
  memory_type text NOT NULL,                 -- 'trade_outcome' | 'market_observation' | 'strategy_note' | 'sector_note'
  content     text NOT NULL,                 -- plain-english fact the agent should remember
  relevance   numeric NOT NULL DEFAULT 1.0,  -- decay over time; < 0.1 = stale
  expires_at  timestamptz,                   -- null = never expires
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_memory" ON public.agent_memory
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_memory TO authenticated;
GRANT ALL ON public.agent_memory TO service_role;

CREATE INDEX IF NOT EXISTS idx_agent_memory_user_symbol
  ON public.agent_memory(user_id, symbol, relevance DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_user_type
  ON public.agent_memory(user_id, memory_type, created_at DESC);

-- Decay relevance by 10% per day via daily cron
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'decay-agent-memory') THEN
    PERFORM cron.unschedule('decay-agent-memory');
  END IF;
END $$;
SELECT cron.schedule(
  'decay-agent-memory',
  '0 4 * * *',
  $$
  -- Decay relevance
  UPDATE public.agent_memory
  SET relevance = relevance * 0.90, updated_at = now()
  WHERE relevance > 0.05;
  -- Delete fully decayed memories
  DELETE FROM public.agent_memory WHERE relevance <= 0.05;
  -- Delete explicitly expired memories
  DELETE FROM public.agent_memory WHERE expires_at IS NOT NULL AND expires_at < now();
  $$
);
