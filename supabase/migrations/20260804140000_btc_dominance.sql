-- Stores periodic BTC dominance readings so the crypto session can compute
-- a rate of change (is capital rotating into or out of BTC right now) rather
-- than just a point-in-time level, which on its own doesn't indicate
-- direction of the current rotation.

CREATE TABLE IF NOT EXISTS public.btc_dominance_snapshots (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  dominance_pct numeric     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS btc_dominance_snapshots_time
  ON public.btc_dominance_snapshots (created_at DESC);

ALTER TABLE public.btc_dominance_snapshots ENABLE ROW LEVEL SECURITY;

-- This is global market data, not user-specific — any authenticated user can read it.
CREATE POLICY "Authenticated users read dominance snapshots"
  ON public.btc_dominance_snapshots FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role manages dominance snapshots"
  ON public.btc_dominance_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);
