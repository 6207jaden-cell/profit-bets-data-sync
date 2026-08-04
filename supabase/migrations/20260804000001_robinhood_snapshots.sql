-- Stores daily Robinhood account balance snapshots for the chart.
-- Populated by sync-robinhood-balance cron (runs 9:15am ET weekdays).

CREATE TABLE IF NOT EXISTS public.robinhood_snapshots (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    NUMERIC(18, 2) NOT NULL,        -- total account / portfolio value
  buying_power NUMERIC(18, 2),               -- cash available to trade
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS robinhood_snapshots_user_time
  ON public.robinhood_snapshots (user_id, created_at DESC);

ALTER TABLE public.robinhood_snapshots ENABLE ROW LEVEL SECURITY;

-- Users can read their own snapshots
CREATE POLICY "Users read own robinhood snapshots"
  ON public.robinhood_snapshots FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Service role writes snapshots (cron job)
CREATE POLICY "Service role manages robinhood snapshots"
  ON public.robinhood_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);
