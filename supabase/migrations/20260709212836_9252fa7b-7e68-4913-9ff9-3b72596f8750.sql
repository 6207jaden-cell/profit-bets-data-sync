
CREATE OR REPLACE FUNCTION public.get_strategy_trade_stats(p_user_id uuid)
RETURNS TABLE (strategy_id uuid, total_pnl numeric, trade_count bigint, win_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT strategy_id,
         SUM(pnl)::numeric AS total_pnl,
         COUNT(*)::bigint AS trade_count,
         COUNT(*) FILTER (WHERE pnl > 0)::bigint AS win_count
  FROM public.paper_trades
  WHERE is_open = false AND strategy_id IS NOT NULL
  GROUP BY strategy_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_strategy_trade_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_strategy_trade_stats(uuid) TO service_role;

CREATE INDEX IF NOT EXISTS idx_paper_trades_user_strategy_closed
  ON public.paper_trades(user_id, strategy_id) WHERE is_open = false;

CREATE INDEX IF NOT EXISTS idx_paper_trades_user_open
  ON public.paper_trades(user_id) WHERE is_open = true;

CREATE INDEX IF NOT EXISTS idx_signals_exec_user_created
  ON public.signals_executions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_signals_asset_result_created
  ON public.market_signals(asset, result, created_at DESC);
