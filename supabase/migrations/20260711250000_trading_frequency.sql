-- Update default agent settings to allow more concurrent positions
-- Old defaults: max_position_pct=35, min_cash_pct=20 → only 2-3 positions possible
-- New defaults: max_position_pct=20, min_cash_pct=15 → up to 5-6 positions possible

UPDATE public.user_settings
SET agent_settings = jsonb_build_object(
  'max_position_pct', 20,
  'min_cash_pct', 15,
  'stop_loss_pct', 6,
  'take_profit_pct', 12,
  'extra_symbols', '[]'::jsonb
)
WHERE agent_settings = '{"max_position_pct":35,"min_cash_pct":20,"stop_loss_pct":7,"take_profit_pct":15,"extra_symbols":[]}'::jsonb
   OR agent_settings IS NULL;

-- Also register the new 10:30am and 2:30pm scan crons
DO $$
DECLARE
  prod_url text := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw';
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-midmorning-scan') THEN
    PERFORM cron.unschedule('autonomous-midmorning-scan'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-afternoon-scan') THEN
    PERFORM cron.unschedule('autonomous-afternoon-scan'); END IF;

  -- 10:30am ET = 14:30 UTC
  PERFORM cron.schedule(
    'autonomous-midmorning-scan', '30 14 * * 1-5',
    format($cron$
      SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"midday"}'::jsonb) AS r;
    $cron$, prod_url||'/api/public/autonomous-agent', anon_key)
  );

  -- 2:30pm ET = 18:30 UTC
  PERFORM cron.schedule(
    'autonomous-afternoon-scan', '30 18 * * 1-5',
    format($cron$
      SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"midday"}'::jsonb) AS r;
    $cron$, prod_url||'/api/public/autonomous-agent', anon_key)
  );
END $$;
