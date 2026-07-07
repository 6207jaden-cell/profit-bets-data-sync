import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Sparkles, Trash2, Loader2, Play, PauseCircle, Lock, User, BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { generateStrategyFromPrompt, generateStrategyExplanation } from "@/lib/strategy.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type TemplateT = { name: string; blurb: string; style: string; prompt: string };
const TEMPLATES: TemplateT[] = [
  { name: "Golden Cross", blurb: "SMA(50) crosses SMA(200)", style: "momentum",
    prompt: "Momentum strategy: buy when SMA(50) crosses above SMA(200) on large-cap US stocks. Exit when SMA(50) crosses back below SMA(200). Universe: AAPL, MSFT, NVDA, GOOGL. Style: momentum." },
  { name: "RSI Mean Reversion", blurb: "Buy oversold, sell recovery", style: "mean_reversion",
    prompt: "Mean reversion: buy when RSI(14) drops below 30 (oversold), exit when RSI recovers above 55. Universe: SPY, QQQ, AAPL, TSLA. Style: mean_reversion." },
  { name: "EMA Crossover", blurb: "12/26 EMA trend", style: "momentum",
    prompt: "Trend following: enter long when EMA(12) crosses above EMA(26), exit when EMA(12) crosses back below EMA(26). Universe: MSFT, AMZN, META. Style: momentum." },
  { name: "Crypto RSI Dip", blurb: "BTC/ETH oversold buys", style: "mean_reversion",
    prompt: "Mean reversion on crypto: buy bitcoin and ethereum when RSI(14) falls below 35, sell when RSI exceeds 65. Style: mean_reversion." },
  { name: "SMA200 Breakout", blurb: "Price breaks 200-day", style: "breakout",
    prompt: "Breakout strategy: enter when price closes above SMA(200) for the first time in 20 days. Exit when price drops 5% below entry. Universe: SPY, QQQ, IWM. Style: breakout." },
  { name: "Bollinger Reversion", blurb: "2 sigma below SMA(20)", style: "mean_reversion",
    prompt: "Buy when price drops more than 2 standard deviations below SMA(20) (RSI < 35 confirms), exit when price returns to SMA(20). Universe: AAPL, NVDA, TSLA. Style: mean_reversion." },
  { name: "MACD Momentum", blurb: "EMA cross + RSI filter", style: "momentum",
    prompt: "Enter long when EMA(12) crosses above EMA(26) and RSI is above 50. Exit when EMA(12) crosses back below EMA(26). Universe: GOOGL, AMZN, META, MSFT. Style: momentum." },
  { name: "Crypto Momentum", blurb: "BTC/ETH trend riding", style: "momentum",
    prompt: "Momentum: enter BTC-USD and ETH-USD when price is above SMA(50) and RSI is between 50 and 70. Exit when RSI exceeds 80 or price drops below SMA(50). Style: momentum." },
];


const TIER_LIMITS = { free: 2, pro: 20, elite: 999 } as const;

type Tier = keyof typeof TIER_LIMITS;
type ExecMode = "off" | "paper" | "live";

type Strategy = {
  id: string;
  name: string;
  description: string | null;
  strategy_json: {
    indicators?: Array<{ name: string; params?: Record<string, number> }>;
    entry?: { conditions: string[]; logic: "AND" | "OR" };
    exit?:  { conditions: string[]; logic: "AND" | "OR" };
    timeframes?: string[];
    universe?: string[];
    style?: string;
  };
  market_type: "stocks" | "crypto" | "both";
  risk_level: "low" | "medium" | "high";
  execution_mode: ExecMode;
  active: boolean;
  source: string;
  style?: string | null;
  explanation?: string | null;
  created_at: string;
};


const EXAMPLES = [
  "Momentum breakout on liquid tech stocks using RSI above 60 and price above 20-day EMA",
  "Mean reversion on oversold large-cap crypto using RSI under 25 on the 4h timeframe",
  "MACD bullish crossover with volume confirmation, exit on RSI > 75",
];

