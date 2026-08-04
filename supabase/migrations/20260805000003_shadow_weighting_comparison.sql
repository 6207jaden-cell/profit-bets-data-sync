-- Experiment 2 (Adaptive Learning Test): shadow-compares the REAL
-- (adaptive-weighted) candidate ranking against a hypothetical neutral-
-- weighted ranking for the same scan, same candidates. Never changes what's
-- actually traded (the real system always uses adaptive weights) — this is
-- pure observation to determine whether adaptive weighting is promoting
-- candidates that go on to perform better, or just reshuffling noise.
--
-- Chose shadow-logging over a live A/B toggle (alternating which weighting
-- mode is actually live) deliberately: changing real trading behavior for
-- a measurement purpose is a bigger intervention than default neutral
-- infrastructure-building, and the closing instruction was explicit that
-- this phase is measurement first, not optimization. See DECISION_LOG.md
-- for the full reasoning and EXPERIMENTS.md E-02 for methodology.

CREATE TABLE IF NOT EXISTS public.shadow_weighting_comparison (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_type          text        NOT NULL,
  symbol                text        NOT NULL,
  adaptive_bull_score   numeric     NOT NULL,
  adaptive_bear_score   numeric     NOT NULL,
  neutral_bull_score    numeric     NOT NULL,
  neutral_bear_score    numeric     NOT NULL,
  adaptive_rank         integer     NOT NULL,  -- rank under real (adaptive) weighting, 1 = top
  neutral_rank          integer     NOT NULL,  -- rank under hypothetical neutral weighting
  rank_delta            integer     NOT NULL,  -- neutral_rank - adaptive_rank; positive = adaptive promoted it
  direction_hint        text        NOT NULL DEFAULT 'long', -- needed to compute a directional hypothetical return at resolution
  was_traded            boolean     NOT NULL DEFAULT false,  -- did the REAL (adaptive) system trade it
  actual_trade_id       uuid REFERENCES public.paper_trades(id) ON DELETE SET NULL,
  price_at_scan         numeric,
  resolved              boolean     NOT NULL DEFAULT false,
  resolved_at           timestamptz,
  resolution_price      numeric,
  hypothetical_return_pct numeric,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shadow_weighting_comparison_resolution
  ON public.shadow_weighting_comparison (resolved, created_at)
  WHERE resolved = false;

CREATE INDEX IF NOT EXISTS shadow_weighting_comparison_user
  ON public.shadow_weighting_comparison (user_id, created_at DESC);

ALTER TABLE public.shadow_weighting_comparison ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own weighting comparison log"
  ON public.shadow_weighting_comparison FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages weighting comparison log"
  ON public.shadow_weighting_comparison FOR ALL TO service_role
  USING (true) WITH CHECK (true);
