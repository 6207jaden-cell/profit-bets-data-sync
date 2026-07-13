-- Register 30-minute intraday scalp scan crons.
-- Scalp session fires every 30 min from 9:30am–3:30pm ET (Mon-Fri).
-- The existing morning (9:30am) and midday (12:30pm) crons remain as swing sessions.
-- New scalp slots: 10:00, 10:30, 11:00, 11:30, 12:00, 1:00, 1:30, 2:00, 3:00, 3:30 ET

DO $$
DECLARE
  prod_url text := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw';
BEGIN

  -- ── Unschedule existing scalp slots before re-creating ──────────────────
  FOREACH job_name IN ARRAY ARRAY[
    'scalp-1000','scalp-1030','scalp-1100','scalp-1130',
    'scalp-1200','scalp-1300','scalp-1330','scalp-1400',
    'scalp-1500','scalp-1530'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = job_name) THEN
      PERFORM cron.unschedule(job_name);
    END IF;
  END LOOP;

  -- ── 10:00am ET (14:00 UTC) ──────────────────────────────────────────────
  PERFORM cron.schedule('scalp-1000', '0 14 * * 1-5',
    format($c$ SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"scalp"}'::jsonb) AS r; $c$, prod_url||'/api/public/autonomous-agent', anon_key));

  -- ── 10:30am ET (14:30 UTC) ──────────────────────────────────────────────
  PERFORM cron.schedule('scalp-1030', '30 14 * * 1-5',
    format($c$ SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"scalp"}'::jsonb) AS r; $c$, prod_url||'/api/public/autonomous-agent', anon_key));

  -- ── 11:00am ET (15:00 UTC) ──────────────────────────────────────────────
  PERFORM cron.schedule('scalp-1100', '0 15 * * 1-5',
    format($c$ SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"scalp"}'::jsonb) AS r; $c$, prod_url||'/api/public/autonomous-agent', anon_key));

  -- ── 11:30am ET (15:30 UTC) ──────────────────────────────────────────────
  PERFORM cron.schedule('scalp-1130', '30 15 * * 1-5',
    format($c$ SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"scalp"}'::jsonb) AS r; $c$, prod_url||'/api/public/autonomous-agent', anon_key));

  -- ── 12:00pm ET (16:00 UTC) ──────────────────────────────────────────────
  PERFORM cron.schedule('scalp-1200', '0 16 * * 1-5',
    format($c$ SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"scalp"}'::jsonb) AS r; $c$, prod_url||'/api/public/autonomous-agent', anon_key));

  -- ── 1:00pm ET (17:00 UTC) ───────────────────────────────────────────────
  PERFORM cron.schedule('scalp-1300', '0 17 * * 1-5',
    format($c$ SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"scalp"}'::jsonb) AS r; $c$, prod_url||'/api/public/autonomous-agent', anon_key));

  -- ── 1:30pm ET (17:30 UTC) ───────────────────────────────────────────────
  PERFORM cron.schedule('scalp-1330', '30 17 * * 1-5',
    format($c$ SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"scalp"}'::jsonb) AS r; $c$, prod_url||'/api/public/autonomous-agent', anon_key));

  -- ── 2:00pm ET (18:00 UTC) ───────────────────────────────────────────────
  PERFORM cron.schedule('scalp-1400', '0 18 * * 1-5',
    format($c$ SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"scalp"}'::jsonb) AS r; $c$, prod_url||'/api/public/autonomous-agent', anon_key));

  -- ── 3:00pm ET (19:00 UTC) ───────────────────────────────────────────────
  PERFORM cron.schedule('scalp-1500', '0 19 * * 1-5',
    format($c$ SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"scalp"}'::jsonb) AS r; $c$, prod_url||'/api/public/autonomous-agent', anon_key));

  -- ── 3:30pm ET (19:30 UTC) — last scalp window before 4pm close ──────────
  PERFORM cron.schedule('scalp-1530', '30 19 * * 1-5',
    format($c$ SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:='{"session":"scalp"}'::jsonb) AS r; $c$, prod_url||'/api/public/autonomous-agent', anon_key));

  RAISE NOTICE 'Registered 10 scalp scan crons (10:00am–3:30pm ET every 30 min)';
END $$;
