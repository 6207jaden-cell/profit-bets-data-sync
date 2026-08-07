-- Fixes SECURITY_AUDIT.md Finding 3: the Robinhood OAuth flow used
-- user_id directly as the OAuth `state` parameter instead of a genuine
-- random anti-CSRF nonce. Low severity as originally assessed — PKCE
-- (code_verifier/code_challenge) already prevents the attack this would
-- otherwise enable — but not textbook-correct, and worth closing as
-- defense in depth per the finding's own recommended fix.
--
-- Named oauth_state, deliberately NOT reusing the column simply called
-- "state" already on this table — that existing column tracks connection
-- lifecycle status ("authenticating"/"ready"/"failed"), a completely
-- different concept from OAuth's state parameter. Reusing that name
-- would have been a real, confusing collision.

ALTER TABLE public.mcp_connections
  ADD COLUMN IF NOT EXISTS oauth_state text; -- random nonce generated at flow initiation, cleared after use (same lifecycle as code_verifier)
