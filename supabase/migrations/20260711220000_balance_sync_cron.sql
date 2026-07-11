-- Schedule Robinhood balance sync at 9:15am ET (13:15 UTC) Mon-Fri
-- Runs before the morning scan so the agent has accurate balance data
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-robinhood-balance') THEN
    PERFORM cron.unschedule('sync-robinhood-balance');
  END IF;
END $$;

SELECT cron.schedule(
  'sync-robinhood-balance',
  '15 13 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app/api/public/sync-robinhood-balance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Add balance_sync to agent_messages session_type for the audit log labels
-- (no schema change needed — session_type is free text)

-- Ensure conviction column exists (idempotent)
ALTER TABLE public.paper_trades ADD COLUMN IF NOT EXISTS conviction integer;
CREATE INDEX IF NOT EXISTS idx_paper_trades_conviction
  ON public.paper_trades(conviction) WHERE is_open = false;
