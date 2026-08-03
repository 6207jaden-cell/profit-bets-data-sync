-- mcp_connections: sensitive tokens — restrict to authenticated only
DROP POLICY IF EXISTS "Users manage own mcp connections" ON public.mcp_connections;
CREATE POLICY "Users manage own mcp connections" ON public.mcp_connections
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.mcp_connections FROM anon;

DROP POLICY IF EXISTS own_backtest_results ON public.agent_backtest_results;
CREATE POLICY own_backtest_results ON public.agent_backtest_results
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.agent_backtest_results FROM anon;

DROP POLICY IF EXISTS own_decisions ON public.agent_decisions;
CREATE POLICY own_decisions ON public.agent_decisions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.agent_decisions FROM anon;

DROP POLICY IF EXISTS own_learnings ON public.agent_learnings;
CREATE POLICY own_learnings ON public.agent_learnings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.agent_learnings FROM anon;

DROP POLICY IF EXISTS own_messages ON public.agent_messages;
CREATE POLICY own_messages ON public.agent_messages
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.agent_messages FROM anon;

DROP POLICY IF EXISTS own_settings ON public.user_settings;
CREATE POLICY own_settings ON public.user_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.user_settings FROM anon;

DROP POLICY IF EXISTS users_own_webhooks ON public.user_webhooks;
CREATE POLICY users_own_webhooks ON public.user_webhooks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.user_webhooks FROM anon;

-- user_roles: reads only; writes reserved for trusted server-side logic
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
REVOKE ALL ON public.user_roles FROM anon;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;