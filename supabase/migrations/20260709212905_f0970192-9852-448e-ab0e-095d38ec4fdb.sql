
DROP FUNCTION IF EXISTS public.get_strategy_trade_stats(uuid);

CREATE OR REPLACE FUNCTION public.get_strategy_trade_stats()
RETURNS TABLE (strategy_id uuid, total_pnl numeric, trade_count bigint, win_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
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

REVOKE ALL ON FUNCTION public.get_strategy_trade_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_strategy_trade_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_strategy_trade_stats() TO service_role;
