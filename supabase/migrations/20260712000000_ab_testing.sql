-- Strategy version history (for tracking changes from learning adjustments)
CREATE TABLE IF NOT EXISTS public.strategy_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid REFERENCES public.strategies NOT NULL,
  user_id     uuid REFERENCES auth.users NOT NULL,
  strategy_json jsonb NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_strategy_versions" ON public.strategy_versions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_versions_strategy ON public.strategy_versions(strategy_id, created_at DESC);

-- A/B test framework for strategies
-- Allows two strategy variants to run in parallel with capital split between them
CREATE TABLE IF NOT EXISTS public.strategy_ab_tests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users NOT NULL,
  name          text NOT NULL,
  strategy_a_id uuid REFERENCES public.strategies NOT NULL,
  strategy_b_id uuid REFERENCES public.strategies NOT NULL,
  split_pct     integer NOT NULL DEFAULT 50, -- % of ab_budget going to A (rest to B)
  ab_budget     numeric NOT NULL DEFAULT 500, -- total paper capital for this test
  status        text NOT NULL DEFAULT 'running', -- running | completed | paused
  start_date    date NOT NULL DEFAULT CURRENT_DATE,
  end_date      date,
  result_winner text,  -- 'a' | 'b' | 'tie' | null
  result_confidence numeric, -- statistical confidence 0-100
  result_summary text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_ab_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_ab_tests" ON public.strategy_ab_tests
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_ab_tests_user ON public.strategy_ab_tests(user_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_ab_tests TO authenticated;
GRANT ALL ON public.strategy_versions TO service_role;
GRANT ALL ON public.strategy_ab_tests TO service_role;
