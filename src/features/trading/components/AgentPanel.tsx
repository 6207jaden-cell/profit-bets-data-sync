import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, Link2, Loader2, PlugZap, Send, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PremiumLock } from "@/components/PremiumLock";
import { cn } from "@/lib/utils";
import {
  completeRobinhoodConnection,
  getRobinhoodConnection,
  initiateRobinhoodConnection,
  disconnectRobinhood,
} from "@/lib/mcp-client.functions";

const SUGGESTED = [
  "What's in my portfolio?",
  "Analyze my top holding.",
  "Which of my positions is closest to a stop loss?",
  "Show my buying power and recent orders.",
];

const ROBINHOOD_MANUAL_REDIRECT_URI =
  typeof window !== "undefined"
    ? `${window.location.origin}/api/public/mcp/robinhood/callback`
    : "http://localhost:1455/callback";

export function AgentPanel() {
  const qc = useQueryClient();
  const { hasElite, loading: profileLoading, userId } = useProfile();
  const search = useSearch({ strict: false }) as { connected?: string };
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [authTokenReady, setAuthTokenReady] = useState(false);
  const [pendingAuthUrl, setPendingAuthUrl] = useState<string | null>(null);
  const [callbackInput, setCallbackInput] = useState("");
  const [completing, setCompleting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const getConnFn = useServerFn(getRobinhoodConnection);
  const initFn = useServerFn(initiateRobinhoodConnection);
  const completeFn = useServerFn(completeRobinhoodConnection);
  const disconnectFn = useServerFn(disconnectRobinhood);

  const conn = useQuery({
    queryKey: ["mcp-robinhood"],
    queryFn: () => getConnFn(),
    refetchInterval: (q) =>
      (q.state.data as { state?: string } | null)?.state === "authenticating" ? 2000 : false,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthTokenReady(!!data.session?.access_token));
  }, []);

  // Refresh state after callback redirect
  useEffect(() => {
    if (search.connected) {
      setPendingAuthUrl(null);
      setCallbackInput("");
      setConnectError(null);
      qc.invalidateQueries({ queryKey: ["mcp-robinhood"] });
      const params = new URLSearchParams(window.location.search);
      params.delete("connected");
      navigate({ to: "/trading", search: Object.fromEntries(params), replace: true });
    }
  }, [search.connected, qc, navigate]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: async ({ messages, id }) => {
          const { data } = await supabase.auth.getSession();
          const tok = data.session?.access_token;
          const headers: Record<string, string> = {};
          if (tok) headers.Authorization = `Bearer ${tok}`;
          return { body: { messages, id }, headers };
        },
      }),
    [],
  );

  const chat = useChat({
    id: "robinhood-agent",
    transport,
    onError: (e) => console.error("[chat]", e),
  });

  const ready = conn.data?.state === "ready";
  const authenticating = conn.data?.state === "authenticating";
  const authUrl = typeof conn.data?.auth_url === "string" ? conn.data.auth_url : null;
  const currentAuthUrl = (pendingAuthUrl ?? authUrl) && (() => {
    try {
      const url = new URL((pendingAuthUrl ?? authUrl)!);
      return url.pathname === "/oauth" && url.searchParams.get("redirect_uri") === ROBINHOOD_MANUAL_REDIRECT_URI
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  })();
  const isStreaming = chat.status === "submitted" || chat.status === "streaming";

  async function handleConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const { auth_url } = await initFn({ data: { origin: window.location.origin } });
      setPendingAuthUrl(auth_url);
      qc.invalidateQueries({ queryKey: ["mcp-robinhood"] });
    } catch (e) {
      console.error(e);
      alert(`Could not start Robinhood connection: ${(e as Error).message}`);
    } finally {
      setConnecting(false);
    }
  }

  async function handleCompleteConnection() {
    if (!callbackInput.trim()) return;
    setCompleting(true);
    setConnectError(null);
    try {
      await completeFn({ data: { callback: callbackInput.trim() } });
      setPendingAuthUrl(null);
      setCallbackInput("");
      await qc.invalidateQueries({ queryKey: ["mcp-robinhood"] });
    } catch (e) {
      const message = (e as Error).message;
      setConnectError(message);
      console.error(e);
    } finally {
      setCompleting(false);
    }
  }

  async function handleDisconnect() {
    setPendingAuthUrl(null);
    setCallbackInput("");
    setConnectError(null);
    await disconnectFn();
    qc.invalidateQueries({ queryKey: ["mcp-robinhood"] });
  }

  async function send(prompt: string) {
    if (!prompt.trim() || isStreaming) return;
    setInput("");
    await chat.sendMessage({ text: prompt.trim() });
  }

  if (profileLoading || !authTokenReady) {
    return (
      <Card className="p-12 flex justify-center bg-card border-border">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!hasElite) {
    return (
      <PremiumLock
        requiredTier="elite"
        title="Robinhood Agent"
        description="The live AI trading agent — with direct access to your Robinhood account via MCP — is included in the Elite membership."
        perks={[
          "Live read of holdings, buying power, and orders",
          "Real-time position analysis with tool calls",
          "Propose trades that Robinhood confirms on their side",
        ]}
      />
    );
  }

  if (!ready) {
    return (
      <div className="space-y-4">
        <AutonomousSection userId={userId} />
        <Card className="p-8 md:p-12 bg-card border-border">
        <div className="max-w-md mx-auto text-center space-y-5">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Bot className="h-7 w-7 text-primary" />
          </div>
          <div>
            <div className="flex items-center justify-center gap-2 mb-1">
              <h3 className="font-display text-2xl font-semibold">Robinhood Agent</h3>
              <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">BETA</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Chat with an AI that has live access to your Robinhood account. Ask about your portfolio, get analysis, or place trades — Robinhood confirms every order.
            </p>
          </div>
          <ul className="text-left text-sm text-muted-foreground space-y-2">
            <li className="flex gap-2"><Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" /> Read holdings, buying power, and order history.</li>
            <li className="flex gap-2"><Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" /> Analyze positions with real-time context.</li>
            <li className="flex gap-2"><Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" /> Propose trades that Robinhood confirms on their side.</li>
          </ul>
          {authenticating ? (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for Robinhood authorization…
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {currentAuthUrl ? (
                  <a
                    href={currentAuthUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      connecting && "pointer-events-none opacity-50",
                    )}
                  >
                    <Link2 className="h-4 w-4" />
                    Open Robinhood
                  </a>
                ) : (
                  <Button type="button" onClick={handleConnect} disabled={connecting} className="w-full">
                    {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
                    Create secure link
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={handleDisconnect} className="w-full">
                  Start over
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Robinhood may land on localhost after approval. Copy that full browser URL and paste it below.
              </div>
              <div className="space-y-2 text-left">
                <input
                  value={callbackInput}
                  onChange={(e) => setCallbackInput(e.target.value)}
                  placeholder={`${ROBINHOOD_MANUAL_REDIRECT_URI}?code=…&state=…`}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
                />
                <Button
                  type="button"
                  onClick={handleCompleteConnection}
                  disabled={completing || !callbackInput.trim()}
                  className="w-full"
                >
                  {completing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlugZap className="h-4 w-4 mr-2" />}
                  Finish connection
                </Button>
                {connectError && <div className="text-xs text-destructive text-center">{connectError}</div>}
              </div>
            </div>
          ) : (
            <Button onClick={handleConnect} disabled={connecting} className="w-full">
              {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlugZap className="h-4 w-4 mr-2" />}
              Connect Robinhood
            </Button>
          )}
          <p className="text-[10px] text-muted-foreground">
            You'll be redirected to Robinhood to grant access. Tokens are stored securely and scoped to your account.
          </p>
        </div>
      </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
    <AutonomousSection userId={userId} />
    <div className="grid grid-rows-[auto_1fr_auto] gap-3 h-[calc(100vh-320px)] min-h-[500px]">
      <Card className="px-4 py-2 flex items-center justify-between bg-card border-border">
        <div className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-bull animate-pulse" />
          <span className="font-display font-semibold">Robinhood</span>
          <span className="text-muted-foreground text-xs">connected via MCP</span>
        </div>
        <button
          onClick={handleDisconnect}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <X className="h-3 w-3" /> disconnect
        </button>
      </Card>

      <Card className="p-4 overflow-y-auto bg-card border-border">
        {chat.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
            <Bot className="h-10 w-10 text-primary/70" />
            <div>
              <div className="font-display font-semibold">Ask about your Robinhood account</div>
              <div className="text-xs text-muted-foreground">The agent will use live Robinhood tools to answer.</div>
            </div>
            <div className="grid gap-2 w-full max-w-md">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-sm px-3 py-2 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {chat.messages.map((m) => (
              <MessageView key={m.id} message={m} />
            ))}
            {isStreaming && (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> thinking…
              </div>
            )}
          </div>
        )}
      </Card>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isStreaming}
          placeholder="Ask about your portfolio, place a trade, analyze a position…"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <Button type="submit" disabled={isStreaming || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
    </div>
  );
}

function MessageView({ message }: { message: ReturnType<typeof useChat>["messages"][number] }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div className={cn(
        "h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold",
        isUser ? "bg-primary/20 text-primary" : "bg-secondary text-secondary-foreground",
      )}>
        {isUser ? "You" : <Bot className="h-4 w-4" />}
      </div>
      <div className={cn(
        "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm space-y-2",
        isUser ? "bg-primary/10 text-foreground" : "bg-secondary/60",
      )}>
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return <div key={i} className="whitespace-pre-wrap leading-relaxed">{part.text}</div>;
          }
          if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
            const p = part as unknown as { toolName?: string; type: string; state?: string; input?: unknown; output?: unknown };
            const name = p.toolName ?? p.type.replace(/^tool-/, "");
            return (
              <details key={i} className="rounded-md border border-border bg-background/60 px-2 py-1 text-xs">
                <summary className="cursor-pointer flex items-center gap-2">
                  <Link2 className="h-3 w-3 text-primary" />
                  <span className="font-mono">{name}</span>
                  <span className="text-muted-foreground">{p.state ?? ""}</span>
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-all opacity-80">
                  {JSON.stringify({ input: p.input, output: p.output }, null, 2)}
                </pre>
              </details>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
