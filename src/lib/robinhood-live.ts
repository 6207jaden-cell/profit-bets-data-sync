/**
 * Robinhood live trading via the Agentic MCP endpoint.
 *
 * Used by evaluate-strategies.ts when a strategy's execution_mode = "live".
 * The mcp_connections table (managed by mcp-client.functions.ts) already
 * stores access_token / refresh_token / expires_at per user — we just read
 * those here and keep them fresh.
 *
 * All functions are pure server-side; never import this on the client.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";

type TokenRow = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  client_id: string | null;
  client_secret: string | null;
};

type PlaceOrderResult =
  | { ok: true; order_id: string; status: string; filled_qty?: number; filled_price?: number }
  | { ok: false; error: string };

// ─── Token management ────────────────────────────────────────────────────────

/**
 * Returns a valid access token for the given user, refreshing it if < 5 min
 * remain before expiry. Returns null if the user hasn't connected Robinhood.
 */
export async function getValidToken(
  supabaseAdmin: ReturnType<typeof createClient<Database>>,
  userId: string,
): Promise<string | null> {
  const { data: row } = await supabaseAdmin
    .from("mcp_connections")
    .select("id, access_token, refresh_token, expires_at, client_id, client_secret")
    .eq("user_id", userId)
    .eq("server_url", ROBINHOOD_MCP_URL)
    .eq("state", "ready")
    .maybeSingle();

  if (!row?.access_token) return null;

  // Check expiry — refresh if within 5 minutes of expiry or already expired.
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
  const needsRefresh = expiresAt != null && expiresAt - Date.now() < 5 * 60_000;

  if (!needsRefresh) return row.access_token;
  if (!row.refresh_token || !row.client_id) return null; // can't refresh without these

  return refreshToken(supabaseAdmin, row as TokenRow);
}

async function refreshToken(
  supabaseAdmin: ReturnType<typeof createClient<Database>>,
  row: TokenRow,
): Promise<string | null> {
  try {
    // Discover token endpoint dynamically (same as OAuth flow).
    const meta = await discoverAuthServer();
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token!,
      client_id: row.client_id!,
    });
    if (row.client_secret) body.set("client_secret", row.client_secret);

    const r = await fetch(meta.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) {
      console.error(`[robinhood-live] Token refresh failed (${r.status}): ${await r.text()}`);
      return null;
    }

    const tokens = (await r.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const expires_at = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    await supabaseAdmin
      .from("mcp_connections")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? row.refresh_token,
        expires_at,
      })
      .eq("id", row.id);

    return tokens.access_token;
  } catch (err) {
    console.error("[robinhood-live] Token refresh error:", err);
    return null;
  }
}

// ─── MCP JSON-RPC helper ─────────────────────────────────────────────────────

async function mcpRpc(
  accessToken: string,
  sessionId: string | null,
  method: string,
  params: Record<string, unknown> | undefined,
  id: number,
): Promise<{ result?: unknown; error?: { message: string }; sessionId: string | null }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${accessToken}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(ROBINHOOD_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
  });
  const newSession = res.headers.get("mcp-session-id") ?? sessionId;
  if (!res.ok) throw new Error(`MCP ${method} failed (${res.status}): ${await res.text()}`);

  const ct = res.headers.get("content-type") ?? "";
  let payload: { result?: unknown; error?: { message: string } };
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    const frames = text
      .split(/\n\n/)
      .map((chunk) => {
        const line = chunk.split("\n").find((l) => l.startsWith("data:"));
        return line ? line.slice(5).trim() : "";
      })
      .filter(Boolean);
    const match = frames
      .map((f) => { try { return JSON.parse(f); } catch { return null; } })
      .find((j) => j && j.id === id) as typeof payload | undefined;
    if (!match) throw new Error(`MCP ${method}: no JSON-RPC frame for id ${id}`);
    payload = match;
  } else {
    payload = (await res.json()) as typeof payload;
  }
  return { ...payload, sessionId: newSession };
}

// ─── Auth server discovery (cached in module scope for the process lifetime) ─

let _meta: { token_endpoint: string; authorization_endpoint: string } | null = null;
async function discoverAuthServer() {
  if (_meta) return _meta;
  const protectedRes = await fetch(ROBINHOOD_MCP_URL, {
    headers: { accept: "application/json" },
  });
  const wwwAuth = protectedRes.headers.get("www-authenticate") ?? "";
  const resourceMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);
  if (resourceMatch) {
    const r = await fetch(resourceMatch[1]);
    const rm = (await r.json()) as { authorization_servers?: string[] };
    if (rm.authorization_servers?.[0]) {
      const asUrl = rm.authorization_servers[0].replace(/\/$/, "");
      const asMeta = await fetch(`${asUrl}/.well-known/oauth-authorization-server`);
      _meta = (await asMeta.json()) as typeof _meta;
      return _meta!;
    }
  }
  throw new Error("Could not discover Robinhood auth server");
}

