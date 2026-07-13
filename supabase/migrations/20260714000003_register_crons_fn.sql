-- Creates a register_all_crons() function that the Settings button calls via RPC.
-- This function runs as SECURITY DEFINER (elevated privileges) so it can call cron.schedule().
-- The sync-crons.ts endpoint calls: supabaseAdmin.rpc('register_all_crons')

CREATE OR REPLACE FUNCTION public.register_all_crons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
DECLARE
  v_url  text := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app';
  v_key  text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw';
  v_registered integer := 0;
  v_failed     integer := 0;
  v_errors     text[]  := '{}';

  -- All cron jobs: name, schedule, endpoint, body
  jobs text[][] := ARRAY[
    ARRAY['autonomous-morning-scan',    '30 13 * * 1-5',       '/api/public/autonomous-agent',       '{"session":"morning"}'],
    ARRAY['autonomous-midmorning-scan', '30 14 * * 1-5',       '/api/public/autonomous-agent',       '{"session":"midday"}'],
    ARRAY['autonomous-midday-scan',     '30 16 * * 1-5',       '/api/public/autonomous-agent',       '{"session":"midday"}'],
    ARRAY['autonomous-afternoon-scan',  '30 18 * * 1-5',       '/api/public/autonomous-agent',       '{"session":"midday"}'],
    ARRAY['autonomous-weekend-prep',    '0 12 * * 6',          '/api/public/autonomous-agent',       '{"session":"weekend_prep"}'],
    ARRAY['scalp-1000',  '0 14 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1030',  '30 14 * * 1-5', '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1100',  '0 15 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1130',  '30 15 * * 1-5', '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1200',  '0 16 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1300',  '0 17 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1330',  '30 17 * * 1-5', '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1400',  '0 18 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1500',  '0 19 * * 1-5',  '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['scalp-1530',  '30 19 * * 1-5', '/api/public/autonomous-agent', '{"session":"scalp"}'],
    ARRAY['crypto-weeknight-early', '*/30 0-12 * * 1-5',  '/api/public/autonomous-agent', '{"session":"crypto"}'],
    ARRAY['crypto-weeknight-late',  '*/30 20-23 * * 1-5', '/api/public/autonomous-agent', '{"session":"crypto"}'],
    ARRAY['crypto-weekend',         '*/30 * * * 0,6',     '/api/public/autonomous-agent', '{"session":"crypto"}'],
    ARRAY['autonomous-exit-check',      '0 11,13,15,17,19 * * 1-5', '/api/public/autonomous-exit-check',  '{}'],
    ARRAY['autonomous-weekly-learning', '0 0 * * 1',           '/api/public/autonomous-learning',    '{}'],
    ARRAY['evaluate-strategies',        '*/5 * * * *',         '/api/public/evaluate-strategies',    '{}'],
    ARRAY['generate-strategies',        '0 * * * *',           '/api/public/generate-strategies',    '{}'],
    ARRAY['resolve-signals',            '0 * * * *',           '/api/public/resolve-signals',        '{}'],
    ARRAY['snapshot-portfolio',         '0 9 * * *',           '/api/public/snapshot-portfolio',     '{}'],
    ARRAY['daily-digest',               '0 8 * * *',           '/api/public/daily-digest',           '{}'],
    ARRAY['friday-position-review',     '45 19 * * 5',         '/api/public/friday-review',          '{}'],
    ARRAY['sync-robinhood-balance',     '15 13 * * 1-5',       '/api/public/sync-robinhood-balance', '{}'],
    ARRAY['decay-agent-memory',         '0 4 * * *',           '/api/public/agent-memory-decay',     '{}']
  ];
  j    text[];
  cmd  text;
BEGIN
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN
      -- Safely unschedule if already exists
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j[1]) THEN
        PERFORM cron.unschedule(j[1]);
      END IF;

      -- Build the HTTP command
      cmd := format(
        $cmd$SELECT net.http_post(
          url        := %L,
          headers    := jsonb_build_object('Content-Type','application/json','apikey',%L),
          body       := %L::jsonb
        ) AS r;$cmd$,
        v_url || j[3],
        v_key,
        j[4]
      );

      -- Register the cron job
      PERFORM cron.schedule(j[1], j[2], cmd);
      v_registered := v_registered + 1;

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := array_append(v_errors, j[1] || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',         v_failed = 0,
    'registered', v_registered,
    'failed',     v_failed,
    'errors',     to_jsonb(v_errors)
  );
END;
$$;

-- Grant execute to authenticated users so the Settings button can call it
GRANT EXECUTE ON FUNCTION public.register_all_crons() TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_all_crons() TO service_role;
