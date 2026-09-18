-- 1. Flag columns
ALTER TABLE public.paper_trades
  ADD COLUMN IF NOT EXISTS data_quality_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_quality_reason text;

ALTER TABLE public.shadow_candidate_log
  ADD COLUMN IF NOT EXISTS data_quality_flag boolean NOT NULL DEFAULT false;

ALTER TABLE public.shadow_weighting_comparison
  ADD COLUMN IF NOT EXISTS data_quality_flag boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS paper_trades_dq_idx ON public.paper_trades (user_id, is_open, data_quality_flag);

-- 2. Backfill: closed trades whose |return| exceeds 100% are price-feed corruption
UPDATE public.paper_trades
   SET data_quality_flag = true,
       data_quality_reason = 'implausible_return_pct_gt_100: entry_price likely corrupted by unchecked quote source (see diag_flagged_trades)'
 WHERE is_open = false
   AND entry_price * quantity <> 0
   AND abs(pnl / (entry_price * quantity) * 100) > 100
   AND data_quality_flag = false;

-- 3. Propagate to shadow-experiment tables
UPDATE public.shadow_candidate_log s
   SET data_quality_flag = true
 WHERE s.actual_trade_id IN (SELECT id FROM public.paper_trades WHERE data_quality_flag);

UPDATE public.shadow_weighting_comparison s
   SET data_quality_flag = true
 WHERE s.actual_trade_id IN (SELECT id FROM public.paper_trades WHERE data_quality_flag);

-- 4. Full rebuild of agent_signal_weights from clean closed trades only.
CREATE OR REPLACE FUNCTION public.recompute_agent_signal_weights()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_signals text[] := ARRAY[
    'momentum','return_5d','return_20d','rs_vs_spy','rs_strong_outperform',
    'rs_strong_underperform','regime_aligned','rsi_oversold','rsi_overbought',
    'volume_surge','volume_surge_strong','liquidity','macd_bullish','macd_bearish',
    'bb_lower_band','bb_upper_band','stoch_oversold','stoch_overbought'
  ];
  v_rows int := 0;
