-- Kelly Criterion position sizing needs average WIN size and average LOSS
-- size tracked SEPARATELY, not just a single blended avg_pnl_pct — the
-- Kelly formula requires the win/loss ratio (b = avg_win / avg_loss) as an
-- independent input from the win probability. Adding both as incrementally-
-- updated running averages, same pattern as avg_pnl_pct already uses.

ALTER TABLE public.agent_signal_weights
  ADD COLUMN IF NOT EXISTS avg_win_pct  numeric NOT NULL DEFAULT 0,  -- average magnitude of WINNING trades only, always positive
  ADD COLUMN IF NOT EXISTS avg_loss_pct numeric NOT NULL DEFAULT 0,  -- average magnitude of LOSING trades only, stored as a positive number
  ADD COLUMN IF NOT EXISTS win_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loss_count   integer NOT NULL DEFAULT 0;
