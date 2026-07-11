ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS agent_settings jsonb NOT NULL DEFAULT '{"max_position_pct":35,"min_cash_pct":20,"stop_loss_pct":7,"take_profit_pct":15,"extra_symbols":[]}'::jsonb;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS autonomous_paused_until timestamptz;

CREATE TABLE IF NOT EXISTS public.agent_backtest_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  days_back integer NOT NULL,
  total_return_pct numeric,
  win_rate numeric,
  avg_pnl_pct numeric,
  sharpe numeric,
  trade_count integer,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_backtest_results TO authenticated;
GRANT ALL ON public.agent_backtest_results TO service_role;

ALTER TABLE public.agent_backtest_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_backtest_results" ON public.agent_backtest_results
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_agent_backtest_user ON public.agent_backtest_results(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_equity ON public.portfolio_snapshots(user_id, equity DESC);

-- Weekend prep cron: Saturday 12:00 UTC (8am ET)
SELECT cron.schedule(
  'autonomous-weekend-prep',
  '0 12 * * 6',
  $$
  SELECT net.http_post(
    url:='https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad-dev.lovable.app/api/public/autonomous-agent',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw"}'::jsonb,
    body:='{"session":"weekend_prep"}'::jsonb
  ) as request_id;
  $$
);