BEGIN
  WITH clean AS (
    SELECT user_id,
           coalesce(entry_signals, '{}'::text[]) AS sigs,
           pnl > 0 AS won,
           (pnl / NULLIF(entry_price * quantity, 0) * 100) AS ret
      FROM public.paper_trades
     WHERE is_open = false
       AND data_quality_flag = false
       AND pnl IS NOT NULL
       AND entry_price * quantity <> 0
       AND entry_signals IS NOT NULL
       AND array_length(entry_signals, 1) > 0
  ),
  grid AS (
    SELECT DISTINCT c.user_id, s AS signal_name
      FROM clean c CROSS JOIN unnest(v_signals) AS s
  ),
  agg AS (
    SELECT g.user_id, g.signal_name,
      count(*) FILTER (WHERE g.signal_name = ANY(c.sigs))                       AS n_present,
      count(*) FILTER (WHERE g.signal_name = ANY(c.sigs) AND c.won)             AS wins,
      count(*) FILTER (WHERE g.signal_name = ANY(c.sigs) AND NOT c.won)         AS losses,
      avg(c.ret) FILTER (WHERE g.signal_name = ANY(c.sigs))                     AS avg_ret,
      avg(c.ret) FILTER (WHERE g.signal_name = ANY(c.sigs) AND c.won)           AS avg_win,
      avg(abs(c.ret)) FILTER (WHERE g.signal_name = ANY(c.sigs) AND NOT c.won)  AS avg_loss,
      count(*) FILTER (WHERE NOT (g.signal_name = ANY(c.sigs)))                 AS n_absent,
      count(*) FILTER (WHERE NOT (g.signal_name = ANY(c.sigs)) AND c.won)       AS abs_wins,
      count(*) FILTER (WHERE NOT (g.signal_name = ANY(c.sigs)) AND NOT c.won)   AS abs_losses,
      avg(c.ret) FILTER (WHERE NOT (g.signal_name = ANY(c.sigs)))               AS abs_avg_ret
    FROM grid g JOIN clean c ON c.user_id = g.user_id
    GROUP BY g.user_id, g.signal_name
  ),
  upserted AS (
    INSERT INTO public.agent_signal_weights (
      user_id, signal_name, alpha, beta, sample_size, avg_pnl_pct,
      avg_win_pct, avg_loss_pct, win_count, loss_count, weight_multiplier,
      absent_alpha, absent_beta, absent_sample_size, absent_avg_pnl_pct, updated_at
    )
    SELECT a.user_id, a.signal_name,
      1 + a.wins, 1 + a.losses, a.n_present,
      round(coalesce(a.avg_ret, 0)::numeric, 3),
      round(coalesce(a.avg_win, 0)::numeric, 3),
      round(coalesce(a.avg_loss, 0)::numeric, 3),
      a.wins, a.losses,
      round(greatest(0.4, least(1.8, 0.5 + (1 + a.wins)::numeric / ((1 + a.wins) + (1 + a.losses)))), 3),
      1 + a.abs_wins, 1 + a.abs_losses, a.n_absent,
      round(coalesce(a.abs_avg_ret, 0)::numeric, 3),
      now()
    FROM agg a
    ON CONFLICT (user_id, signal_name) DO UPDATE SET
      alpha = excluded.alpha, beta = excluded.beta, sample_size = excluded.sample_size,
      avg_pnl_pct = excluded.avg_pnl_pct, avg_win_pct = excluded.avg_win_pct,
      avg_loss_pct = excluded.avg_loss_pct, win_count = excluded.win_count,
      loss_count = excluded.loss_count, weight_multiplier = excluded.weight_multiplier,
      absent_alpha = excluded.absent_alpha, absent_beta = excluded.absent_beta,
      absent_sample_size = excluded.absent_sample_size,
      absent_avg_pnl_pct = excluded.absent_avg_pnl_pct, updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM upserted;

  RETURN jsonb_build_object('ok', true, 'signal_rows_rebuilt', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_agent_signal_weights() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_agent_signal_weights() TO service_role;

-- 5. Diagnostics now read the stored flag
DROP FUNCTION IF EXISTS public.diag_flagged_trades();

CREATE OR REPLACE FUNCTION public.diag_flagged_trades()
 RETURNS TABLE(trade_id uuid, asset text, entry_price numeric, exit_price numeric, entry_quoted_price numeric, exit_quoted_price numeric, quantity numeric, pnl numeric, return_pct numeric, closed_at timestamp with time zone, data_quality_reason text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, asset, entry_price, exit_price, entry_quoted_price, exit_quoted_price,
    quantity, pnl,
    round((pnl / NULLIF(entry_price*quantity,0) * 100)::numeric, 2),
    closed_at, data_quality_reason
  FROM paper_trades
  WHERE is_open = false
    AND (
      data_quality_flag
      OR (entry_price * quantity <> 0 AND abs(pnl / (entry_price*quantity) * 100) > 100)
    )
  ORDER BY closed_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.diag_overall_edge_test()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH closed AS (
    SELECT pnl, data_quality_flag,
      CASE WHEN entry_price * quantity <> 0 THEN pnl / (entry_price * quantity) * 100 END AS return_pct
    FROM paper_trades WHERE is_open = false
  ),
  flagged AS (
    SELECT * FROM closed WHERE data_quality_flag OR abs(return_pct) > 100
  ),
  clean AS (
    SELECT * FROM closed
     WHERE NOT data_quality_flag AND (return_pct IS NULL OR abs(return_pct) <= 100)
  ),
  raw_stats AS (
    SELECT count(*) n, count(*) FILTER (WHERE pnl > 0) wins, count(*) FILTER (WHERE pnl < 0) losses,
      avg(return_pct) mean_return_pct, stddev_samp(return_pct) sd_return_pct
    FROM closed
  ),
  clean_stats AS (
    SELECT count(*) n, count(*) FILTER (WHERE pnl > 0) wins, count(*) FILTER (WHERE pnl < 0) losses,
      avg(return_pct) mean_return_pct, stddev_samp(return_pct) sd_return_pct
    FROM clean
  )
  SELECT jsonb_build_object(
    'raw', (SELECT jsonb_build_object(
      'closed_trades', n, 'win_count', wins, 'loss_count', losses,
      'win_rate_pct', round(100.0 * wins / NULLIF(n,0), 2),
      'avg_return_pct', round(mean_return_pct, 4),
      'stddev_return_pct', round(sd_return_pct, 4),
      't_stat_approx', round((mean_return_pct / NULLIF(sd_return_pct / NULLIF(sqrt(n::numeric),0), 0))::numeric, 3)
    ) FROM raw_stats),
    'excl_flagged', (SELECT jsonb_build_object(
      'closed_trades', n, 'win_count', wins, 'loss_count', losses,
      'win_rate_pct', round(100.0 * wins / NULLIF(n,0), 2),
      'avg_return_pct', round(mean_return_pct, 4),
      'stddev_return_pct', round(sd_return_pct, 4),
      't_stat_approx', round((mean_return_pct / NULLIF(sd_return_pct / NULLIF(sqrt(n::numeric),0), 0))::numeric, 3)
    ) FROM clean_stats),
    'flagged_trades', (SELECT count(*) FROM flagged),
    'flag_threshold_pct', 100,
    'note', 'excl_flagged excludes paper_trades.data_quality_flag rows plus any |return_pct| > 100% screen (see diag_flagged_trades()). Data-integrity screen, not a statistical outlier test. t_stat_approx is a rough signal only.'
  );
$function$;

CREATE OR REPLACE FUNCTION public.diag_cost_reality()
 RETURNS TABLE(session_type text, trades_with_cost_data integer, avg_gross_return_pct numeric, avg_net_return_pct numeric, cost_drag_pct numeric, still_positive_after_costs boolean, meets_20_trade_floor boolean, flagged_excluded integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tagged AS (
    SELECT upper(substring(rationale from '\[(SCALP|SWING|CRYPTO)\]')) AS session_type,
      entry_quoted_price, exit_quoted_price, pnl, entry_price * quantity AS notional,
      (data_quality_flag OR abs(pnl / NULLIF(entry_price*quantity,0) * 100) > 100) AS is_flagged
    FROM paper_trades
    WHERE is_open = false AND entry_quoted_price IS NOT NULL AND exit_quoted_price IS NOT NULL AND estimated_fees IS NOT NULL
  )
  SELECT
    session_type,
    count(*) FILTER (WHERE NOT is_flagged)::int AS trades_with_cost_data,
    round(avg((exit_quoted_price - entry_quoted_price) / NULLIF(entry_quoted_price,0) * 100) FILTER (WHERE NOT is_flagged), 4) AS avg_gross_return_pct,
    round(avg(pnl / NULLIF(notional,0) * 100) FILTER (WHERE NOT is_flagged), 4) AS avg_net_return_pct,
    round(
      avg((exit_quoted_price - entry_quoted_price) / NULLIF(entry_quoted_price,0) * 100) FILTER (WHERE NOT is_flagged)
      - avg(pnl / NULLIF(notional,0) * 100) FILTER (WHERE NOT is_flagged), 4
    ) AS cost_drag_pct,
    (avg(pnl / NULLIF(notional,0) * 100) FILTER (WHERE NOT is_flagged) > 0) AS still_positive_after_costs,
    (count(*) FILTER (WHERE NOT is_flagged) >= 20) AS meets_20_trade_floor,
    count(*) FILTER (WHERE is_flagged)::int AS flagged_excluded
  FROM tagged
  WHERE session_type IS NOT NULL
  GROUP BY session_type
  ORDER BY 2 DESC;
$function$;

CREATE OR REPLACE FUNCTION public.diag_claude_value()
 RETURNS TABLE(agreement text, resolved_rows integer, avg_hypothetical_return_pct numeric, meets_30_row_floor boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    agreement,
    count(*)::int AS resolved_rows,
    round(avg(hypothetical_return_pct),4) AS avg_hypothetical_return_pct,
    (count(*) >= 30) AS meets_30_row_floor
  FROM shadow_candidate_log
  WHERE resolved = true AND data_quality_flag = false
  GROUP BY agreement
  ORDER BY 2 DESC;
$function$;

CREATE OR REPLACE FUNCTION public.diag_adaptive_weighting()
 RETURNS TABLE(bucket text, resolved_rows integer, avg_hypothetical_return_pct numeric, meets_30_row_floor boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE WHEN rank_delta > 0 THEN 'adaptive_promoted' WHEN rank_delta < 0 THEN 'adaptive_demoted' ELSE 'no_change' END AS bucket,
    count(*)::int AS resolved_rows,
    round(avg(hypothetical_return_pct),4) AS avg_hypothetical_return_pct,
    (count(*) >= 30) AS meets_30_row_floor
  FROM shadow_weighting_comparison
  WHERE resolved = true AND data_quality_flag = false
  GROUP BY 1
  ORDER BY 2 DESC;
$function$;