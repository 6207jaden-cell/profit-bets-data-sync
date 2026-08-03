-- PROFIT_BETS.AI — Register ALL cron jobs in one shot
--
-- Single source of truth: the job list now lives inside the
-- public.register_all_crons() database function (production URL baked in).
-- This file is just the manual trigger so a hand-run can never reintroduce
-- a URL/schedule mismatch with the function.
--
-- Prereqs: pg_cron and pg_net extensions enabled.

SELECT public.register_all_crons();

-- Verify:
-- SELECT jobid, jobname, schedule FROM cron.job ORDER BY jobname;
