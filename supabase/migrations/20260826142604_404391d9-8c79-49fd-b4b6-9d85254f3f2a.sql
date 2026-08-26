-- === 20260711200000_agent_memory ===
CREATE TABLE IF NOT EXISTS public.agent_memory (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users NOT NULL,
  symbol      text,
  memory_type text NOT NULL,
  content     text NOT NULL,
  relevance   numeric NOT NULL DEFAULT 1.0,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_memory TO authenticated;
GRANT ALL ON public.agent_memory TO service_role;
ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_memory" ON public.agent_memory
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_user_symbol
  ON public.agent_memory(user_id, symbol, relevance DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_user_type
  ON public.agent_memory(user_id, memory_type, created_at DESC);

-- === 20260711210000_conviction_column (DDL only) ===
ALTER TABLE public.paper_trades ADD COLUMN IF NOT EXISTS conviction integer;
CREATE INDEX IF NOT EXISTS idx_paper_trades_conviction
  ON public.paper_trades(conviction) WHERE is_open = false;

-- === 20260712000000_ab_testing ===
CREATE TABLE IF NOT EXISTS public.strategy_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid REFERENCES public.strategies NOT NULL,
  user_id     uuid REFERENCES auth.users NOT NULL,
  strategy_json jsonb NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_versions TO authenticated;
GRANT ALL ON public.strategy_versions TO service_role;
ALTER TABLE public.strategy_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_strategy_versions" ON public.strategy_versions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_versions_strategy ON public.strategy_versions(strategy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.strategy_ab_tests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users NOT NULL,
  name          text NOT NULL,
  strategy_a_id uuid REFERENCES public.strategies NOT NULL,
  strategy_b_id uuid REFERENCES public.strategies NOT NULL,
  split_pct     integer NOT NULL DEFAULT 50,
  ab_budget     numeric NOT NULL DEFAULT 500,
  status        text NOT NULL DEFAULT 'running',
  start_date    date NOT NULL DEFAULT CURRENT_DATE,
  end_date      date,
  result_winner text,
  result_confidence numeric,
  result_summary text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_ab_tests TO authenticated;
GRANT ALL ON public.strategy_ab_tests TO service_role;
ALTER TABLE public.strategy_ab_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_ab_tests" ON public.strategy_ab_tests
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_ab_tests_user ON public.strategy_ab_tests(user_id, status);

-- === 20260804000001_robinhood_snapshots ===
CREATE TABLE IF NOT EXISTS public.robinhood_snapshots (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    NUMERIC(18, 2) NOT NULL,
  buying_power NUMERIC(18, 2),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
GRANT SELECT ON public.robinhood_snapshots TO authenticated;
GRANT ALL ON public.robinhood_snapshots TO service_role;
CREATE INDEX IF NOT EXISTS robinhood_snapshots_user_time
  ON public.robinhood_snapshots (user_id, created_at DESC);
ALTER TABLE public.robinhood_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own robinhood snapshots"
  ON public.robinhood_snapshots FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Service role manages robinhood snapshots"
  ON public.robinhood_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- === 20260804140000_btc_dominance ===
CREATE TABLE IF NOT EXISTS public.btc_dominance_snapshots (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  dominance_pct numeric     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.btc_dominance_snapshots TO authenticated;
GRANT ALL ON public.btc_dominance_snapshots TO service_role;
CREATE INDEX IF NOT EXISTS btc_dominance_snapshots_time
  ON public.btc_dominance_snapshots (created_at DESC);
ALTER TABLE public.btc_dominance_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users read dominance snapshots"
  ON public.btc_dominance_snapshots FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Service role manages dominance snapshots"
  ON public.btc_dominance_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- === 20260804150000_market_breadth ===
CREATE TABLE IF NOT EXISTS public.market_breadth_snapshots (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  breadth_score numeric     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_breadth_snapshots TO authenticated;
GRANT ALL ON public.market_breadth_snapshots TO service_role;
CREATE INDEX IF NOT EXISTS market_breadth_snapshots_time
  ON public.market_breadth_snapshots (created_at DESC);
ALTER TABLE public.market_breadth_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users read breadth snapshots"
  ON public.market_breadth_snapshots FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Service role manages breadth snapshots"
  ON public.market_breadth_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- === 20260804160000_iv_history ===
CREATE TABLE IF NOT EXISTS public.iv_history_snapshots (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol     text        NOT NULL,
  iv_pct     numeric     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.iv_history_snapshots TO authenticated;
GRANT ALL ON public.iv_history_snapshots TO service_role;
CREATE INDEX IF NOT EXISTS iv_history_snapshots_symbol_time
  ON public.iv_history_snapshots (symbol, created_at DESC);
ALTER TABLE public.iv_history_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users read IV history"
  ON public.iv_history_snapshots FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Service role manages IV history"
  ON public.iv_history_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- === 20260804170000_kelly_sizing_stats ===
ALTER TABLE public.agent_signal_weights
  ADD COLUMN IF NOT EXISTS avg_win_pct  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_loss_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS win_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loss_count   integer NOT NULL DEFAULT 0;

-- === 20260805000001_shadow_candidate_log ===
CREATE TABLE IF NOT EXISTS public.shadow_candidate_log (
  id                     uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_type           text        NOT NULL,
  symbol                 text        NOT NULL,
  deterministic_rank     integer     NOT NULL,
  deterministic_score    numeric     NOT NULL,
  deterministic_direction text       NOT NULL,
  claude_traded          boolean     NOT NULL DEFAULT false,
  claude_direction       text,
  claude_conviction      integer,
  agreement              text        NOT NULL,
  price_at_scan          numeric,
  resolved               boolean     NOT NULL DEFAULT false,
  resolved_at            timestamptz,
  resolution_price       numeric,
  hypothetical_return_pct numeric,
  actual_trade_id        uuid REFERENCES public.paper_trades(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shadow_candidate_log TO authenticated;
GRANT ALL ON public.shadow_candidate_log TO service_role;
CREATE INDEX IF NOT EXISTS shadow_candidate_log_resolution
  ON public.shadow_candidate_log (resolved, created_at) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS shadow_candidate_log_user
  ON public.shadow_candidate_log (user_id, created_at DESC);
ALTER TABLE public.shadow_candidate_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own shadow candidate log"
  ON public.shadow_candidate_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Service role manages shadow candidate log"
  ON public.shadow_candidate_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- === 20260805000003_shadow_weighting_comparison ===
CREATE TABLE IF NOT EXISTS public.shadow_weighting_comparison (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_type          text        NOT NULL,
  symbol                text        NOT NULL,
  adaptive_bull_score   numeric     NOT NULL,
  adaptive_bear_score   numeric     NOT NULL,
  neutral_bull_score    numeric     NOT NULL,
  neutral_bear_score    numeric     NOT NULL,
  adaptive_rank         integer     NOT NULL,
  neutral_rank          integer     NOT NULL,
  rank_delta            integer     NOT NULL,
  direction_hint        text        NOT NULL DEFAULT 'long',
  was_traded            boolean     NOT NULL DEFAULT false,
  actual_trade_id       uuid REFERENCES public.paper_trades(id) ON DELETE SET NULL,
  price_at_scan         numeric,
  resolved              boolean     NOT NULL DEFAULT false,
  resolved_at           timestamptz,
  resolution_price      numeric,
  hypothetical_return_pct numeric,
  created_at            timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shadow_weighting_comparison TO authenticated;
GRANT ALL ON public.shadow_weighting_comparison TO service_role;
CREATE INDEX IF NOT EXISTS shadow_weighting_comparison_resolution
  ON public.shadow_weighting_comparison (resolved, created_at) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS shadow_weighting_comparison_user
  ON public.shadow_weighting_comparison (user_id, created_at DESC);
ALTER TABLE public.shadow_weighting_comparison ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own weighting comparison log"
  ON public.shadow_weighting_comparison FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Service role manages weighting comparison log"
  ON public.shadow_weighting_comparison FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- === 20260805000004_cost_tracking_fields ===
ALTER TABLE public.paper_trades
  ADD COLUMN IF NOT EXISTS entry_quoted_price  numeric,
  ADD COLUMN IF NOT EXISTS exit_quoted_price   numeric,
  ADD COLUMN IF NOT EXISTS entry_slippage_bps  numeric,
  ADD COLUMN IF NOT EXISTS exit_slippage_bps   numeric,
  ADD COLUMN IF NOT EXISTS estimated_fees      numeric;

-- === 20260805000005_signal_absent_tracking ===
ALTER TABLE public.agent_signal_weights
  ADD COLUMN IF NOT EXISTS absent_alpha        numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS absent_beta         numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS absent_sample_size  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS absent_avg_pnl_pct  numeric NOT NULL DEFAULT 0;

-- === 20260805010000_rate_limiting ===
CREATE TABLE IF NOT EXISTS public.rate_limit_state (
  bucket_key    text        PRIMARY KEY,
  window_start  timestamptz NOT NULL,
  request_count integer     NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.rate_limit_state TO service_role;
ALTER TABLE public.rate_limit_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages rate limit state"
  ON public.rate_limit_state FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.rate_limit_increment(
  p_bucket_key text,
  p_window_start timestamptz
) RETURNS TABLE(request_count integer, is_new_window boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_window_start timestamptz;
  v_count integer;
BEGIN
  SELECT window_start, request_count INTO v_existing_window_start, v_count
  FROM public.rate_limit_state
  WHERE bucket_key = p_bucket_key
  FOR UPDATE;

  IF NOT FOUND OR v_existing_window_start <> p_window_start THEN
    INSERT INTO public.rate_limit_state (bucket_key, window_start, request_count, updated_at)
    VALUES (p_bucket_key, p_window_start, 1, now())
    ON CONFLICT (bucket_key) DO UPDATE SET
      window_start = p_window_start, request_count = 1, updated_at = now();
    RETURN QUERY SELECT 1, true;
  ELSE
    UPDATE public.rate_limit_state
    SET request_count = request_count + 1, updated_at = now()
    WHERE bucket_key = p_bucket_key
    RETURNING public.rate_limit_state.request_count INTO v_count;
    RETURN QUERY SELECT v_count, false;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rate_limit_cleanup() RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.rate_limit_state WHERE updated_at < now() - interval '24 hours';
$function$;

-- === 20260806000000_cron_locks ===
CREATE TABLE IF NOT EXISTS public.cron_locks (
  lock_key    text        PRIMARY KEY,
  acquired_at timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL
);
GRANT ALL ON public.cron_locks TO service_role;
ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages cron locks"
  ON public.cron_locks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.try_acquire_cron_lock(
  p_lock_key text,
  p_ttl_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_existing_expires_at timestamptz;
BEGIN
  SELECT expires_at INTO v_existing_expires_at
  FROM public.cron_locks
  WHERE lock_key = p_lock_key
  FOR UPDATE;

  IF NOT FOUND OR v_existing_expires_at < v_now THEN
    INSERT INTO public.cron_locks (lock_key, acquired_at, expires_at)
    VALUES (p_lock_key, v_now, v_now + (p_ttl_seconds || ' seconds')::interval)
    ON CONFLICT (lock_key) DO UPDATE SET
      acquired_at = v_now, expires_at = v_now + (p_ttl_seconds || ' seconds')::interval;
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_cron_lock(p_lock_key text) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.cron_locks WHERE lock_key = p_lock_key;
$function$;

CREATE OR REPLACE FUNCTION public.cron_lock_cleanup() RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.cron_locks WHERE expires_at < now() - interval '1 hour';
$function$;

-- === 20260806001000_oauth_state_nonce ===
ALTER TABLE public.mcp_connections
  ADD COLUMN IF NOT EXISTS oauth_state text;

-- === 20260806000500_cron_lock_cleanup_cron (latest register_all_crons) ===
CREATE OR REPLACE FUNCTION public.register_all_crons()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'net'
AS $function$
DECLARE
  v_url text := 'https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw';
  jobs text[][] := ARRAY[
    ARRAY['autonomous-morning-scan','30 13 * * 1-5','/api/public/autonomous-agent','{"session":"morning"}'],
    ARRAY['autonomous-midday-scan','30 16 * * 1-5','/api/public/autonomous-agent','{"session":"midday"}'],
    ARRAY['autonomous-weekend-prep','0 12 * * 6','/api/public/autonomous-agent','{"session":"weekend_prep"}'],
    ARRAY['scalp-1000','0 14 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1030','30 14 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1100','0 15 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1130','30 15 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1200','0 16 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1300','0 17 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1330','30 17 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1400','0 18 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1500','0 19 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['scalp-1530','30 19 * * 1-5','/api/public/autonomous-agent','{"session":"scalp"}'],
    ARRAY['crypto-weeknight-early','*/30 0-12 * * 1-5','/api/public/autonomous-agent','{"session":"crypto"}'],
    ARRAY['crypto-weeknight-late','*/30 20-23 * * 1-5','/api/public/autonomous-agent','{"session":"crypto"}'],
    ARRAY['crypto-weekend','*/30 * * * 0,6','/api/public/autonomous-agent','{"session":"crypto"}'],
    ARRAY['autonomous-exit-check','*/10 * * * *','/api/public/autonomous-exit-check','{}'],
    ARRAY['autonomous-weekly-learning','0 0 * * 1','/api/public/autonomous-learning','{}'],
    ARRAY['evaluate-strategies','*/5 * * * *','/api/public/evaluate-strategies','{}'],
    ARRAY['generate-strategies','0 * * * *','/api/public/generate-strategies','{}'],
    ARRAY['snapshot-portfolio','0 9 * * *','/api/public/snapshot-portfolio','{}'],
    ARRAY['daily-digest','0 8 * * *','/api/public/daily-digest','{}'],
    ARRAY['friday-position-review','45 19 * * 5','/api/public/friday-review','{}'],
    ARRAY['sync-robinhood-balance','15 13 * * 1-5','/api/public/sync-robinhood-balance','{}'],
    ARRAY['resolve-shadow-experiments','0 5 * * *','/api/public/resolve-shadow-experiments','{}'],
    ARRAY['evaluate-alerts','*/5 * * * *','/api/public/evaluate-alerts','{}']
  ];
  j text[];
  v_count int := 0;
BEGIN
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j[1]) THEN
        PERFORM cron.unschedule(j[1]);
      END IF;
      PERFORM cron.schedule(j[1], j[2], format(
        $c$SELECT net.http_post(url:=%L,headers:=jsonb_build_object('Content-Type','application/json','apikey',%L),body:=%L::jsonb) AS r;$c$,
        v_url||j[3], v_key, j[4]
      ));
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rate-limit-cleanup') THEN
    PERFORM cron.unschedule('rate-limit-cleanup');
  END IF;
  PERFORM cron.schedule('rate-limit-cleanup', '0 4 * * *', 'SELECT public.rate_limit_cleanup();');
  v_count := v_count + 1;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-lock-cleanup') THEN
    PERFORM cron.unschedule('cron-lock-cleanup');
  END IF;
  PERFORM cron.schedule('cron-lock-cleanup', '15 4 * * *', 'SELECT public.cron_lock_cleanup();');
  v_count := v_count + 1;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'decay-agent-memory') THEN
    PERFORM cron.unschedule('decay-agent-memory');
  END IF;
  PERFORM cron.schedule('decay-agent-memory', '0 4 * * *', $m$
    UPDATE public.agent_memory SET relevance = relevance * 0.90, updated_at = now() WHERE relevance > 0.05;
    DELETE FROM public.agent_memory WHERE relevance <= 0.05;
    DELETE FROM public.agent_memory WHERE expires_at IS NOT NULL AND expires_at < now();
  $m$);
  v_count := v_count + 1;

  RETURN jsonb_build_object('ok', true, 'registered', v_count);
END;
$function$;

SELECT public.register_all_crons();