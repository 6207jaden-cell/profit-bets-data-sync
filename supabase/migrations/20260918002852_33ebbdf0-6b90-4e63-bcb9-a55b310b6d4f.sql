CREATE OR REPLACE FUNCTION public.get_strategy_trade_stats()
 RETURNS TABLE(strategy_id uuid, total_pnl numeric, trade_count bigint, win_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT strategy_id,
         SUM(pnl)::numeric AS total_pnl,
         COUNT(*)::bigint AS trade_count,
         COUNT(*) FILTER (WHERE pnl > 0)::bigint AS win_count
  FROM public.paper_trades
  WHERE is_open = false
    AND strategy_id IS NOT NULL
    AND COALESCE(data_quality_flag, false) = false
  GROUP BY strategy_id;
$function$;