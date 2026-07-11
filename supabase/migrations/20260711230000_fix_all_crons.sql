-- CRITICAL FIX: Register the 4 missing autonomous agent cron jobs.
-- The morning scan, midday scan, exit check, and weekly learning crons were
-- never registered in migrations — the agent would never run automatically.
-- Also fixes the -dev.lovable.app URL used in older migrations (should be .lovable.app).

-- Use the correct production URL (no -dev suffix)
DO $$
DECLARE
  prod_url text := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw';
BEGIN

  -- ── Unschedule any existing jobs before re-creating ──────────────────────
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-morning-scan') THEN
    PERFORM cron.unschedule('autonomous-morning-scan'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-midday-scan') THEN
    PERFORM cron.unschedule('autonomous-midday-scan'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-exit-check') THEN
    PERFORM cron.unschedule('autonomous-exit-check'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-weekly-learning') THEN
    PERFORM cron.unschedule('autonomous-weekly-learning'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-weekend-prep') THEN
    PERFORM cron.unschedule('autonomous-weekend-prep'); END IF;

  -- Also fix the old crons that used the -dev URL
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'evaluate-strategies') THEN
    PERFORM cron.unschedule('evaluate-strategies'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-strategies') THEN
    PERFORM cron.unschedule('generate-strategies'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resolve-signals') THEN
    PERFORM cron.unschedule('resolve-signals'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-portfolio') THEN
    PERFORM cron.unschedule('snapshot-portfolio'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-digest') THEN
    PERFORM cron.unschedule('daily-digest'); END IF;

  -- ── Autonomous agent: morning scan at 9:30am ET (13:30 UTC) Mon-Fri ─────
  PERFORM cron.schedule(
    'autonomous-morning-scan', '30 13 * * 1-5',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{"session":"morning"}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/autonomous-agent', anon_key)
  );

  -- ── Autonomous agent: mid-morning scan 10:30am ET (14:30 UTC) Mon-Fri ────
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-midmorning-scan') THEN
    PERFORM cron.unschedule('autonomous-midmorning-scan'); END IF;
  PERFORM cron.schedule(
    'autonomous-midmorning-scan', '30 14 * * 1-5',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{"session":"midday"}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/autonomous-agent', anon_key)
  );

  -- ── Autonomous agent: midday scan at 12:30pm ET (16:30 UTC) Mon-Fri ─────
  PERFORM cron.schedule(
    'autonomous-midday-scan', '30 16 * * 1-5',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{"session":"midday"}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/autonomous-agent', anon_key)
  );

  -- ── Autonomous agent: afternoon scan 2:30pm ET (18:30 UTC) Mon-Fri ───────
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-afternoon-scan') THEN
    PERFORM cron.unschedule('autonomous-afternoon-scan'); END IF;
  PERFORM cron.schedule(
    'autonomous-afternoon-scan', '30 18 * * 1-5',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{"session":"midday"}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/autonomous-agent', anon_key)
  );

  -- ── Exit check every 2h during market hours (11,13,15,17,19 UTC) ─────────
  PERFORM cron.schedule(
    'autonomous-exit-check', '0 11,13,15,17,19 * * 1-5',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/autonomous-exit-check', anon_key)
  );

  -- ── Weekly learning: Monday 00:00 UTC (Sunday night ET) ──────────────────
  PERFORM cron.schedule(
    'autonomous-weekly-learning', '0 0 * * 1',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/autonomous-learning', anon_key)
  );

  -- ── Weekend prep: Saturday 12:00 UTC (8am ET) ────────────────────────────
  PERFORM cron.schedule(
    'autonomous-weekend-prep', '0 12 * * 6',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{"session":"weekend_prep"}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/autonomous-agent', anon_key)
  );

  -- ── Re-register other crons with correct prod URL ─────────────────────────
  PERFORM cron.schedule(
    'evaluate-strategies', '*/5 * * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/evaluate-strategies', anon_key)
  );

  PERFORM cron.schedule(
    'generate-strategies', '0 * * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/generate-strategies', anon_key)
  );

  PERFORM cron.schedule(
    'resolve-signals', '0 * * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/resolve-signals', anon_key)
  );

  PERFORM cron.schedule(
    'snapshot-portfolio', '0 9 * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/snapshot-portfolio', anon_key)
  );

  PERFORM cron.schedule(
    'daily-digest', '0 8 * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$, prod_url || '/api/public/daily-digest', anon_key)
  );

END $$;
