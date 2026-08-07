import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getRobinhoodConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const robinhoodMcpUrl = "https://agent.robinhood.com/mcp/trading";
    const { data } = await context.supabase
      .from("mcp_connections")
      .select("id, state, auth_url, server_label, expires_at, updated_at")
      .eq("server_url", robinhoodMcpUrl)
      .maybeSingle();
    return data ?? null;
  });

export const initiateRobinhoodConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const robinhoodMcpUrl = "https://agent.robinhood.com/mcp/trading";
    const robinhoodLabel = "Robinhood";
    const {
      discoverAuthServer,
      registerClient,
      makePkce,
      buildAuthorizeUrl,
      generateOAuthState,
    } = await import("@/lib/mcp-oauth.server");

    const meta = await discoverAuthServer(robinhoodMcpUrl);
    // Robinhood's Trading MCP currently uses a native/loopback OAuth client.
    // Its DCR endpoint echoes hosted callbacks, but the authorization step
    // rejects them after approval. Keep this exact URI for both authorization
    // and token exchange; the browser URL can be copied back into the app.
    const redirect_uri = "http://localhost:1455/callback";
    let client_id: string | undefined;
    let client_secret: string | undefined;
    let dcr: unknown = null;

    if (meta.registration_endpoint) {
      const reg = await registerClient(meta.registration_endpoint, redirect_uri, "Markets AI Trading");
      client_id = reg.client_id;
      client_secret = reg.client_secret;
      dcr = reg.raw;
    } else {
      throw new Error("Robinhood MCP server does not advertise dynamic client registration");
    }

    const pkce = makePkce();
    // SECURITY_AUDIT.md Finding 3 fix: a genuine random anti-CSRF nonce,
    // not the user_id directly (defense in depth — PKCE already prevented
    // the actual attack, but this closes the textbook-correctness gap).
    const oauthState = generateOAuthState();

    const auth_url = buildAuthorizeUrl({
      authorization_endpoint: meta.authorization_endpoint,
      client_id: client_id!,
      redirect_uri,
      code_challenge: pkce.challenge,
      state: oauthState,
      scope: "internal",
      resource: robinhoodMcpUrl,
    });

    const { error } = await context.supabase
      .from("mcp_connections")
      .upsert(
        {
          user_id: context.userId,
          server_url: robinhoodMcpUrl,
          server_label: robinhoodLabel,
          state: "authenticating",
          auth_url,
          client_id,
          client_secret,
          code_verifier: pkce.verifier,
          // oauth_state is ahead of the auto-generated Database type
          // (migration applied, codegen not re-run) — same documented
          // pattern as elsewhere in this project (e.g. shadow-experiments.ts).
          oauth_state: oauthState as never,
          dcr_metadata: dcr as never,
          access_token: null,
          refresh_token: null,
          expires_at: null,
        },
        { onConflict: "user_id,server_url" },
      );
    if (error) throw new Error(error.message);

    return { auth_url };
  });

export const completeRobinhoodConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ callback: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const robinhoodMcpUrl = "https://agent.robinhood.com/mcp/trading";
    let callback: URL;
    try {
      callback = new URL(data.callback.trim());
    } catch {
      throw new Error("Paste the full localhost callback URL from Robinhood.");
    }

    if (callback.origin !== "http://localhost:1455" || callback.pathname !== "/callback") {
      throw new Error("Paste the full http://localhost:1455/callback URL shown after Robinhood approval.");
    }

    const code = callback.searchParams.get("code");
    const state = callback.searchParams.get("state");
    const error = callback.searchParams.get("error");
    if (error) throw new Error(`Robinhood returned an error: ${error}`);
    if (!code || !state) throw new Error("The callback URL is missing Robinhood's code or state.");

    const { data: row, error: rowError } = await (context.supabase as any)
      .from("mcp_connections")
      .select("id, client_id, client_secret, code_verifier, oauth_state")
      .eq("server_url", robinhoodMcpUrl)
      .maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (!row?.client_id || !row.code_verifier) throw new Error("Connection state expired. Start over and reconnect Robinhood.");

    // SECURITY_AUDIT.md Finding 3 fix: verify against the random nonce
    // generated at flow initiation, not context.userId directly.
    const { verifyOAuthState, discoverAuthServer, exchangeCode } = await import("@/lib/mcp-oauth.server");
    if (!verifyOAuthState(state, row.oauth_state)) {
      throw new Error("This Robinhood callback belongs to a different session.");
    }
    const meta = await discoverAuthServer(robinhoodMcpUrl);
    const tokens = await exchangeCode({
      token_endpoint: meta.token_endpoint,
      code,
      redirect_uri: "http://localhost:1455/callback",
      client_id: row.client_id,
      client_secret: row.client_secret ?? undefined,
      code_verifier: row.code_verifier,
      resource: robinhoodMcpUrl,
    });

    const expires_at = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    const { error: updateError } = await context.supabase
      .from("mcp_connections")
      .update({
        state: "ready",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at,
        auth_url: null,
        code_verifier: null,
        oauth_state: null as never,
      })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);

    return { ok: true };
  });

export const disconnectRobinhood = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const robinhoodMcpUrl = "https://agent.robinhood.com/mcp/trading";
    await context.supabase
      .from("mcp_connections")
      .delete()
      .eq("server_url", robinhoodMcpUrl);
    return { ok: true };
  });
