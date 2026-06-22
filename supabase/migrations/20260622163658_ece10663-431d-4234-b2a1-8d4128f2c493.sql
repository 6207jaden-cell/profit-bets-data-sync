
-- Enums
CREATE TYPE public.market_type AS ENUM ('stocks','crypto','both');
CREATE TYPE public.risk_level AS ENUM ('low','medium','high');
CREATE TYPE public.execution_mode AS ENUM ('off','paper','live');
CREATE TYPE public.trade_side AS ENUM ('buy','sell');
CREATE TYPE public.execution_status AS ENUM ('pending','filled','rejected','cancelled');
CREATE TYPE public.broker_provider AS ENUM ('paper','alpaca','ibkr');

-- Strategies
CREATE TABLE public.strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  strategy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  market_type public.market_type NOT NULL DEFAULT 'stocks',
  risk_level public.risk_level NOT NULL DEFAULT 'medium',
  execution_mode public.execution_mode NOT NULL DEFAULT 'off',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategies TO authenticated;
GRANT ALL ON public.strategies TO service_role;
ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own strategies" ON public.strategies FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Paper portfolios
CREATE TABLE public.paper_portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance numeric NOT NULL DEFAULT 10000,
  equity numeric NOT NULL DEFAULT 10000,
  starting_balance numeric NOT NULL DEFAULT 10000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_portfolios TO authenticated;
GRANT ALL ON public.paper_portfolios TO service_role;
ALTER TABLE public.paper_portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own paper portfolio" ON public.paper_portfolios FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Paper trades
CREATE TABLE public.paper_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id uuid NOT NULL REFERENCES public.paper_portfolios(id) ON DELETE CASCADE,
  strategy_id uuid REFERENCES public.strategies(id) ON DELETE SET NULL,
  asset text NOT NULL,
  side public.trade_side NOT NULL,
  quantity numeric NOT NULL,
  entry_price numeric NOT NULL,
  exit_price numeric,
  pnl numeric,
  is_open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_trades TO authenticated;
GRANT ALL ON public.paper_trades TO service_role;
ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own paper trades" ON public.paper_trades FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Signal executions
CREATE TABLE public.signals_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES public.market_signals(id) ON DELETE SET NULL,
  strategy_id uuid REFERENCES public.strategies(id) ON DELETE SET NULL,
  execution_type public.execution_mode NOT NULL DEFAULT 'paper',
  status public.execution_status NOT NULL DEFAULT 'pending',
  asset text NOT NULL,
  side public.trade_side NOT NULL,
  quantity numeric NOT NULL,
  price numeric,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signals_executions TO authenticated;
GRANT ALL ON public.signals_executions TO service_role;
ALTER TABLE public.signals_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own executions" ON public.signals_executions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Strategy performance
CREATE TABLE public.strategy_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  win_rate numeric,
  roi numeric,
  drawdown numeric,
  sharpe numeric,
  trade_count integer,
  equity_curve jsonb,
  backtest_from date,
  backtest_to date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_performance TO authenticated;
GRANT ALL ON public.strategy_performance TO service_role;
ALTER TABLE public.strategy_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own perf" ON public.strategy_performance FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Risk limits
CREATE TABLE public.risk_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  max_daily_loss_pct numeric NOT NULL DEFAULT 5,
  max_position_pct numeric NOT NULL DEFAULT 10,
  max_sector_pct numeric NOT NULL DEFAULT 40,
  cooldown_seconds integer NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_limits TO authenticated;
GRANT ALL ON public.risk_limits TO service_role;
ALTER TABLE public.risk_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own risk limits" ON public.risk_limits FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Broker connections
CREATE TABLE public.broker_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider public.broker_provider NOT NULL DEFAULT 'paper',
  is_live boolean NOT NULL DEFAULT false,
  connected boolean NOT NULL DEFAULT false,
  account_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broker_connections TO authenticated;
GRANT ALL ON public.broker_connections TO service_role;
ALTER TABLE public.broker_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own brokers" ON public.broker_connections FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Smart alerts
CREATE TABLE public.smart_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  action jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_alerts TO authenticated;
GRANT ALL ON public.smart_alerts TO service_role;
ALTER TABLE public.smart_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own smart alerts" ON public.smart_alerts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_strategies_updated BEFORE UPDATE ON public.strategies FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_paper_portfolios_updated BEFORE UPDATE ON public.paper_portfolios FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_risk_limits_updated BEFORE UPDATE ON public.risk_limits FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_broker_connections_updated BEFORE UPDATE ON public.broker_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.paper_trades;
ALTER PUBLICATION supabase_realtime ADD TABLE public.signals_executions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.smart_alerts;
