import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AlertOctagon, Bot, ChevronDown, ChevronRight, ExternalLink, FlaskConical, Link2, Loader2, Pause, Play, Send, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PremiumLock } from "@/components/PremiumLock";
import { AgentBacktestModal } from "./AgentBacktestModal";
import { applyLearningAdjustment } from "@/lib/learning-adjustment.functions";
import { toast } from "sonner";
import { AgentPerformancePanel } from "./AgentPerformancePanel";
import { cn } from "@/lib/utils";
import {
  getRobinhoodConnection,
  initiateRobinhoodConnection,
  completeRobinhoodConnection,
  disconnectRobinhood,
} from "@/lib/mcp-client.functions";

const SUGGESTED = [
  "What's in my portfolio?",
  "Analyze my top holding.",
  "Which of my positions is closest to a stop loss?",
  "Show my buying power and recent orders.",
];

export function AgentPanel() {
  const qc = useQueryClient();
  const { hasElite, loading: profileLoading, userId } = useProfile();
  const [input, setInput] = useState("");
  const [authTokenReady, setAuthTokenReady] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const getConnFn = useServerFn(getRobinhoodConnection);
  const initiateConnFn = useServerFn(initiateRobinhoodConnection);
  const completeConnFn = useServerFn(completeRobinhoodConnection);
  const disconnectFn = useServerFn(disconnectRobinhood);

  const conn = useQuery({
    queryKey: ["mcp-robinhood"],
    queryFn: () => getConnFn(),
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthTokenReady(!!data.session?.access_token));
  }, []);

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
  const isStreaming = chat.status === "submitted" || chat.status === "streaming";

  async function handleDisconnect() {
    await disconnectFn();
    qc.invalidateQueries({ queryKey: ["mcp-robinhood"] });
  }

  async function handleConnect() {
    setConnectionBusy(true);
    setConnectionError(null);
    const authWindow = window.open("about:blank", "robinhood-oauth");
    try {
      const result = await initiateConnFn();
      if (authWindow) authWindow.location.href = result.auth_url;
      else window.location.href = result.auth_url;
      await qc.invalidateQueries({ queryKey: ["mcp-robinhood"] });
    } catch (error) {
      authWindow?.close();
      setConnectionError(error instanceof Error ? error.message : "Could not start the Robinhood connection.");
    } finally {
      setConnectionBusy(false);
    }
  }

  async function handleCompleteConnection() {
    if (!callbackUrl.trim()) return;
    setConnectionBusy(true);
    setConnectionError(null);
    try {
      await completeConnFn({ data: { callback: callbackUrl.trim() } });
      setCallbackUrl("");
      await qc.invalidateQueries({ queryKey: ["mcp-robinhood"] });
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not finish the Robinhood connection.");
    } finally {
      setConnectionBusy(false);
    }
  }

  async function send(prompt: string) {
    if (!prompt.trim() || isStreaming) return;
    setInput("");
    await chat.sendMessage({ text: prompt.trim() });
  }

  // Listen for "Explain this trade" events fired from ExecutionPanel and elsewhere.
  useEffect(() => {
    function onExplain(e: Event) {
      const d = (e as CustomEvent).detail as {
        asset?: string; side?: string; entry?: number; current?: number | null;
        unreal?: number | null; unrealPct?: number | null; instrument?: string;
      };
      if (!d) return;
      const prompt = `Explain this trade: ${String(d.side ?? "").toUpperCase()} ${d.asset} (${d.instrument ?? "stock"}). ` +
        `Entry $${Number(d.entry ?? 0).toFixed(2)}, current $${d.current != null ? Number(d.current).toFixed(2) : "n/a"}, ` +
        `unrealized ${d.unreal != null ? `$${d.unreal.toFixed(2)}` : "n/a"} (${d.unrealPct != null ? `${d.unrealPct.toFixed(2)}%` : "n/a"}). ` +
        `Why is this position on, what's the thesis, and what would make you close it?`;
      void chat.sendMessage({ text: prompt });
    }
    window.addEventListener("explain-trade", onExplain as EventListener);
    return () => window.removeEventListener("explain-trade", onExplain as EventListener);
  }, [chat]);


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
           <div className="rounded-md border border-border bg-muted/40 p-4 text-left space-y-3">
             <div className="text-sm font-medium">Connect with Robinhood Trading MCP</div>
             <p className="text-xs leading-relaxed text-muted-foreground">
               Approve access in Robinhood. Your browser will then try to open a localhost page; it may look blank or say it cannot connect. That is expected—copy the full URL from that page's address bar and paste it below.
             </p>
             <Button type="button" onClick={handleConnect} disabled={connectionBusy} className="w-full">
               {connectionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
               {conn.data?.state === "authenticating" ? "Open Robinhood again" : "Connect Robinhood"}
             </Button>
             {conn.data?.state === "authenticating" && (
               <div className="space-y-2 border-t border-border pt-3">
                 <label htmlFor="robinhood-callback" className="text-xs font-medium">Finish connection</label>
                 <input
                   id="robinhood-callback"
                   value={callbackUrl}
                   onChange={(event) => setCallbackUrl(event.target.value)}
                   placeholder="http://localhost:1455/callback?code=…&state=…"
                   autoCapitalize="none"
                   autoCorrect="off"
                   className="h-10 w-full rounded-md border border-border bg-background px-3 text-xs outline-none focus:border-primary"
                 />
                 <Button type="button" onClick={handleCompleteConnection} disabled={connectionBusy || !callbackUrl.trim()} className="w-full">
                   Finish connection
                 </Button>
                 <Button type="button" variant="ghost" size="sm" onClick={handleDisconnect} disabled={connectionBusy} className="w-full">
                   Start over
                 </Button>
               </div>
             )}
             {connectionError && <p role="alert" className="text-xs text-destructive break-words">{connectionError}</p>}
           </div>
           <a href="https://robinhood.com/us/en/support/articles/agentic-trading-overview/" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground">
             Robinhood setup requirements <ExternalLink className="h-3 w-3" />
           </a>
        </div>
      </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
    <AutonomousSection userId={userId} />
    <AgentPerformanceCard />
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
      return data as {
        autonomous_mode: boolean;
        autonomous_execution_mode: string;
        autonomous_paused_until: string | null;
      } | null;
    },
  });

  const autonomous = settings.data?.autonomous_mode ?? false;
  const execMode = settings.data?.autonomous_execution_mode ?? "paper";
  const pausedUntilRaw = settings.data?.autonomous_paused_until ?? null;
  const pausedUntil = pausedUntilRaw && new Date(pausedUntilRaw) > new Date() ? new Date(pausedUntilRaw) : null;

  const status = useQuery({
    queryKey: ["autonomous-status", userId],
    enabled: !!userId && autonomous,
    refetchInterval: 30_000,  // live cash refresh every 30s
    queryFn: async () => {
      const [{ data: lastDecision }, { count: openCount }, { data: portfolio }, { count: decisionCount }] = await Promise.all([
        supabase.from("agent_decisions").select("created_at").eq("user_id", userId!).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("paper_trades").select("*", { count: "exact", head: true }).eq("user_id", userId!).eq("is_open", true),
        supabase.from("paper_portfolios").select("balance, equity").eq("user_id", userId!).maybeSingle(),
        supabase.from("agent_decisions").select("*", { count: "exact", head: true }).eq("user_id", userId!),
      ]);
      const cashPct = portfolio && Number(portfolio.equity) > 0
        ? (Number(portfolio.balance) / Number(portfolio.equity)) * 100 : 0;
      return {
        lastScan: lastDecision?.created_at as string | undefined,
        openPositions: openCount ?? 0,
        cashPct,
        hasFirstRun: (decisionCount ?? 0) > 0,
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
        (payload) => {
          qc.invalidateQueries({ queryKey: ["agent-messages", userId] });
          qc.invalidateQueries({ queryKey: ["autonomous-status", userId] });
          // Browser push notification when agent posts autonomously
          const msg = payload.new as { is_autonomous?: boolean; content?: string; session_type?: string };
          if (msg?.is_autonomous && "Notification" in window && Notification.permission === "granted") {
            const session = msg.session_type?.replace("_", " ") ?? "Agent";
            new Notification(`🤖 ${session}`, {
              body: (msg.content ?? "").slice(0, 120),
              icon: "/favicon.ico",
              tag: "agent-scan",
            });
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  // Request browser notification permission when autonomous mode is turned on
  useEffect(() => {
    if (autonomous && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [autonomous]);

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
  async function setPause(hours: number | null) {
    if (!userId) return;
    const until = hours == null ? null : new Date(Date.now() + hours * 3600_000).toISOString();
    await supabase.from("user_settings").upsert({
      user_id: userId, autonomous_mode: autonomous, autonomous_execution_mode: execMode,
      autonomous_paused_until: until,
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
          {autonomous && (
            <button
              onClick={() => toggleAutonomous(false)}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 text-[10px] font-medium"
              title="Emergency stop — immediately disables autonomous trading"
            >
              <AlertOctagon className="h-3 w-3" />STOP
            </button>
          )}
          <span className="text-muted-foreground">Autonomous</span>
          <Switch checked={autonomous} onCheckedChange={toggleAutonomous} />
        </div>
      </div>
      {autonomous && !status.data?.hasFirstRun && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1.5">
          <div className="text-xs font-semibold text-primary">First scan checklist</div>
          <div className="space-y-1">
            {[
              { label: "Autonomous Mode ON", done: true },
              { label: "Paper mode selected (safe to start)", done: execMode === "paper" },
              { label: "First morning scan runs at 9:30am ET", done: false },
              { label: "Check Agent Log tab after first scan", done: false },
            ].map(({ label, done }) => (
              <div key={label} className="flex items-center gap-1.5 text-[11px]">
                <span className={done ? "text-emerald-400" : "text-muted-foreground"}>{done ? "✓" : "○"}</span>
                <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {autonomous && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {pausedUntil ? (
              <span className="flex items-center gap-1.5 text-amber-500">
                <Pause className="h-3 w-3" />
                Paused until {pausedUntil.toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}
                <button
                  onClick={() => setPause(null)}
                  className="ml-1 underline hover:text-amber-400"
                >resume</button>
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-bull animate-pulse" />
                Active
                <span className={cn(
                  "text-[9px] font-bold px-1.5 py-0.5 rounded ml-1",
                  execMode === "live"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                )}>
                  {execMode === "live" ? "🔴 LIVE TRADING" : "📝 PAPER MODE"}
                </span>
              </span>
            )}
            <span>Last scan: {status.data?.lastScan ? new Date(status.data.lastScan).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : "—"}</span>
            <span>Next: {nextScan}</span>
            <span>Open: {status.data?.openPositions ?? 0}</span>
            <span>Cash: {(status.data?.cashPct ?? 0).toFixed(0)}%</span>
            <button
              onClick={async () => {
                const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
                  ?? (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
                toast.message("Triggering morning scan…");
                try {
                  const res = await fetch("/api/public/autonomous-agent", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", apikey: anonKey },
                    body: JSON.stringify({ session: "morning" }),
                  });
                  const j = await res.json() as { ok?: boolean; reason?: string };
                  if (j.ok) {
                    toast.success("Scan complete — check Agent Log for decisions");
                    qc.invalidateQueries({ queryKey: ["autonomous-status", userId] });
                    qc.invalidateQueries({ queryKey: ["agent-messages", userId] });
                    qc.invalidateQueries({ queryKey: ["agent-decisions", userId] });
                  } else {
                    toast.error(`Scan failed: ${j.reason ?? "unknown error"}`);
                  }
                } catch (e) {
                  toast.error("Could not reach agent endpoint");
                }
              }}
              className="ml-2 text-[10px] px-2 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 transition-colors font-medium"
            >
              ▶ Run scan now
            </button>
            <div className="ml-auto flex items-center gap-1">
              {!pausedUntil && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="px-2 py-0.5 rounded border border-border hover:border-amber-500 hover:text-amber-500 flex items-center gap-1">
                      <Pause className="h-3 w-3" />Pause
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-40 p-1">
                    {[
                      { label: "1 hour", hours: 1 },
                      { label: "4 hours", hours: 4 },
                      { label: "Today", hours: 12 },
                      { label: "1 week", hours: 24 * 7 },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        onClick={() => setPause(opt.hours)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent"
                      >{opt.label}</button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-muted-foreground">Mode:</span>
                <button
                  onClick={() => setExecMode("paper")}
                  className={cn(
                    "px-2 py-0.5 rounded font-medium transition-all",
                    execMode === "paper"
                      ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                      : "text-muted-foreground hover:text-foreground border border-transparent"
                  )}
                >Paper</button>
                <button
                  onClick={() => setExecMode("live")}
                  className={cn(
                    "px-2 py-0.5 rounded font-medium transition-all",
                    execMode === "live"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse"
                      : "text-muted-foreground hover:text-foreground border border-transparent"
                  )}
                >Live</button>
              </div>
            </div>
          </div>
          {autonomousMsgs.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {autonomousMsgs.slice(-8).map((m) => (
                <AutonomousMessage key={m.id} m={m} />
              ))}
            </div>
          )}
          {autonomous && userId && (
            <div className="pt-1">
              <AgentBacktestModal userId={userId} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function AgentPerformanceCard() {
  const { userId } = useProfile();
  const [open, setOpen] = useState(false);
  if (!userId) return null;
  return (
    <Card className="border-border/50 bg-card/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <span className="text-primary">📈</span> Agent Performance Analytics
        </span>
        <span className="text-[10px] text-muted-foreground">{open ? "collapse" : "expand"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-border/30">
          <AgentPerformancePanel />
        </div>
      )}
    </Card>
  );
}

function ApplyAdjustmentButtons({ content }: { content: string }) {
  const { userId } = useProfile();
  const [applying, setApplying] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const applyFn = useServerFn(applyLearningAdjustment);

  // Extract adjustments from the message content (look for bullet points or numbered items)
  const adjustments = content
    .split(/\n/)
    .map((l) => l.replace(/^[-•*\d.]+\s*/, "").trim())
    .filter((l) => l.length > 20 && l.length < 400);

  const { data: strategies } = useQuery({
    queryKey: ["strategies-for-adjustment", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("strategies")
        .select("id, name")
        .eq("user_id", userId!)
        .eq("active", true)
        .limit(10);
      return data ?? [];
    },
  });

  if (!adjustments.length || !strategies?.length) return null;

  async function apply(adj: string) {
    if (!strategies?.length || applying) return;
    setApplying(adj);
    try {
      // Apply to the first active strategy (most relevant)
      const result = await applyFn({ data: { strategy_id: strategies[0].id, adjustment: adj } });
      if (result.ok) {
        toast.success(`Applied to "${result.strategy_name}": ${result.change_summary}`);
        setDone((d) => new Set([...d, adj]));
      } else {
        toast.error(`Failed: ${result.error}`);
      }
    } catch (e) {
      toast.error("Failed to apply adjustment");
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="text-[10px] text-purple-300 font-medium">Apply to strategy:</div>
      {adjustments.slice(0, 3).map((adj) => (
        <button
          key={adj}
          disabled={!!applying || done.has(adj)}
          onClick={() => apply(adj)}
          className="w-full text-left text-[10px] px-2 py-1.5 rounded bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-purple-200"
        >
          {done.has(adj) ? "✓ " : applying === adj ? "⏳ " : "→ "}
          {adj.slice(0, 100)}{adj.length > 100 ? "…" : ""}
        </button>
      ))}
    </div>
  );
}

function AutonomousMessage({ m }: { m: AgentMsg }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const labelMap: Record<string, string> = {
    morning_scan: "Morning Scan", midday_scan: "Midday Scan",
    exit_check: "Exit Check", weekly_learning: "Weekly Review",
  };
  const label = labelMap[m.session_type ?? ""] ?? "Autonomous";
  const time = new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const decision = useQuery({
    queryKey: ["agent-decision", m.session_type, m.created_at],
    enabled: showReasoning && !!m.session_type,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const t = new Date(m.created_at).getTime();
      const { data } = await supabase.from("agent_decisions")
        .select("market_assessment, payload, regime, trades_opened, trades_closed, created_at")
        .eq("session_type", m.session_type!)
        .gte("created_at", new Date(t - 30 * 60_000).toISOString())
        .lte("created_at", new Date(t + 30 * 60_000).toISOString())
        .order("created_at", { ascending: false }).limit(1);
      return data?.[0] ?? null;
    },
  });

  return (
    <div className="flex gap-2">
      <div className="h-7 w-7 rounded-full bg-purple-500/20 flex items-center justify-center text-sm shrink-0">🤖</div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-purple-400 mb-0.5">Autonomous Agent • {label} • {time}</div>
        <div className="rounded-lg bg-purple-950/30 border border-purple-800/40 px-3 py-2 text-sm whitespace-pre-wrap">{m.content}</div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <button
            onClick={() => setShowReasoning((v) => !v)}
            className="text-[10px] text-purple-300 hover:text-purple-200 flex items-center gap-1"
          >
            {showReasoning ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showReasoning ? "Hide reasoning" : "Show reasoning chain"}
          </button>
          {m.session_type === "weekly_learning" && <ApplyAdjustmentButtons content={m.content} />}
        </div>
        {showReasoning && (
          <div className="mt-1 rounded-md bg-background/60 border border-purple-800/30 p-2 text-[11px] space-y-1.5">
            {!decision.data ? (
              <span className="text-muted-foreground">No decision log found for this scan.</span>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                  {decision.data.regime && <span className="px-1.5 py-0.5 rounded bg-muted">regime: {decision.data.regime}</span>}
                  <span className="px-1.5 py-0.5 rounded bg-muted">opened: {decision.data.trades_opened}</span>
                  <span className="px-1.5 py-0.5 rounded bg-muted">closed: {decision.data.trades_closed}</span>
                </div>
                {decision.data.market_assessment && (
                  <div className="whitespace-pre-wrap text-muted-foreground">{decision.data.market_assessment}</div>
                )}
                {decision.data.payload ? (
                  <details>
                    <summary className="cursor-pointer text-purple-300">Raw signals</summary>
                    <pre className="mt-1 max-h-40 overflow-auto text-[10px] font-mono">{JSON.stringify(decision.data.payload, null, 2)}</pre>
                  </details>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

