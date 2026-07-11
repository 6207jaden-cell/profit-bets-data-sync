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
    const attempt = async () => initFn({ data: { origin: window.location.origin } });
    const isReloadPage = (m: string) =>
      m.includes("FORCE_RELOAD") || m.includes("<html") || m.includes("<!doctype");
    try {
      let result;
      try {
        result = await attempt();
      } catch (err) {
        const msg = (err as Error).message ?? "";
        if (isReloadPage(msg)) {
          // Vite HMR restarted the dev worker mid-flight — retry once.
          await new Promise((r) => setTimeout(r, 800));
          result = await attempt();
        } else {
          throw err;
        }
      }
      setPendingAuthUrl(result.auth_url);
      qc.invalidateQueries({ queryKey: ["mcp-robinhood"] });
    } catch (e) {
      console.error(e);
      const raw = (e as Error).message ?? String(e);
      const msg = isReloadPage(raw)
        ? "The dev preview reloaded mid-request. Please tap Connect Robinhood again."
        : raw;
      alert(`Could not start Robinhood connection: ${msg}`);
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

type AgentMsg = {
  id: string; role: string; content: string;
  is_autonomous: boolean; session_type: string | null; created_at: string;
};

function AutonomousSection({ userId }: { userId: string | null }) {
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ["user-settings", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("user_settings").select("*").eq("user_id", userId!).maybeSingle();
      return data as { autonomous_mode: boolean; autonomous_execution_mode: string } | null;
    },
  });

  const autonomous = settings.data?.autonomous_mode ?? false;
  const execMode = settings.data?.autonomous_execution_mode ?? "paper";

  const status = useQuery({
    queryKey: ["autonomous-status", userId],
    enabled: !!userId && autonomous,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [{ data: lastDecision }, { count: openCount }, { data: portfolio }] = await Promise.all([
        supabase.from("agent_decisions").select("created_at").eq("user_id", userId!).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("paper_trades").select("*", { count: "exact", head: true }).eq("user_id", userId!).eq("is_open", true),
        supabase.from("paper_portfolios").select("balance, equity").eq("user_id", userId!).maybeSingle(),
      ]);
      const cashPct = portfolio && Number(portfolio.equity) > 0
        ? (Number(portfolio.balance) / Number(portfolio.equity)) * 100 : 0;
      return {
        lastScan: lastDecision?.created_at as string | undefined,
        openPositions: openCount ?? 0,
        cashPct,
      };
    },
  });

  const messages = useQuery({
    queryKey: ["agent-messages", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("agent_messages")
        .select("id, role, content, is_autonomous, session_type, created_at")
        .eq("user_id", userId!).order("created_at", { ascending: true }).limit(100);
      return (data ?? []) as AgentMsg[];
    },
  });

  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`agent_messages:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_messages", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["agent-messages", userId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  async function toggleAutonomous(next: boolean) {
    if (!userId) return;
    await supabase.from("user_settings").upsert({
      user_id: userId, autonomous_mode: next, autonomous_execution_mode: execMode,
    });
    qc.invalidateQueries({ queryKey: ["user-settings", userId] });
  }
  async function setExecMode(mode: "paper" | "live") {
    if (!userId) return;
    await supabase.from("user_settings").upsert({
      user_id: userId, autonomous_mode: autonomous, autonomous_execution_mode: mode,
    });
    qc.invalidateQueries({ queryKey: ["user-settings", userId] });
  }

  const nextScan = (() => {
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const target = new Date(et);
    if (et.getHours() < 9 || (et.getHours() === 9 && et.getMinutes() < 30)) target.setHours(9, 30, 0, 0);
    else if (et.getHours() < 12 || (et.getHours() === 12 && et.getMinutes() < 30)) target.setHours(12, 30, 0, 0);
    else { target.setDate(target.getDate() + 1); target.setHours(9, 30, 0, 0); }
    return target.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
  })();

  const autonomousMsgs = (messages.data ?? []).filter((m) => m.is_autonomous);

  return (
    <Card className="p-4 bg-card border-border space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="font-display font-semibold text-sm">Autonomous Agent</span>
          <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">BETA</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Autonomous</span>
          <Switch checked={autonomous} onCheckedChange={toggleAutonomous} />
        </div>
      </div>
      {autonomous && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-bull animate-pulse" />Active</span>
            <span>Last scan: {status.data?.lastScan ? new Date(status.data.lastScan).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : "—"}</span>
            <span>Next: {nextScan}</span>
            <span>Open: {status.data?.openPositions ?? 0}</span>
            <span>Cash: {(status.data?.cashPct ?? 0).toFixed(0)}%</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setExecMode("paper")}
                className={cn("px-2 py-0.5 rounded", execMode === "paper" ? "bg-primary text-primary-foreground" : "border border-border")}
              >Paper</button>
              <button
                onClick={() => setExecMode("live")}
                className={cn("px-2 py-0.5 rounded", execMode === "live" ? "bg-primary text-primary-foreground" : "border border-border")}
              >Live</button>
            </div>
          </div>
          {autonomousMsgs.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {autonomousMsgs.slice(-8).map((m) => (
                <AutonomousMessage key={m.id} m={m} />
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function AutonomousMessage({ m }: { m: AgentMsg }) {
  const labelMap: Record<string, string> = {
    morning_scan: "Morning Scan", midday_scan: "Midday Scan",
    exit_check: "Exit Check", weekly_learning: "Weekly Review",
  };
  const label = labelMap[m.session_type ?? ""] ?? "Autonomous";
  const time = new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex gap-2">
      <div className="h-7 w-7 rounded-full bg-purple-500/20 flex items-center justify-center text-sm shrink-0">🤖</div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-purple-400 mb-0.5">Autonomous Agent • {label} • {time}</div>
        <div className="rounded-lg bg-purple-950/30 border border-purple-800/40 px-3 py-2 text-sm whitespace-pre-wrap">{m.content}</div>
      </div>
    </div>
  );
}
