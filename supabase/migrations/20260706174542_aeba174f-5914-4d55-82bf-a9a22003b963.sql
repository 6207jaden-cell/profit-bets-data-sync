
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior version of this job before re-scheduling.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'evaluate-strategies') THEN
    PERFORM cron.unschedule('evaluate-strategies');
  END IF;
END $$;

SELECT cron.schedule(
  'evaluate-strategies',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app/api/public/evaluate-strategies',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
