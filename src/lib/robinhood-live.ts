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

// ─── Robinhood context fetcher ───────────────────────────────────────────────
// Pulls 5 data sources from Robinhood MCP and feeds them to the agent.
// Tool names are discovered dynamically so this works across MCP versions.

export type RobinhoodContext = {
  positions: Array<{
    symbol: string;
    quantity: number;
    avg_cost: number;
    current_value: number;
    unrealized_pnl: number;
  }>;
  news: Array<{
    headline: string;
    source: string;
    symbol?: string;
    summary?: string;
  }>;
  earnings: Array<{
    symbol: string;
    date: string;
    eps_estimate?: string;
  }>;
  options_chains: Record<string, {
    iv?: number;
    put_call_ratio?: number;
    unusual_activity?: boolean;
    raw?: string;
  }>;
  order_book: Record<string, {
    bid?: number;
    ask?: number;
    spread_pct?: number;
    raw?: string;
  }>;
  tool_names: Record<string, string>; // which MCP tools were found
};

/**
 * Fetches market context from Robinhood MCP for the given user.
 * Returns null if user has no valid Robinhood token.
 * All tool calls are best-effort — partial results are returned on error.
 */
export async function fetchRobinhoodContext(
  supabaseAdmin: ReturnType<typeof createClient<Database>>,
  userId: string,
  topSymbols: string[], // top 5-10 candidates from scan for targeted queries
): Promise<RobinhoodContext | null> {
  const accessToken = await getValidToken(supabaseAdmin, userId);
  if (!accessToken) return null;

  try {
    // Initialize one MCP session for all calls
    const sessionId = await initSession(accessToken);

    // Discover available tools
    const toolsRes = await mcpRpc(accessToken, sessionId, "tools/list", undefined, 10);
    const tools = ((toolsRes.result as { tools?: Array<{ name: string; description?: string }> })?.tools ?? []);
    const toolNames: Record<string, string> = {};

    // Match tools by name patterns
    const find = (patterns: RegExp[]): string | null => {
      const t = tools.find((t) => patterns.some((p) => p.test(t.name) || p.test(t.description ?? "")));
      return t?.name ?? null;
    };

    toolNames.positions = find([/position|portfolio|holding|account/i]) ?? "";
    toolNames.news      = find([/news|article|headline/i]) ?? "";
    toolNames.earnings  = find([/earning|calendar|report/i]) ?? "";
    toolNames.options   = find([/option|chain/i]) ?? "";
    toolNames.book      = find([/book|level.?2|depth|quote/i]) ?? "";

    const ctx: RobinhoodContext = {
      positions: [], news: [], earnings: [],
      options_chains: {}, order_book: {}, tool_names: toolNames,
    };

    // Helper: call a tool and return raw text response
    const callTool = async (toolName: string, args: Record<string, unknown>, id: number): Promise<string> => {
      if (!toolName) return "";
      try {
        const res = await mcpRpc(accessToken, sessionId, "tools/call", { name: toolName, arguments: args }, id);
        const content = (res.result as { content?: Array<{ text?: string }> })?.content ?? [];
        return content.map((c) => c.text ?? "").join(" ").trim();
      } catch (e) {
        console.warn("[robinhood-ctx] tool call failed:", toolName, String(e));
        return "";
      }
    };

    // ── 1. Real positions ────────────────────────────────────────────────────
    if (toolNames.positions) {
      const raw = await callTool(toolNames.positions, {}, 20);
      if (raw) {
        // Parse positions from text heuristically
        const lines = raw.split(/\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const symMatch = line.match(/\b([A-Z]{1,5})\b/);
          const qtyMatch = line.match(/(\d+\.?\d*)\s*share/i);
          const valMatch = line.match(/\$([\d,]+\.?\d*)/);
          const costMatch = line.match(/avg[^\$]*\$([\d,]+\.?\d*)/i);
          const pnlMatch = line.match(/([+-][\d,]+\.?\d*)/);
          if (symMatch && (qtyMatch || valMatch)) {
            ctx.positions.push({
              symbol: symMatch[1],
              quantity: qtyMatch ? Number(qtyMatch[1]) : 0,
              avg_cost: costMatch ? Number(costMatch[1].replace(/,/g, "")) : 0,
              current_value: valMatch ? Number(valMatch[1].replace(/,/g, "")) : 0,
              unrealized_pnl: pnlMatch ? Number(pnlMatch[1].replace(/,/g, "")) : 0,
            });
          }
        }
      }
    }

    // ── 2. News ──────────────────────────────────────────────────────────────
    if (toolNames.news) {
      const raw = await callTool(toolNames.news, { limit: 10 }, 21);
      if (raw) {
        const lines = raw.split(/\n/).filter((l) => l.length > 20);
        for (const line of lines.slice(0, 8)) {
          const symMatch = line.match(/\b([A-Z]{1,5})\b/);
          const srcMatch = line.match(/via\s+([\w\s]+)/i) ?? line.match(/[-—]\s*([\w\s]+)$/);
          ctx.news.push({
            headline: line.replace(/^[-•*\d.]+\s*/, "").trim().slice(0, 150),
            source: srcMatch?.[1]?.trim() ?? "Robinhood",
            symbol: symMatch?.[1],
          });
        }
      }
    }

    // ── 3. Earnings calendar ─────────────────────────────────────────────────
    if (toolNames.earnings) {
      const raw = await callTool(toolNames.earnings, { days: 7 }, 22);
      if (raw) {
        const lines = raw.split(/\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const symMatch = line.match(/\b([A-Z]{1,5})\b/);
          const dateMatch = line.match(/(Mon|Tue|Wed|Thu|Fri|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}/i);
          const epsMatch = line.match(/eps[^\d]*([\d.]+)/i);
          if (symMatch && dateMatch) {
            ctx.earnings.push({
              symbol: symMatch[1],
              date: dateMatch[0],
              eps_estimate: epsMatch ? `$${epsMatch[1]}` : undefined,
            });
          }
        }
      }
    }

    // ── 4 & 5. Options chain + order book for top symbols ────────────────────
    // Limit to top 5 stock symbols (skip crypto — no options/book data)
    const stockSymbols = topSymbols
      .filter((s) => !/-USD$/i.test(s))
      .slice(0, 5);

    await Promise.allSettled(stockSymbols.map(async (sym, idx) => {
      // Options chain
      if (toolNames.options) {
        const raw = await callTool(toolNames.options, { symbol: sym }, 30 + idx);
        if (raw) {
          const ivMatch = raw.match(/iv[^\d]*([\d.]+)%?/i);
          const pcMatch = raw.match(/put.call[^\d]*([\d.]+)/i);
          ctx.options_chains[sym] = {
            iv: ivMatch ? Number(ivMatch[1]) : undefined,
            put_call_ratio: pcMatch ? Number(pcMatch[1]) : undefined,
            unusual_activity: /unusual|abnormal|spike|heavy/i.test(raw),
            raw: raw.slice(0, 300),
          };
        }
      }

      // Order book / level 2
      if (toolNames.book) {
        const raw = await callTool(toolNames.book, { symbol: sym }, 40 + idx);
        if (raw) {
          const bidMatch = raw.match(/bid[^\d]*\$?([\d.]+)/i);
          const askMatch = raw.match(/ask[^\d]*\$?([\d.]+)/i);
          const bid = bidMatch ? Number(bidMatch[1]) : undefined;
          const ask = askMatch ? Number(askMatch[1]) : undefined;
          ctx.order_book[sym] = {
            bid,
            ask,
            spread_pct: (bid && ask && bid > 0) ? ((ask - bid) / bid) * 100 : undefined,
            raw: raw.slice(0, 200),
          };
        }
      }
    }));

    return ctx;
  } catch (e) {
    console.warn("[robinhood-ctx] context fetch failed:", String(e));
    return null;
  }
}

