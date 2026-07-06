
-- Repoint cron jobs to the stable preview URL so they work before publish.
SELECT cron.unschedule('evaluate-strategies');
SELECT cron.unschedule('generate-strategies');

SELECT cron.schedule(
  'evaluate-strategies',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad-dev.lovable.app/api/public/evaluate-strategies',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'generate-strategies',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad-dev.lovable.app/api/public/generate-strategies',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Kick off a generation run immediately so the leaderboard populates.
SELECT net.http_post(
  url := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad-dev.lovable.app/api/public/generate-strategies',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw'
  ),
  body := '{}'::jsonb
);
