-- Stores periodic market breadth composite score readings so the agent can
-- compute momentum (is breadth improving or deteriorating) rather than only
-- seeing a point-in-time level, which on its own doesn't distinguish a
-- market that's recovering from one that's falling apart at the same score.

CREATE TABLE IF NOT EXISTS public.market_breadth_snapshots (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  breadth_score numeric     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_breadth_snapshots_time
  ON public.market_breadth_snapshots (created_at DESC);

ALTER TABLE public.market_breadth_snapshots ENABLE ROW LEVEL SECURITY;

-- Global market data, not user-specific — any authenticated user can read it.
CREATE POLICY "Authenticated users read breadth snapshots"
  ON public.market_breadth_snapshots FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role manages breadth snapshots"
  ON public.market_breadth_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);
