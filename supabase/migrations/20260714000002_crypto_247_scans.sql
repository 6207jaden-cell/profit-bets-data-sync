-- Crypto 24/7 scans: every 30 minutes around the clock, including nights and weekends.
-- Crypto markets never close, so these run continuously.
-- During stock market hours on weekdays, daytime scalp scans already cover crypto.
-- These crons fill in nights (M-F) and all day Saturday + Sunday.

DO $$
DECLARE
  url  text := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app';
  key  text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw';
BEGIN

  -- Remove old crypto cron if it exists
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crypto-24-7') THEN
    PERFORM cron.unschedule('crypto-24-7');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crypto-night') THEN
    PERFORM cron.unschedule('crypto-night');
  END IF;

  -- ── WEEKDAY NIGHTS: every 30 min from midnight to 9:30am ET ──────────────
  -- UTC midnight to 13:30 UTC = midnight to 9:30am ET (when stock market opens)
  -- We stop at 13:30 UTC (9:30am ET) when daytime scans take over
  PERFORM cron.schedule(
    'crypto-weeknight-early',
    '*/30 0-12 * * 1-5',
    format($c$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{"session":"crypto"}'::jsonb
      ) AS r;
    $c$, url || '/api/public/autonomous-agent', key)
  );

  -- ── WEEKDAY EVENINGS: every 30 min after market close (4pm ET = 20:00 UTC) ──
  -- 20:00-23:30 UTC = 4pm to 11:30pm ET on weeknights
  PERFORM cron.schedule(
    'crypto-weeknight-late',
    '*/30 20-23 * * 1-5',
    format($c$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{"session":"crypto"}'::jsonb
      ) AS r;
    $c$, url || '/api/public/autonomous-agent', key)
  );

  -- ── WEEKENDS: every 30 min all day Saturday and Sunday ───────────────────
  -- Crypto trades all weekend — full 24/7 coverage
  PERFORM cron.schedule(
    'crypto-weekend',
    '*/30 * * * 0,6',
    format($c$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
        body := '{"session":"crypto"}'::jsonb
      ) AS r;
    $c$, url || '/api/public/autonomous-agent', key)
  );

  RAISE NOTICE 'Registered crypto 24/7 scans: weeknights + all weekend (every 30 min)';
END $$;
