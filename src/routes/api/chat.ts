import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, dynamicTool, jsonSchema, type UIMessage, type ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";

const SYSTEM_PROMPT = `You are the Markets AI trading agent with live access to the user's Robinhood account via MCP tools.

Guidelines:
- Prefer read-only tools when the user's intent is ambiguous.
- Before placing any order, summarize the proposed trade (symbol, side, quantity, order type, estimated cost) and ask for explicit confirmation UNLESS the user has clearly instructed you to execute.
- Robinhood's own confirmation layer applies to real orders; never claim a trade is filled unless a tool result confirms it.
- Be concise, use bullet points and inline code for tickers/prices. Never fabricate holdings or prices — always call a tool.`;

type McpToolInfo = { name: string; description?: string; inputSchema?: object };

/** Minimal Streamable HTTP MCP client (fetch + JSON-RPC). Worker-safe. */
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
    // Grab the last JSON-RPC data frame with a matching id.
    const frames = text.split(/\n\n/).map((chunk) => {
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      return line ? line.slice(5).trim() : "";
    }).filter(Boolean);
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

async function loadMcpTools(accessToken: string): Promise<{
  tools: ToolSet;
  close: () => Promise<void>;
}> {
  // initialize handshake
  const init = await mcpRpc(accessToken, null, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "markets-ai", version: "0.1.0" },
  }, 1);
  const sessionId = init.sessionId;

  // notifications/initialized (fire-and-forget)
  await fetch(ROBINHOOD_MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => {});

  const listed = await mcpRpc(accessToken, sessionId, "tools/list", undefined, 2);
  const listedTools = ((listed.result as { tools?: McpToolInfo[] })?.tools) ?? [];

  const tools: ToolSet = {};
  let rpcId = 3;
  for (const t of listedTools) {
    tools[t.name] = dynamicTool({
      description: t.description ?? t.name,
      inputSchema: jsonSchema(t.inputSchema ?? { type: "object", properties: {} }),
      execute: async (input) => {
        const call = await mcpRpc(accessToken, sessionId, "tools/call", {
          name: t.name,
          arguments: input as Record<string, unknown>,
        }, rpcId++);
        if (call.error) throw new Error(call.error.message);
        return call.result;
      },
    });
  }

  return { tools, close: async () => { /* stateless fetch — nothing to tear down */ } };
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = authHeader.slice(7);

        const SUPABASE_URL = process.env.SUPABASE_URL!;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
        if (!LOVABLE_API_KEY) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });

        const { messages } = (await request.json()) as { messages: UIMessage[] };
        if (!Array.isArray(messages)) return new Response("messages required", { status: 400 });

        const { data: conn } = await supabase
          .from("mcp_connections")
          .select("access_token, state")
          .eq("server_url", ROBINHOOD_MCP_URL)
          .maybeSingle();

        let tools: ToolSet = {};
        let close: (() => Promise<void>) | null = null;

        if (conn?.state === "ready" && conn.access_token) {
          try {
            const loaded = await loadMcpTools(conn.access_token);
            tools = loaded.tools;
            close = loaded.close;
          } catch (e) {
            console.error("[mcp] tool load failed", e);
          }
        }

        const gateway = createOpenAICompatible({
          name: "lovable-ai-gateway",
          baseURL: "https://ai.gateway.lovable.dev/v1",
          headers: { "Lovable-API-Key": LOVABLE_API_KEY, "X-Lovable-AIG-SDK": "ai-sdk" },
        });

        const modelMessages = await convertToModelMessages(messages);
        const result = streamText({
          model: gateway.chatModel("google/gemini-2.5-flash"),
          system: SYSTEM_PROMPT,
          messages: modelMessages,
          tools,
          onFinish: async () => { try { await close?.(); } catch { /* noop */ } },
          onError: async () => { try { await close?.(); } catch { /* noop */ } },
        });

        return result.toUIMessageStreamResponse({ originalMessages: messages });
      },
    },
  },
});
