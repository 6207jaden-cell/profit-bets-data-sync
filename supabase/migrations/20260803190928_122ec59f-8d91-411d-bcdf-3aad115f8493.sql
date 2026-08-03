-- Drop the stale standalone weekend-prep job (jobid 13) if still present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-weekend-prep') THEN
    PERFORM cron.unschedule('autonomous-weekend-prep');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

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
    ARRAY['autonomous-exit-check','0 11,13,15,17,19 * * 1-5','/api/public/autonomous-exit-check','{}'],
    ARRAY['autonomous-weekly-learning','0 0 * * 1','/api/public/autonomous-learning','{}'],
    ARRAY['evaluate-strategies','*/5 * * * *','/api/public/evaluate-strategies','{}'],
    ARRAY['generate-strategies','0 * * * *','/api/public/generate-strategies','{}'],
    ARRAY['snapshot-portfolio','0 9 * * *','/api/public/snapshot-portfolio','{}'],
    ARRAY['daily-digest','0 8 * * *','/api/public/daily-digest','{}'],
    ARRAY['friday-position-review','45 19 * * 5','/api/public/friday-review','{}'],
    ARRAY['sync-robinhood-balance','15 13 * * 1-5','/api/public/sync-robinhood-balance','{}']
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
  RETURN jsonb_build_object('ok', true, 'registered', v_count);
END $function$;