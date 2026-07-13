-- Enable pg_cron: allows scheduling recurring SQL jobs inside Postgres
-- Enable pg_net: allows those jobs to make outbound HTTP requests (to call our API endpoints)
-- Both are required for the autonomous agent cron jobs to fire automatically.
-- Supabase supports enabling these via migration — no manual dashboard step needed.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA net;

-- Grant usage so the scheduler can run jobs
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT USAGE ON SCHEMA net  TO postgres;
