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

async function loadMcpTools(accessToken: string): Promise<{
  tools: ToolSet;
  close: () => Promise<void>;
}> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );

  const transport = new StreamableHTTPClientTransport(new URL(ROBINHOOD_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const client = new Client({ name: "markets-ai", version: "0.1.0" });
  await client.connect(transport);

  const listed = await client.listTools();
  const tools: ToolSet = {};
  for (const t of listed.tools as McpToolInfo[]) {
    tools[t.name] = dynamicTool({
      description: t.description ?? t.name,
      inputSchema: jsonSchema(t.inputSchema ?? { type: "object", properties: {} }),
      execute: async (input) => {
        const res = await client.callTool({ name: t.name, arguments: input as Record<string, unknown> });
        return res;
      },
    });
  }

  return { tools, close: () => client.close() };
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