// ─── MCP session initialise ──────────────────────────────────────────────────

async function initSession(accessToken: string): Promise<string | null> {
  const init = await mcpRpc(
    accessToken,
    null,
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "markets-ai-cron", version: "1.0.0" },
    },
    1,
  );
  const sessionId = init.sessionId;
  // Fire-and-forget initialized notification.
  fetch(ROBINHOOD_MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => {});
  return sessionId;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Place a market buy order in the user's Robinhood Agentic account.
 * Returns ok:true with order details on success, ok:false with error string on failure.
 */
export async function placeLiveBuy(
  accessToken: string,
  symbol: string,
  notionalAmount: number, // USD amount to spend (Robinhood supports fractional / notional orders)
): Promise<PlaceOrderResult> {
  try {
    const sessionId = await initSession(accessToken);

    // Find the correct place_order tool — name may vary by MCP version.
    const toolsRes = await mcpRpc(accessToken, sessionId, "tools/list", undefined, 2);
    const tools = ((toolsRes.result as { tools?: Array<{ name: string }> })?.tools ?? []);
    const orderTool = tools.find((t) =>
      t.name.toLowerCase().includes("order") || t.name.toLowerCase().includes("trade"),
    );
    if (!orderTool) return { ok: false, error: "No order tool found in Robinhood MCP" };

    const callRes = await mcpRpc(
      accessToken,
      sessionId,
      "tools/call",
      {
        name: orderTool.name,
        arguments: {
          symbol: symbol.toUpperCase(),
          side: "buy",
          order_type: "market",
          notional_amount: Number(notionalAmount.toFixed(2)),
          time_in_force: "gfd", // good for day
        },
      },
      3,
    );

    if (callRes.error) return { ok: false, error: callRes.error.message };

    const content = (callRes.result as { content?: Array<{ text?: string }> })?.content ?? [];
    const text = content.map((c) => c.text ?? "").join(" ");

    // Parse order ID from response text heuristically.
    const idMatch = text.match(/order[_\s]?id[:\s]+([a-z0-9\-]+)/i);
    const priceMatch = text.match(/\$?([\d,.]+)\s*per\s*share/i);
    const qtyMatch = text.match(/([\d.]+)\s*share/i);

    return {
      ok: true,
      order_id: idMatch?.[1] ?? "unknown",
      status: text.toLowerCase().includes("filled") ? "filled" : "pending",
      filled_price: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : undefined,
      filled_qty: qtyMatch ? Number(qtyMatch[1]) : undefined,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Place a market sell order to close a position in the Agentic account.
 */
export async function placeLiveSell(
  accessToken: string,
  symbol: string,
  quantity: number,
): Promise<PlaceOrderResult> {
  try {
    const sessionId = await initSession(accessToken);

    const toolsRes = await mcpRpc(accessToken, sessionId, "tools/list", undefined, 2);
    const tools = ((toolsRes.result as { tools?: Array<{ name: string }> })?.tools ?? []);
    const orderTool = tools.find((t) =>
      t.name.toLowerCase().includes("order") || t.name.toLowerCase().includes("trade"),
    );
    if (!orderTool) return { ok: false, error: "No order tool found in Robinhood MCP" };

    const callRes = await mcpRpc(
      accessToken,
      sessionId,
      "tools/call",
      {
        name: orderTool.name,
        arguments: {
          symbol: symbol.toUpperCase(),
          side: "sell",
          order_type: "market",
          quantity: Number(quantity.toFixed(8)),
          time_in_force: "gfd",
        },
      },
      3,
    );

    if (callRes.error) return { ok: false, error: callRes.error.message };

    const content = (callRes.result as { content?: Array<{ text?: string }> })?.content ?? [];
    const text = content.map((c) => c.text ?? "").join(" ");
    const idMatch = text.match(/order[_\s]?id[:\s]+([a-z0-9\-]+)/i);
    const priceMatch = text.match(/\$?([\d,.]+)\s*per\s*share/i);

    return {
      ok: true,
      order_id: idMatch?.[1] ?? "unknown",
      status: text.toLowerCase().includes("filled") ? "filled" : "pending",
      filled_price: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : undefined,
      filled_qty: quantity,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
