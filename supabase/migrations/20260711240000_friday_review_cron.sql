-- Friday 3:45pm ET position review cron (19:45 UTC = 3:45pm ET)
DO $$
DECLARE
  prod_url text := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw';
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'friday-position-review') THEN
    PERFORM cron.unschedule('friday-position-review');
  END IF;

  PERFORM cron.schedule(
    'friday-position-review',
    '45 19 * * 5',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/friday-review', anon_key)
  );
END $$;
