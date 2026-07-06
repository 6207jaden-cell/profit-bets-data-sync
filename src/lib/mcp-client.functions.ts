import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";
const ROBINHOOD_LABEL = "Robinhood";
const ROBINHOOD_MANUAL_REDIRECT_URI = "http://localhost:1455/callback";

export const getRobinhoodConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("mcp_connections")
      .select("id, state, auth_url, server_label, expires_at, updated_at")
      .eq("server_url", ROBINHOOD_MCP_URL)
      .maybeSingle();
    return data ?? null;
  });

export const initiateRobinhoodConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ context }) => {
    const {
      discoverAuthServer,
      registerClient,
      makePkce,
      buildAuthorizeUrl,
    } = await import("@/lib/mcp-oauth.server");

    const meta = await discoverAuthServer(ROBINHOOD_MCP_URL);
    const redirect_uri = ROBINHOOD_MANUAL_REDIRECT_URI;
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
    const state = context.userId; // scoped; verified against DB row on callback

    const auth_url = buildAuthorizeUrl({
      authorization_endpoint: meta.authorization_endpoint,
      client_id: client_id!,
      redirect_uri,
      code_challenge: pkce.challenge,
      state,
      scope: "internal",
      resource: ROBINHOOD_MCP_URL,
    });

    const { error } = await context.supabase
      .from("mcp_connections")
      .upsert(
        {
          user_id: context.userId,
          server_url: ROBINHOOD_MCP_URL,
          server_label: ROBINHOOD_LABEL,
          state: "authenticating",
          auth_url,
          client_id,
          client_secret,
          code_verifier: pkce.verifier,
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
    let callback: URL;
    try {
      callback = new URL(data.callback.trim());
    } catch {
      throw new Error("Paste the full localhost callback URL from Robinhood.");
    }

    const code = callback.searchParams.get("code");
    const state = callback.searchParams.get("state");
    const error = callback.searchParams.get("error");
    if (error) throw new Error(`Robinhood returned an error: ${error}`);
    if (!code || !state) throw new Error("The callback URL is missing Robinhood's code or state.");
    if (state !== context.userId) throw new Error("This Robinhood callback belongs to a different session.");

    const { data: row, error: rowError } = await context.supabase
      .from("mcp_connections")
      .select("id, client_id, client_secret, code_verifier")
      .eq("server_url", ROBINHOOD_MCP_URL)
      .maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (!row?.client_id || !row.code_verifier) throw new Error("Connection state expired. Start over and reconnect Robinhood.");

    const { discoverAuthServer, exchangeCode } = await import("@/lib/mcp-oauth.server");
    const meta = await discoverAuthServer(ROBINHOOD_MCP_URL);
    const tokens = await exchangeCode({
      token_endpoint: meta.token_endpoint,
      code,
      redirect_uri: ROBINHOOD_MANUAL_REDIRECT_URI,
      client_id: row.client_id,
      client_secret: row.client_secret ?? undefined,
      code_verifier: row.code_verifier,
      resource: ROBINHOOD_MCP_URL,
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
      })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);

    return { ok: true };
  });

export const disconnectRobinhood = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("mcp_connections")
      .delete()
      .eq("server_url", ROBINHOOD_MCP_URL);
    return { ok: true };
  });