export function StrategiesPanel() {
  const { tier, hasElite } = useProfile();
  const qc = useQueryClient();
  const generateFn = useServerFn(generateStrategyFromPrompt);
  const [prompt, setPrompt] = useState("");

  const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.free;

  const strategiesQ = useQuery({
    queryKey: ["strategies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("strategies").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Strategy[];
    },
  });

  const strategies = strategiesQ.data ?? [];
  const atLimit = strategies.length >= limit;

  const generate = useMutation({
    mutationFn: async () => {
      if (atLimit) throw new Error(`Strategy limit reached for ${tier} tier (${limit}). Upgrade to add more.`);
      const result = await generateFn({ data: { prompt } });
      if (!result.ok) {
        const reasons: Record<string, string> = {
          rate_limited: "AI rate limit hit. Try again in a moment.",
          credits_exhausted: "AI credits exhausted. Add credits in workspace billing.",
          missing_lovable_api_key: "AI gateway not configured.",
          parse_failed: "AI returned malformed JSON. Try rephrasing.",
          invalid_shape: "AI response missing required fields. Try a clearer prompt.",
        };
        throw new Error(reasons[result.reason] ?? `AI error: ${result.reason}`);
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("strategies").insert({
        user_id: user.id,
        name: result.name,
        description: result.description,
        strategy_json: result.strategy_json,
        market_type: result.market_type,
        risk_level: result.risk_level,
        execution_mode: "off" as ExecMode,
        active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Strategy created");
      setPrompt("");
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["trading-counts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setMode = useMutation({
    mutationFn: async ({ id, mode }: { id: string; mode: ExecMode }) => {
      if (mode === "live" && !hasElite) {
        throw new Error("Live execution requires Elite tier.");
      }
      const { error } = await supabase.from("strategies").update({ execution_mode: mode }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("strategies").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("strategies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Strategy deleted");
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["trading-counts"] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Builder */}
      <Card className="p-5 border-border bg-card">
        <header className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Build a Strategy with AI
          </h2>
          <Badge variant="outline" className="font-mono text-[10px]">
            {strategies.length}/{limit === 999 ? "∞" : limit} used
          </Badge>
        </header>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your strategy in plain English..."
          className="min-h-[88px] bg-background border-border resize-none"
          maxLength={800}
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setPrompt(ex)}
              className="text-[10px] px-2 py-1 rounded-full bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70 transition"
            >
              {ex.slice(0, 60)}…
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-[10px] text-muted-foreground font-mono">{prompt.length}/800</span>
          <Button
            size="sm"
            onClick={() => generate.mutate()}
            disabled={generate.isPending || prompt.trim().length < 8 || atLimit}
          >
            {generate.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Brain className="h-3.5 w-3.5 mr-1.5" />}
            Generate
          </Button>
        </div>
        {atLimit && (
          <p className="mt-3 text-xs text-muted-foreground">
            You've hit your {tier} tier limit. Delete a strategy or upgrade for more slots.
          </p>
        )}
      </Card>

      {/* List */}
      <section aria-labelledby="strategy-list" className="space-y-3">
        <h2 id="strategy-list" className="font-display font-semibold">Your Strategies</h2>
        {strategiesQ.isLoading && <Card className="p-6 text-center text-sm text-muted-foreground bg-card border-border">Loading…</Card>}
        {!strategiesQ.isLoading && strategies.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground bg-card border-border">
            No strategies yet. Describe one above and the AI will build the rules.
          </Card>
        )}
        <AnimatePresence initial={false}>
          {strategies.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -10 }}
              transition={{ delay: i * 0.03 }}
            >
              <StrategyCard
                strategy={s}
                tier={(tier as Tier) ?? "free"}
                onModeChange={(mode) => setMode.mutate({ id: s.id, mode })}
                onToggleActive={() => toggleActive.mutate({ id: s.id, active: !s.active })}
                onDelete={() => remove.mutate(s.id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </section>
    </div>
  );
}

function StrategyCard({
  strategy: s, tier, onModeChange, onToggleActive, onDelete,
}: {
  strategy: Strategy;
  tier: Tier;
  onModeChange: (m: ExecMode) => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const liveLocked = tier !== "elite";
  const sj = s.strategy_json ?? {};
  const entry = sj.entry?.conditions ?? [];
  const exit = sj.exit?.conditions ?? [];
  const indicators = sj.indicators ?? [];
  const universe = sj.universe ?? [];

  return (
    <Card className="p-4 border-border bg-card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-display font-semibold truncate">{s.name}</h3>
            {s.source === "ai_lab" ? (
              <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/30 text-[10px] font-mono">
                <Sparkles className="h-2.5 w-2.5 mr-1" />AI Lab
              </Badge>
            ) : (
              <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px] font-mono">
                <User className="h-2.5 w-2.5 mr-1" />Yours
              </Badge>
            )}
            <Badge variant="outline" className="text-[9px] font-mono uppercase">{s.market_type}</Badge>
            <Badge
              variant="outline"
              className={cn("text-[9px] font-mono uppercase",
                s.risk_level === "low" && "border-bull/40 text-bull",
                s.risk_level === "high" && "border-bear/40 text-bear",
              )}
            >
              {s.risk_level} risk
            </Badge>
            {!s.active && <Badge variant="outline" className="text-[9px] font-mono">PAUSED</Badge>}
          </div>
          {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
          {s.source === "ai_lab" && (
            <p className="text-[10px] italic text-muted-foreground/70 mt-1">Auto-generated by AI Lab</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onToggleActive} title={s.active ? "Pause" : "Activate"}>
            {s.active ? <PauseCircle className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} title="Delete">
            <Trash2 className="h-4 w-4 text-bear" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Entry ({sj.entry?.logic ?? "AND"})</div>
          <ul className="space-y-0.5 font-mono">
            {entry.map((c, i) => <li key={i} className="text-bull">↑ {c}</li>)}
            {entry.length === 0 && <li className="text-muted-foreground">none</li>}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Exit ({sj.exit?.logic ?? "OR"})</div>
          <ul className="space-y-0.5 font-mono">
            {exit.map((c, i) => <li key={i} className="text-bear">↓ {c}</li>)}
            {exit.length === 0 && <li className="text-muted-foreground">none</li>}
          </ul>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap text-[10px] font-mono">
        {indicators.map((ind, i) => (
          <span key={i} className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{ind.name}</span>
        ))}
        {universe.length > 0 && <span className="text-muted-foreground">·</span>}
        {universe.map((u) => (
          <span key={u} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary">{u}</span>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Execution</span>
          <Select value={s.execution_mode} onValueChange={(v) => onModeChange(v as ExecMode)}>
            <SelectTrigger className="h-7 w-[120px] text-xs font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">OFF</SelectItem>
              <SelectItem value="paper">PAPER</SelectItem>
              <SelectItem value="live" disabled={liveLocked}>
                <span className="flex items-center gap-1">LIVE {liveLocked && <Lock className="h-3 w-3" />}</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <span className={cn("text-[10px] font-mono uppercase",
          s.execution_mode === "live" && "text-bear",
          s.execution_mode === "paper" && "text-primary",
          s.execution_mode === "off" && "text-muted-foreground",
        )}>
          {s.execution_mode === "live" ? "● LIVE TRADING" : s.execution_mode === "paper" ? "● PAPER MODE" : "○ DISABLED"}
        </span>
      </div>
    </Card>
  );
}