/**
 * Formats Robinhood context into a readable string for the AI system prompt.
 */
export function formatRobinhoodContext(ctx: RobinhoodContext): string {
  const parts: string[] = [];

  // Real positions
  if (ctx.positions.length > 0) {
    parts.push("ROBINHOOD ACCOUNT — REAL POSITIONS:");
    for (const p of ctx.positions) {
      const pnlStr = p.unrealized_pnl !== 0 ? ` (P&L: ${p.unrealized_pnl > 0 ? "+" : ""}$${p.unrealized_pnl.toFixed(2)})` : "";
      parts.push(`  ${p.symbol}: ${p.quantity} shares @ $${p.avg_cost.toFixed(2)} avg · Current: $${p.current_value.toFixed(2)}${pnlStr}`);
    }
    parts.push("IMPORTANT: Do NOT open duplicate positions in symbols you already hold in Robinhood unless adding strategically.");
  } else if (ctx.tool_names.positions) {
    parts.push("ROBINHOOD ACCOUNT: No open positions.");
  }

  // News
  if (ctx.news.length > 0) {
    parts.push("\nRECENT NEWS FROM ROBINHOOD:");
    for (const n of ctx.news.slice(0, 6)) {
      const sym = n.symbol ? `[${n.symbol}] ` : "";
      parts.push(`  ${sym}${n.headline}`);
    }
    parts.push("Factor news sentiment into your decisions — avoid entering longs on stocks with clearly negative news.");
  }

  // Earnings
  if (ctx.earnings.length > 0) {
    parts.push("\nEARNINGS THIS WEEK (AVOID TRADING THESE):");
    for (const e of ctx.earnings) {
      const eps = e.eps_estimate ? ` est. ${e.eps_estimate}` : "";
      parts.push(`  ${e.symbol}: ${e.date}${eps}`);
    }
    parts.push("Do NOT open new positions in these symbols — earnings cause violent moves you cannot predict.");
  }

  // Options chains
  const optSyms = Object.keys(ctx.options_chains);
  if (optSyms.length > 0) {
    parts.push("\nOPTIONS CHAIN DATA (from Robinhood):");
    for (const sym of optSyms) {
      const o = ctx.options_chains[sym];
      const iv = o.iv != null ? `IV ${o.iv.toFixed(1)}%` : "";
      const pc = o.put_call_ratio != null ? `P/C ratio ${o.put_call_ratio.toFixed(2)}` : "";
      const ua = o.unusual_activity ? " ⚡ UNUSUAL ACTIVITY" : "";
      parts.push(`  ${sym}: ${[iv, pc].filter(Boolean).join(" · ")}${ua}`);
    }
  }

  // Order book
  const bookSyms = Object.keys(ctx.order_book);
  if (bookSyms.length > 0) {
    parts.push("\nLEVEL 2 ORDER BOOK (from Robinhood):");
    for (const sym of bookSyms) {
      const b = ctx.order_book[sym];
      const spread = b.spread_pct != null ? ` spread ${b.spread_pct.toFixed(3)}%` : "";
      const bidask = (b.bid && b.ask) ? `bid $${b.bid} / ask $${b.ask}` : "";
      if (bidask) parts.push(`  ${sym}: ${bidask}${spread}`);
    }
    parts.push("Wide spreads (>0.5%) indicate low liquidity — reduce position size or avoid.");
  }

  return parts.join("\n");
}

