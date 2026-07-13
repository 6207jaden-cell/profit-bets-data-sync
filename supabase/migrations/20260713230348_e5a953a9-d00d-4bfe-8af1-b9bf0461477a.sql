REVOKE EXECUTE ON FUNCTION public.register_all_crons() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_all_crons() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.register_all_crons() FROM anon;