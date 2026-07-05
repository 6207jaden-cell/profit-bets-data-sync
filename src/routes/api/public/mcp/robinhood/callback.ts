import { createFileRoute } from "@tanstack/react-router";

const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";

export const Route = createFileRoute("/api/public/mcp/robinhood/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state"); // = user_id
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
        const { data: row, error } = await supabaseAdmin
          .from("mcp_connections")
          .select("*")
          .eq("user_id", state)
          .eq("server_url", ROBINHOOD_MCP_URL)
          .maybeSingle();
        if (error || !row) return html("Connection not found. Please retry.", false);
        if (!row.client_id || !row.code_verifier) return html("Missing OAuth state", false);

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

          await supabaseAdmin
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
