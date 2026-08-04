-- Experiment 1 (Claude Value Test): shadow-logs every candidate shown to
-- Claude alongside its deterministic rank/score and whether Claude agreed
-- or disagreed with that ranking. Never changes what's actually traded —
-- pure observation, resolved later against either the real trade outcome
-- (if Claude traded it) or a hypothetical "what if this had been bought at
-- scan time" outcome (if it wasn't), so the deterministic system's implied
-- picks get a fair comparison even though they're never actually executed.

CREATE TABLE IF NOT EXISTS public.shadow_candidate_log (
  id                     uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_type           text        NOT NULL,   -- morning_scan, midday_scan, scalp_scan, crypto_scan
  symbol                 text        NOT NULL,
  deterministic_rank     integer     NOT NULL,   -- 1 = top-ranked by bull/bear score * confidence
  deterministic_score    numeric     NOT NULL,
  deterministic_direction text       NOT NULL,   -- 'long' | 'short', from direction_hint
  claude_traded          boolean     NOT NULL DEFAULT false,
  claude_direction       text,                   -- null if Claude didn't trade this symbol
  claude_conviction      integer,                -- null if not traded
  -- agreement: 'agree_traded' (both like it, Claude traded a top-ranked pick),
  -- 'disagree_claude_skipped' (deterministic ranked it top, Claude passed),
  -- 'disagree_claude_added' (Claude traded something outside the top ranks),
  -- 'agree_skipped' (both systems pass on a low-ranked candidate)
  agreement              text        NOT NULL,
  price_at_scan          numeric,
  resolved               boolean     NOT NULL DEFAULT false,
  resolved_at            timestamptz,
  resolution_price       numeric,
  hypothetical_return_pct numeric,               -- naive buy-at-scan, hold-to-horizon return
  actual_trade_id        uuid REFERENCES public.paper_trades(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shadow_candidate_log_resolution
  ON public.shadow_candidate_log (resolved, created_at)
  WHERE resolved = false;

CREATE INDEX IF NOT EXISTS shadow_candidate_log_user
  ON public.shadow_candidate_log (user_id, created_at DESC);

ALTER TABLE public.shadow_candidate_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own shadow candidate log"
  ON public.shadow_candidate_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages shadow candidate log"
  ON public.shadow_candidate_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);
