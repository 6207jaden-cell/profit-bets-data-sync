
-- Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  type text NOT NULL DEFAULT 'digest',
  title text NOT NULL,
  body text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, read);

-- Portfolio snapshots
CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  equity numeric NOT NULL,
  cash numeric NOT NULL,
  open_positions integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.portfolio_snapshots TO authenticated;
GRANT ALL ON public.portfolio_snapshots TO service_role;
ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own snapshots" ON public.portfolio_snapshots
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_created ON public.portfolio_snapshots(user_id, created_at ASC);

-- Cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resolve-signals') THEN
    PERFORM cron.unschedule('resolve-signals');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-portfolio') THEN
    PERFORM cron.unschedule('snapshot-portfolio');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-digest') THEN
    PERFORM cron.unschedule('daily-digest');
  END IF;
END $$;

SELECT cron.schedule('resolve-signals', '0 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad-dev.lovable.app/api/public/resolve-signals',
    headers := jsonb_build_object('Content-Type','application/json','apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw'),
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('snapshot-portfolio', '0 9 * * *', $$
  SELECT net.http_post(
    url := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad-dev.lovable.app/api/public/snapshot-portfolio',
    headers := jsonb_build_object('Content-Type','application/json','apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw'),
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('daily-digest', '0 8 * * *', $$
  SELECT net.http_post(
    url := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad-dev.lovable.app/api/public/daily-digest',
    headers := jsonb_build_object('Content-Type','application/json','apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw'),
    body := '{}'::jsonb
  );
$$);
