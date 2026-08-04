-- Adaptive signal scoring: the agent now records exactly which technical
-- signals were active when each trade was opened (entry_signals), and learns
-- a per-user, per-signal win-rate weight from real closed-trade outcomes.
-- This closes the loop between "what does the scoring formula think is a
-- strong signal" and "what has actually been winning for this user" —
-- previously the weekly learning review only produced text fed into the AI's
-- system prompt, with no mechanical effect on the opportunityScore formula.

ALTER TABLE public.paper_trades
  ADD COLUMN IF NOT EXISTS entry_signals text[] DEFAULT NULL;

CREATE TABLE IF NOT EXISTS public.agent_signal_weights (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_name      text        NOT NULL,
  -- Beta distribution pseudo-counts for Bayesian win-rate estimation.
  -- Starting at alpha=1, beta=1 (uniform prior) means a brand-new signal
  -- with zero observed trades estimates exactly 50% win rate -> neutral
  -- 1.0x weight multiplier, so it has no effect until real evidence exists.
  alpha            numeric     NOT NULL DEFAULT 1,
  beta             numeric     NOT NULL DEFAULT 1,
  sample_size      integer     NOT NULL DEFAULT 0,
  avg_pnl_pct      numeric     NOT NULL DEFAULT 0,
  weight_multiplier numeric    NOT NULL DEFAULT 1.0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, signal_name)
);

CREATE INDEX IF NOT EXISTS agent_signal_weights_user
  ON public.agent_signal_weights (user_id);

ALTER TABLE public.agent_signal_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own signal weights"
  ON public.agent_signal_weights FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages signal weights"
  ON public.agent_signal_weights FOR ALL TO service_role
  USING (true) WITH CHECK (true);
