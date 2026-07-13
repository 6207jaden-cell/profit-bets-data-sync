-- PROFIT_BETS.AI — Register ALL cron jobs in one shot
-- Run this in Supabase SQL Editor after enabling pg_cron and pg_net extensions
-- Extensions: Database → Extensions → search pg_cron → Enable, then pg_net → Enable

DO $$
DECLARE
  url  text := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app';
  key  text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw';
  jobs text[][] := ARRAY[
    -- name                        schedule              endpoint                     body
    ARRAY['autonomous-morning-scan',    '30 13 * * 1-5',  '/api/public/autonomous-agent',       '{"session":"morning"}'],
    ARRAY['autonomous-midmorning-scan', '30 14 * * 1-5',  '/api/public/autonomous-agent',       '{"session":"midday"}'],
    ARRAY['autonomous-midday-scan',     '30 16 * * 1-5',  '/api/public/autonomous-agent',       '{"session":"midday"}'],
    ARRAY['autonomous-afternoon-scan',  '30 18 * * 1-5',  '/api/public/autonomous-agent',       '{"session":"midday"}'],
    ARRAY['autonomous-exit-check',      '0 11,13,15,17,19 * * 1-5', '/api/public/autonomous-exit-check',  '{}'],
    ARRAY['autonomous-weekly-learning', '0 0 * * 1',      '/api/public/autonomous-learning',    '{}'],
    ARRAY['autonomous-weekend-prep',    '0 12 * * 6',     '/api/public/autonomous-agent',       '{"session":"weekend_prep"}'],
    ARRAY['evaluate-strategies',        '*/5 * * * *',    '/api/public/evaluate-strategies',    '{}'],
    ARRAY['generate-strategies',        '0 * * * *',      '/api/public/generate-strategies',    '{}'],
    ARRAY['resolve-signals',            '0 * * * *',      '/api/public/resolve-signals',        '{}'],
    ARRAY['snapshot-portfolio',         '0 9 * * *',      '/api/public/snapshot-portfolio',     '{}'],
    ARRAY['daily-digest',               '0 8 * * *',      '/api/public/daily-digest',           '{}'],
    ARRAY['friday-position-review',     '45 19 * * 5',    '/api/public/friday-review',          '{}'],
    ARRAY['sync-robinhood-balance',     '15 13 * * 1-5',  '/api/public/sync-robinhood-balance', '{}'],
    ARRAY['decay-agent-memory',         '0 4 * * *',      '/api/public/agent-memory-decay',     '{}'],
    -- Scalp scans every 30 min during market hours (10am-3:30pm ET)
    ARRAY['scalp-1000',  '0 14 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1030',  '30 14 * * 1-5', '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1100',  '0 15 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1130',  '30 15 * * 1-5', '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1200',  '0 16 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1300',  '0 17 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1330',  '30 17 * * 1-5', '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1400',  '0 18 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1500',  '0 19 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1530',  '30 19 * * 1-5', '/api/public/autonomous-agent', '{"session":"scalp"}']
  ];
  j text[];
BEGIN
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    -- Unschedule if exists, then re-create fresh
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j[1]) THEN
      PERFORM cron.unschedule(j[1]);
    END IF;
    PERFORM cron.schedule(
      j[1], j[2],
      format(
        $q$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','apikey',%L), body:=%L::jsonb) AS r;$q$,
        url || j[3], key, j[4]
      )
    );
    RAISE NOTICE 'Registered: %  →  %', j[1], j[2];
  END LOOP;
  RAISE NOTICE 'Done. % cron jobs registered.', array_length(jobs, 1);
END $$;

-- Verify:
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
