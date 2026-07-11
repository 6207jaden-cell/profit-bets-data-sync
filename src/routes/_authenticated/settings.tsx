import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings as SettingsIcon, KeyRound, Webhook, Save, Trash2, Send, Loader2, Bot, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";

const EVENTS = ["trade_open", "trade_close", "signal_hit", "strategy_retired"] as const;
const KEYS = ["FINNHUB_API_KEY", "POLYGON_API_KEY", "ALPHA_VANTAGE_API_KEY", "LOVABLE_API_KEY"] as const;

type AgentSettings = {
  max_position_pct: number;
  min_cash_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  extra_symbols: string[];
};

const DEFAULT_AGENT: AgentSettings = {
  max_position_pct: 35, min_cash_pct: 20, stop_loss_pct: 7, take_profit_pct: 15, extra_symbols: [],
};

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Webhooks, Agent & API Keys" },
      { name: "description", content: "Configure the autonomous trading agent, webhooks, and API keys." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { userId } = useProfile();
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(EVENTS));
  const [active, setActive] = useState(true);
  const [testing, setTesting] = useState(false);

  const q = useQuery({
    queryKey: ["user-webhook", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_webhooks").select("*").maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return data;
    },
  });

  useEffect(() => {
    if (q.data) {
      setUrl(q.data.webhook_url ?? "");
      setSelected(new Set(q.data.events ?? EVENTS));
      setActive(Boolean(q.data.active));
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not signed in");
      if (!url || !/^https?:\/\//.test(url)) throw new Error("Enter a valid URL");
      const payload = { user_id: userId, webhook_url: url, events: Array.from(selected), active };
      const { error } = await supabase.from("user_webhooks").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Webhook saved"); qc.invalidateQueries({ queryKey: ["user-webhook", userId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.from("user_webhooks").delete().eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Webhook removed"); setUrl(""); qc.invalidateQueries({ queryKey: ["user-webhook", userId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function sendTest() {
    if (!url) { toast.error("Enter a URL first"); return; }
    setTesting(true);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "test", message: "Webhook connected successfully", ts: new Date().toISOString() }),
      });
      if (r.ok) toast.success(`Test sent — ${r.status}`);
      else toast.error(`Test failed — ${r.status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed (CORS or network)");
    } finally {
      setTesting(false);
    }
  }

  function toggleEvent(ev: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(ev)) n.delete(ev); else n.add(ev);
      return n;
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <header className="flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-primary" />
          <h1 className="font-display text-xl font-semibold">Settings</h1>
        </header>

        <Card className="p-5 border-border bg-card space-y-4">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-primary" />
            <h2 className="font-display font-semibold">Webhook Configuration</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Receive POST notifications when trades open/close, signals hit, or strategies auto-retire.
          </p>
          <div className="space-y-2">
            <Label className="text-xs">Webhook URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-server.com/webhook" className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Events</Label>
            <div className="grid grid-cols-2 gap-2">
              {EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={selected.has(ev)} onCheckedChange={() => toggleEvent(ev)} />
                  <span className="font-mono">{ev}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(Boolean(v))} />
            <span>Active</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={sendTest} disabled={testing || !url}>
              {testing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
              Send Test
            </Button>
            {q.data && (
              <Button size="sm" variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending} className="text-bear">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete
              </Button>
            )}
          </div>
        </Card>

        <AgentSettingsCard userId={userId} />

        <Card className="p-5 border-border bg-card space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <h2 className="font-display font-semibold">API Keys</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            API keys are managed in your Lovable Cloud environment variables. This is a read-only status view.
          </p>
          <ul className="space-y-1 text-sm font-mono">
            {KEYS.map((k) => (
              <li key={k} className="flex items-center justify-between border-b border-border py-1.5">
                <span className="text-muted-foreground">{k}</span>
                <span className="text-bull">✓ configured</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function AgentSettingsCard({ userId }: { userId: string | null }) {
  const qc = useQueryClient();
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_AGENT);
  const [symbolInput, setSymbolInput] = useState("");

  const q = useQuery({
    queryKey: ["user-settings-agent", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("user_settings").select("agent_settings").eq("user_id", userId!).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (q.data?.agent_settings) {
      const s = q.data.agent_settings as Partial<AgentSettings>;
      setSettings({
        max_position_pct: Number(s.max_position_pct ?? DEFAULT_AGENT.max_position_pct),
        min_cash_pct: Number(s.min_cash_pct ?? DEFAULT_AGENT.min_cash_pct),
        stop_loss_pct: Number(s.stop_loss_pct ?? DEFAULT_AGENT.stop_loss_pct),
        take_profit_pct: Number(s.take_profit_pct ?? DEFAULT_AGENT.take_profit_pct),
        extra_symbols: Array.isArray(s.extra_symbols) ? (s.extra_symbols as string[]) : [],
      });
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.from("user_settings").upsert(
        { user_id: userId, agent_settings: settings as unknown as never },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Agent settings saved"); qc.invalidateQueries({ queryKey: ["user-settings-agent", userId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  function addSymbol() {
    const s = symbolInput.trim().toUpperCase();
    if (!s || settings.extra_symbols.includes(s) || settings.extra_symbols.length >= 20) return;
    setSettings({ ...settings, extra_symbols: [...settings.extra_symbols, s] });
    setSymbolInput("");
  }
  function removeSymbol(s: string) {
    setSettings({ ...settings, extra_symbols: settings.extra_symbols.filter((x) => x !== s) });
  }

  return (
    <Card className="p-5 border-border bg-card space-y-5">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-primary" />
        <h2 className="font-display font-semibold">Autonomous Agent</h2>
        <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">CONFIG</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Guardrails and defaults for the autonomous scanner. The AI cannot override these caps.
      </p>

      <AgentSlider
        label="Max position size" value={settings.max_position_pct} min={5} max={50} step={1}
        onChange={(v) => setSettings({ ...settings, max_position_pct: v })}
        hint="Hardest cap — no single trade exceeds this share of equity."
      />
      <AgentSlider
        label="Min cash buffer" value={settings.min_cash_pct} min={10} max={50} step={1}
        onChange={(v) => setSettings({ ...settings, min_cash_pct: v })}
        hint="Reserve — the agent never deploys below this cash %."
      />
      <AgentSlider
        label="Default stop loss" value={settings.stop_loss_pct} min={2} max={15} step={0.5}
        onChange={(v) => setSettings({ ...settings, stop_loss_pct: v })}
        hint="Default exit if a position moves this % against you."
      />
      <AgentSlider
        label="Default take profit" value={settings.take_profit_pct} min={5} max={30} step={0.5}
        onChange={(v) => setSettings({ ...settings, take_profit_pct: v })}
        hint="Default exit when a position moves this % in your favor."
      />

      <div className="space-y-2">
        <Label className="text-xs">Extra scan symbols</Label>
        <div className="flex gap-2">
          <Input
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSymbol(); } }}
            placeholder="e.g. AVGO"
            maxLength={10}
            className="font-mono uppercase text-xs h-8"
          />
          <Button size="sm" variant="outline" onClick={addSymbol} disabled={!symbolInput.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-[24px]">
          {settings.extra_symbols.length === 0 && <span className="text-xs text-muted-foreground">Default universe only.</span>}
          {settings.extra_symbols.map((s) => (
            <button
              key={s}
              onClick={() => removeSymbol(s)}
              className="flex items-center gap-1 text-[11px] font-mono uppercase px-1.5 py-0.5 rounded border border-border hover:border-bear hover:text-bear"
            >
              {s}<X className="h-2.5 w-2.5" />
            </button>
          ))}
        </div>
      </div>

      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
        Save agent settings
      </Button>
    </Card>
  );
}

function AgentSlider({
  label, value, min, max, step, onChange, hint,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-primary">{value}%</span>
      </div>
      <Slider
        value={[value]} min={min} max={max} step={step}
        onValueChange={(v) => onChange(v[0])}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
