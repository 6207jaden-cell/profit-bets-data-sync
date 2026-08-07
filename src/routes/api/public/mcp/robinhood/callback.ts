import { createFileRoute } from "@tanstack/react-router";
import { verifyOAuthState } from "@/lib/mcp-oauth.server";

const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";

export const Route = createFileRoute("/api/public/mcp/robinhood/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        // SECURITY_AUDIT.md Finding 3 fix: this used to be the raw
        // user_id, used directly to look up the pending connection row —
        // meaning anyone who knew (or guessed) a user's ID could probe
        // for a matching row. Now it's the random nonce generated at flow
        // initiation (mcp-client.functions.ts's initiateRobinhoodConnection),
        // and the row is found BY that nonce rather than by a claimed
        // user_id — the caller never needs to (and no longer can) assert
        // whose connection this is; only possessing the exact nonce from
        // the original redirect proves that. Defense in depth: PKCE
        // (code_verifier/code_challenge) already prevented the actual
        // token-exchange attack this enables, but this closes the
        // textbook-correctness gap regardless.
        const state = url.searchParams.get("state");
        const errQ = url.searchParams.get("error");

        function html(msg: string, ok: boolean) {
          const target = `/trading?tab=agent&connected=${ok ? "1" : "0"}`;
          return new Response(
            `<!doctype html><meta charset="utf-8"><title>Robinhood</title>
            <body style="font-family:system-ui;background:#0a0a0b;color:#fafafa;display:grid;place-items:center;height:100vh;margin:0">
            <div style="text-align:center"><h2>${msg}</h2>
            <p style="opacity:.7">Returning to Markets…</p></div>
            <script>setTimeout(()=>{location.href=${JSON.stringify(target)}},1200)</script></body>`,
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }

        if (errQ) return html(`Robinhood denied access: ${errQ}`, false);
        if (!code || !state) return html("Missing code or state", false);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await (supabaseAdmin as any)
          .from("mcp_connections")
          .select("*")
          .eq("oauth_state", state)
          .eq("server_url", ROBINHOOD_MCP_URL)
          .maybeSingle();
        if (error || !row) return html("Connection not found. Please retry.", false);
        if (!row.client_id || !row.code_verifier) return html("Missing OAuth state", false);
        // Belt-and-suspenders: the lookup above already only matches on
        // an exact oauth_state value, but re-verify explicitly with the
        // same helper used in mcp-client.functions.ts rather than relying
        // solely on the query's own equality filter.
        if (!verifyOAuthState(state, row.oauth_state)) return html("Session mismatch. Please retry.", false);

        const { discoverAuthServer, exchangeCode } = await import("@/lib/mcp-oauth.server");

        try {
          const meta = await discoverAuthServer(ROBINHOOD_MCP_URL);
          const tokens = await exchangeCode({
            token_endpoint: meta.token_endpoint,
            code,
            redirect_uri: `${url.origin}/api/public/mcp/robinhood/callback`,
            client_id: row.client_id,
            client_secret: row.client_secret ?? undefined,
            code_verifier: row.code_verifier,
            resource: ROBINHOOD_MCP_URL,
          });

          const expires_at = tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null;

          await (supabaseAdmin as any)
            .from("mcp_connections")
            .update({
              state: "ready",
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token ?? null,
              expires_at,
              auth_url: null,
              code_verifier: null,
              oauth_state: null,
            })
            .eq("id", row.id);

          return html("Robinhood connected ✓", true);
        } catch (e) {
          await supabaseAdmin
            .from("mcp_connections")
            .update({ state: "failed" })
            .eq("id", row.id);
          return html(`Auth failed: ${(e as Error).message}`, false);
        }
      },
    },
  },
});
