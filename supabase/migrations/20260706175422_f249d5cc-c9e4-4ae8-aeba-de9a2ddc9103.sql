
ALTER TABLE public.strategies ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_strategies_source ON public.strategies(source);
CREATE INDEX IF NOT EXISTS idx_paper_trades_strategy_pnl ON public.paper_trades(strategy_id, is_open, pnl);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-strategies') THEN
    PERFORM cron.unschedule('generate-strategies');
  END IF;
END $$;

SELECT cron.schedule(
  'generate-strategies',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app/api/public/generate-strategies',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
