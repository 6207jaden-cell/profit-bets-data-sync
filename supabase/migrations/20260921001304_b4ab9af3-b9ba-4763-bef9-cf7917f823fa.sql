REVOKE ALL ON FUNCTION public.recompute_agent_signal_weights() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_agent_signal_weights() TO service_role;