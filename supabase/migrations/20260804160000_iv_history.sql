-- Stores ATM implied volatility readings per symbol whenever the earnings
-- strategy evaluates a stock with upcoming earnings. Used to compute true
-- IV Rank (current IV's percentile within that stock's own trailing ~1-year
-- range) once enough history accumulates — this necessarily starts empty
-- and ramps up over months, same as the Stage 2 signal-weight learning.
-- IV/HV ratio (computed from data already available) is the fallback that
-- works immediately while this builds up.

CREATE TABLE IF NOT EXISTS public.iv_history_snapshots (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol     text        NOT NULL,
  iv_pct     numeric     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS iv_history_snapshots_symbol_time
  ON public.iv_history_snapshots (symbol, created_at DESC);

ALTER TABLE public.iv_history_snapshots ENABLE ROW LEVEL SECURITY;

-- Global market data, not user-specific — any authenticated user can read it.
CREATE POLICY "Authenticated users read IV history"
  ON public.iv_history_snapshots FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role manages IV history"
  ON public.iv_history_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);
