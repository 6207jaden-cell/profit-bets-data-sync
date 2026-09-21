CREATE OR REPLACE FUNCTION public.recompute_agent_signal_weights()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_signals text[] := ARRAY[
    'momentum','return_5d','return_20d','rs_vs_spy','rs_strong_outperform',
    'rs_strong_underperform','regime_aligned','rsi_oversold','rsi_overbought',
    'volume_surge','volume_surge_strong','liquidity','macd_bullish','macd_bearish',
    'bb_lower_band','bb_upper_band','stoch_oversold','stoch_overbought'
  ];
  v_prior numeric := 20;      -- prior strength in pseudo-trades
  v_min_trades int := 30;     -- below this, fall back to a neutral 0.5 anchor
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
  -- Account-level base win rate: one closed clean trade, one vote. Deliberately
  -- NOT summed from per-signal win_count, which double-counts a trade once per
  -- active signal and would bias the anchor toward frequently-firing signals.
  base AS (
    SELECT user_id,
           count(*) AS n,
           count(*) FILTER (WHERE pnl > 0) AS wins
      FROM public.paper_trades
     WHERE is_open = false
       AND data_quality_flag = false
       AND pnl IS NOT NULL
     GROUP BY user_id
  ),
  base_rate AS (
    SELECT user_id,
           CASE WHEN n >= v_min_trades THEN wins::numeric / n ELSE 0.5 END AS rate
      FROM base
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
      -- Base-rate anchored weight: shrink the observed win rate toward the
      -- account's own base rate, then express it RELATIVE to that base rate.
      -- At n_present = 0 this is exactly 1.0, identical to a signal performing
      -- exactly at the base rate.
      round(greatest(0.4, least(1.8,
        1 + ((a.wins + coalesce(br.rate, 0.5) * v_prior) / (a.n_present + v_prior))
          - coalesce(br.rate, 0.5)
      )), 3),
      1 + a.abs_wins, 1 + a.abs_losses, a.n_absent,
      round(coalesce(a.abs_avg_ret, 0)::numeric, 3),
      now()
    FROM agg a
    LEFT JOIN base_rate br ON br.user_id = a.user_id
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
$fn$;

REVOKE ALL ON FUNCTION public.recompute_agent_signal_weights() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_agent_signal_weights() TO service_role;