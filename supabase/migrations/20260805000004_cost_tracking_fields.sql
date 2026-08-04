-- Experiment 3 (Trading Cost Reality Test): paper_trades currently stores
-- only the final, post-slippage entry_price/exit_price — the pre-slippage
-- quoted price and the slippage bps that was applied are computed at trade
-- time (estimateSlippageBps/applySlippage) but discarded, not stored. This
-- makes it impossible to separately report "gross" (before-cost) vs "net"
-- (after-cost) expectancy, which is exactly the comparison Experiment 3
-- needs. All new columns are nullable and populated going forward only —
-- historical trades predate cost tracking and are left null rather than
-- backfilled with a guess.

ALTER TABLE public.paper_trades
  ADD COLUMN IF NOT EXISTS entry_quoted_price  numeric,  -- price BEFORE slippage was applied at entry
  ADD COLUMN IF NOT EXISTS exit_quoted_price   numeric,  -- price BEFORE slippage was applied at exit
  ADD COLUMN IF NOT EXISTS entry_slippage_bps  numeric,  -- slippage bps applied at entry
  ADD COLUMN IF NOT EXISTS exit_slippage_bps   numeric,  -- slippage bps applied at exit
  ADD COLUMN IF NOT EXISTS estimated_fees      numeric;  -- modeled round-trip fee in dollars (see cost-reality.ts for the fee model)
