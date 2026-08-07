-- Adds a daily cron calling cron_lock_cleanup() (defined in the
-- cron_locks migration) so the cron_locks table doesn't grow unbounded,
-- same pattern already established for rate_limit_state's cleanup.
-- Every other job preserved exactly as currently registered.

CREATE OR REPLACE FUNCTION public.register_all_crons()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'net'
AS $function$
DECLARE
  v_url text := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw';
  jobs text[][] := ARRAY[
    ARRAY['autonomous-morning-scan','30 13 * * 1-5','/api/public/autonomous-agent','{"session":"morning"}'],
    ARRAY['autonomous-midday-scan','30 16 * * 1-5','/api/public/autonomous-agent','{"session":"midday"}'],
    ARRAY['autonomous-weekend-prep','0 12 * * 6','/api/public/autonomous-agent','{"session":"weekend_prep"}'],
    ARRAY['scalp-1000','0 14 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1030','30 14 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1100','0 15 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1130','30 15 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1200','0 16 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1300','0 17 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1330','30 17 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1400','0 18 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1500','0 19 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1530','30 19 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['crypto-weeknight-early','*/30 0-12 * * 1-5','/api/public/autonomous-agent','{"session":"crypto"}'],
    ARRAY['crypto-weeknight-late','*/30 20-23 * * 1-5','/api/public/autonomous-agent','{"session":"crypto"}'],
    ARRAY['crypto-weekend','*/30 * * * 0,6','/api/public/autonomous-agent','{"session":"crypto"}'],
    ARRAY['autonomous-exit-check','*/10 * * * *','/api/public/autonomous-exit-check','{}'],
    ARRAY['autonomous-weekly-learning','0 0 * * 1','/api/public/autonomous-learning','{}'],
    ARRAY['evaluate-strategies','*/5 * * * *','/api/public/evaluate-strategies','{}'],
    ARRAY['generate-strategies','0 * * * *','/api/public/generate-strategies','{}'],
    ARRAY['snapshot-portfolio','0 9 * * *','/api/public/snapshot-portfolio','{}'],
    ARRAY['daily-digest','0 8 * * *','/api/public/daily-digest','{}'],
    ARRAY['friday-position-review','45 19 * * 5','/api/public/friday-review','{}'],
    ARRAY['sync-robinhood-balance','15 13 * * 1-5','/api/public/sync-robinhood-balance','{}'],
    ARRAY['resolve-shadow-experiments','0 5 * * *','/api/public/resolve-shadow-experiments','{}'],
    ARRAY['evaluate-alerts','*/5 * * * *','/api/public/evaluate-alerts','{}']
  ];
  j text[];
  v_count int := 0;
BEGIN
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j[1]) THEN
        PERFORM cron.unschedule(j[1]);
      END IF;
      PERFORM cron.schedule(j[1], j[2], format(
        $c$SELECT net.http_post(url:=%L,headers:=jsonb_build_object('Content-Type','application/json','apikey',%L),body:=%L::jsonb) AS r;$c$,
        v_url||j[3], v_key, j[4]
      ));
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  -- Rate limit table cleanup — direct pg_cron SQL job (not an HTTP route,
  -- calls the DB function directly), separate from the HTTP-triggered jobs
  -- above.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rate-limit-cleanup') THEN
    PERFORM cron.unschedule('rate-limit-cleanup');
  END IF;
  PERFORM cron.schedule('rate-limit-cleanup', '0 4 * * *', 'SELECT public.rate_limit_cleanup();');
  v_count := v_count + 1;

  -- Cron lock table cleanup — same pattern, new table (Finding 5 fix).
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-lock-cleanup') THEN
    PERFORM cron.unschedule('cron-lock-cleanup');
  END IF;
  PERFORM cron.schedule('cron-lock-cleanup', '15 4 * * *', 'SELECT public.cron_lock_cleanup();');
  v_count := v_count + 1;

  RETURN jsonb_build_object('ok', true, 'registered', v_count);
END;
$function$;
