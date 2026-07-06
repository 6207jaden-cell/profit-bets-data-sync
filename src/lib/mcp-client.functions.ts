import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";
const ROBINHOOD_LABEL = "Robinhood";

function callbackUrl(origin: string) {
  return `${origin}/api/public/mcp/robinhood/callback`;
}

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
  .handler(async ({ data, context }) => {
    const {
      discoverAuthServer,
      registerClient,
      makePkce,
      buildAuthorizeUrl,
    } = await import("@/lib/mcp-oauth.server");

    const meta = await discoverAuthServer(ROBINHOOD_MCP_URL);
    const redirect_uri = callbackUrl(data.origin);
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
      force_path: "/mcp/trading",
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

export const disconnectRobinhood = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("mcp_connections")
      .delete()
      .eq("server_url", ROBINHOOD_MCP_URL);
    return { ok: true };
  });
