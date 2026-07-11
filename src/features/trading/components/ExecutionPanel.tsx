import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Zap, X, TrendingUp, TrendingDown, Loader2, Bot, ChevronDown, ChevronRight, BookOpen, Gauge, LayoutGrid, List, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { openPaperTrade, closePaperTrade } from "@/lib/execution.functions";
import { getStockQuotes, getCryptoQuotes } from "@/lib/market.functions";
import { estimateOptionValue } from "@/lib/indicators";

const CRYPTO_ID: Record<string, string> = {
  "BTC-USD": "bitcoin", "ETH-USD": "ethereum", "SOL-USD": "solana",
};
function isCrypto(sym: string): boolean {
  return /[-/]USD[T]?$/i.test(sym) || Object.prototype.hasOwnProperty.call(CRYPTO_ID, sym.toUpperCase());
}
function isOption(instrument: string | null | undefined): boolean {
  const s = String(instrument ?? "").toLowerCase();
  return s.includes("call") || s.includes("put") || s.includes("spread") || s.includes("condor");
}
function optionType(instrument: string): "call" | "put" {
  return String(instrument).toLowerCase().includes("put") ? "put" : "call";
}

export function ExecutionPanel() {
  const { userId, tier } = useProfile();
  const qc = useQueryClient();
  const open = useServerFn(openPaperTrade);
  const close = useServerFn(closePaperTrade);

  const [asset, setAsset] = useState("AAPL");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [alloc, setAlloc] = useState(10);
  const [strategyId, setStrategyId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);

  const strategies = useQuery({
    queryKey: ["strategies-list", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("strategies").select("id,name").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const openTrades = useQuery({
    queryKey: ["open-trades", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paper_trades").select("*").eq("is_open", true).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  async function submit() {
    setSubmitting(true);
    try {
      const res = await open({ data: { asset, side, allocation_pct: alloc, strategy_id: strategyId || undefined } });
      if (!res.ok) toast.error(`Blocked: ${res.reason}`);
      else {
        toast.success(`Opened ${side.toUpperCase()} ${asset} @ $${res.price.toFixed(2)}`);
        qc.invalidateQueries({ queryKey: ["open-trades", userId] });
        qc.invalidateQueries({ queryKey: ["paper-trades", userId] });
        qc.invalidateQueries({ queryKey: ["paper-portfolio", userId] });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function closeTrade(id: string) {
    setClosing(id);
    try {
      const res = await close({ data: { trade_id: id } });
      if (!res.ok) toast.error(`Close failed: ${res.reason}`);
      else {
        toast.success(`Closed @ $${res.price.toFixed(2)}`);
        qc.invalidateQueries({ queryKey: ["open-trades", userId] });
        qc.invalidateQueries({ queryKey: ["paper-trades", userId] });
        qc.invalidateQueries({ queryKey: ["paper-portfolio", userId] });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setClosing(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5 border-border bg-card">
        <header className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Paper Execution
          </h2>
          <Badge variant="outline" className="font-mono text-[10px] border-primary/40 text-primary">PAPER MODE</Badge>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Asset</Label>
            <Input value={asset} onChange={(e) => setAsset(e.target.value.toUpperCase())} className="font-mono uppercase" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Side</Label>
            <Select value={side} onValueChange={(v) => setSide(v as "buy" | "sell")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="buy">BUY (long)</SelectItem>
                <SelectItem value="sell">SELL (short)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Allocation %</Label>
            <Input type="number" min={1} max={100} value={alloc} onChange={(e) => setAlloc(Number(e.target.value))} className="font-mono" />
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <Label className="text-xs">Strategy (optional)</Label>
            <Select value={strategyId || "none"} onValueChange={(v) => setStrategyId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {strategies.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={submit} disabled={submitting || !asset} className="w-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{side === "buy" ? <TrendingUp className="h-4 w-4 mr-1" /> : <TrendingDown className="h-4 w-4 mr-1" />}Execute</>}
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Risk engine validates position size, cooldown, and daily loss cap before filling. Live broker execution {tier === "elite" ? "available — connect a broker in settings." : "requires Elite tier."}
        </p>
      </Card>

      <OpenPositionsCard
        trades={openTrades.data ?? []}
        closing={closing}
        onClose={closeTrade}
      />


      <SlippageTracker userId={userId} />

      <TradeJournal userId={userId} />
    </div>
  );
}

type OpenTrade = {
  id: string;
  asset: string;
  side: string;
  quantity: number | string;
  entry_price: number | string;
  instrument: string;
  options_details: unknown;
};

function OpenPositionsCard({
  trades, closing, onClose,
}: {
  trades: OpenTrade[];
  closing: string | null;
  onClose: (id: string) => void;
}) {
  const stockSymbols = Array.from(new Set(trades.map((t) => t.asset).filter((s) => !isCrypto(s))));
  const cryptoIds = Array.from(
    new Set(trades.map((t) => CRYPTO_ID[t.asset.toUpperCase()]).filter(Boolean)),
  ) as string[];

  const stockFn = useServerFn(getStockQuotes);
  const cryptoFn = useServerFn(getCryptoQuotes);

  const stockQuotes = useQuery({
    queryKey: ["exec-stock-quotes", stockSymbols],
    enabled: stockSymbols.length > 0,
    refetchInterval: 15_000,
    queryFn: () => stockFn({ data: { symbols: stockSymbols } }),
  });
  const cryptoQuotes = useQuery({
    queryKey: ["exec-crypto-quotes", cryptoIds],
    enabled: cryptoIds.length > 0,
    refetchInterval: 15_000,
    queryFn: () => cryptoFn({ data: { ids: cryptoIds } }),
  });

  function priceFor(sym: string): number | null {
    if (isCrypto(sym)) {
      const id = CRYPTO_ID[sym.toUpperCase()];
      const q = (cryptoQuotes.data as Record<string, { price?: number }> | undefined)?.[id];
      return q?.price ?? null;
    }
    const s = (stockQuotes.data as Array<{ symbol: string; price?: number }> | undefined)
      ?.find((x) => x.symbol === sym);
    return s?.price ?? null;
  }

  let totalCost = 0;
  let totalValue = 0;
  const rows = trades.map((t) => {
    const qty = Number(t.quantity);
    const entry = Number(t.entry_price);
    const cost = qty * entry;
    let current: number | null = null;
    let theta: number | null = null;

    if (isOption(t.instrument) && t.options_details && typeof t.options_details === "object") {
      const od = t.options_details as Record<string, unknown>;
      const strike = Number(od.strike ?? 0);
      const expiry = od.expiry ? new Date(String(od.expiry)).getTime() : null;
      const iv = Number(od.iv ?? od.implied_vol ?? 0.4);
      const under = priceFor(t.asset);
      const dte = expiry ? Math.max(0, (expiry - Date.now()) / 86_400_000) : 30;
      if (under && strike > 0) {
        const perShare = estimateOptionValue({
          underlying_price: under, strike, days_to_expiry: dte,
          implied_vol: iv, risk_free_rate: 0.045,
          option_type: optionType(t.instrument),
        });
        current = perShare * 100 * qty;
        const tomorrow = estimateOptionValue({
          underlying_price: under, strike, days_to_expiry: Math.max(0, dte - 1),
          implied_vol: iv, risk_free_rate: 0.045,
          option_type: optionType(t.instrument),
        });
        theta = (tomorrow - perShare) * 100 * qty;
      }
    } else {
      const p = priceFor(t.asset);
      if (p != null) current = qty * p;
    }

    const unreal = current != null ? current - cost : null;
    const unrealPct = current != null && cost > 0 ? (unreal! / cost) * 100 : null;
    totalCost += cost;
    if (current != null) totalValue += current;
    return { t, qty, entry, cost, current, unreal, unrealPct, theta };
  });

  const totalUnreal = totalValue > 0 ? totalValue - totalCost : 0;
  const totalPct = totalCost > 0 ? (totalUnreal / totalCost) * 100 : 0;
  const isLive = stockQuotes.isFetching || cryptoQuotes.isFetching;

  const [heatMap, setHeatMap] = useState(false);
  function explain(r: (typeof rows)[number]) {
    window.dispatchEvent(new CustomEvent("explain-trade", { detail: {
      id: r.t.id, asset: r.t.asset, side: r.t.side, quantity: r.qty,
      entry: r.entry, current: r.current, unreal: r.unreal, unrealPct: r.unrealPct,
      instrument: r.t.instrument,
    } }));
    toast.message("Sent to Agent Chat", { description: `Explaining ${r.t.side.toUpperCase()} ${r.t.asset}` });
  }

  return (
    <Card className="border-border bg-card">
      <header className="px-5 py-4 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-display font-semibold">Open Positions ({trades.length})</h2>
          {trades.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", isLive ? "bg-primary animate-pulse" : "bg-bull")} />
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {trades.length > 0 && (
            <div className="flex items-center rounded border border-border p-0.5">
              <button
                onClick={() => setHeatMap(false)}
                className={cn("p-1 rounded-sm", !heatMap ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                aria-label="List view"
              ><List className="h-3 w-3" /></button>
              <button
                onClick={() => setHeatMap(true)}
                className={cn("p-1 rounded-sm", heatMap ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                aria-label="Heat map"
              ><LayoutGrid className="h-3 w-3" /></button>
            </div>
          )}
          {trades.length > 0 && (
            <div className="text-right">
              <div className={cn("text-sm font-mono font-semibold", totalUnreal >= 0 ? "text-bull" : "text-bear")}>
                {totalUnreal >= 0 ? "+" : ""}${totalUnreal.toFixed(2)} ({totalPct >= 0 ? "+" : ""}{totalPct.toFixed(2)}%)
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">unrealized</div>
            </div>
          )}
        </div>
      </header>
      {trades.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground text-sm space-y-3">
          <p>No open paper positions.</p>
          <p className="text-xs">
            Your active strategies will automatically open positions every 5 minutes when their entry conditions are met.
          </p>
          <a href="/trading?tab=strategies" className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-medium">
            Go to Strategies →
          </a>
        </div>
      ) : heatMap ? (
        <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {rows.map((r) => {
            const pct = r.unrealPct;
            const bg = pct == null ? "hsl(var(--muted) / 0.4)"
              : `hsl(var(--${pct >= 0 ? "bull" : "bear"}) / ${(0.15 + Math.min(1, Math.abs(Math.max(-10, Math.min(10, pct))) / 10) * 0.55).toFixed(2)})`;
            return (
              <button
                key={r.t.id}
                onClick={() => explain(r)}
                style={{ background: bg }}
                className="rounded-md border border-border/60 p-3 text-left transition hover:scale-[1.02]"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-display font-semibold text-sm truncate">{r.t.asset}</span>
                  <span className="text-[10px] font-mono uppercase text-muted-foreground">{r.t.side}</span>
                </div>
                <div className={cn("font-mono text-base font-semibold mt-1", (pct ?? 0) >= 0 ? "text-bull" : "text-bear")}>
                  {pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {r.unreal == null ? "—" : `${r.unreal >= 0 ? "+" : ""}$${r.unreal.toFixed(2)}`}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          <TooltipProvider>
            {rows.map((r, i) => (
              <motion.li
                key={r.t.id}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded font-mono",
                    r.t.side === "buy" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear",
                  )}>{r.t.side}</span>
                  <span className="font-display font-semibold">{r.t.asset}</span>
                  {isOption(r.t.instrument) && (
                    <Badge variant="outline" className="text-[10px] uppercase border-primary/40 text-primary">
                      {r.t.instrument}
                    </Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {r.qty.toFixed(4)} @ ${r.entry.toFixed(2)}
                  </span>
                  {r.theta != null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="text-[10px] font-mono border-bear/30 text-bear cursor-help">
                          θ {r.theta >= 0 ? "+" : ""}${r.theta.toFixed(2)}/d
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs">Estimated time-decay per day (Black-Scholes)</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    {r.current != null ? (
                      <>
                        <div className={cn("text-sm font-mono font-semibold",
                          r.unreal! >= 0 ? "text-bull" : "text-bear")}>
                          {r.unreal! >= 0 ? "+" : ""}${r.unreal!.toFixed(2)}
                        </div>
                        <div className={cn("text-[10px] font-mono",
                          r.unrealPct! >= 0 ? "text-bull" : "text-bear")}>
                          {r.unrealPct! >= 0 ? "+" : ""}{r.unrealPct!.toFixed(2)}%
                        </div>
                      </>
                    ) : (
                      <div className="text-[10px] text-muted-foreground font-mono">—</div>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => explain(r)} title="Explain this trade">
                    <HelpCircle className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => onClose(r.t.id)}
                    disabled={closing === r.t.id}
                  >
                    {closing === r.t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><X className="h-3 w-3 mr-1" />Close</>}
                  </Button>
                </div>
              </motion.li>
            ))}
          </TooltipProvider>
        </ul>
      )}
    </Card>
  );
}


function TradeJournal({ userId }: { userId: string | null }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const journal = useQuery({
    queryKey: ["trade-journal", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signals_executions")
        .select("id, created_at, asset, side, quantity, price, execution_type, status, reason")
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });
  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  return (
    <Card className="border-border bg-card">
      <header className="px-5 py-4 border-b border-border flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-primary" />
        <h2 className="font-display font-semibold">Trade Journal</h2>
        <span className="text-xs text-muted-foreground">last {journal.data?.length ?? 0}</span>
      </header>
      {(journal.data?.length ?? 0) === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          Nothing yet. The autonomous engine logs every entry, exit, and retirement here.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {journal.data!.map((r) => {
            const reason = String(r.reason ?? "");
            const auto = reason.includes("auto_entry") ? "entry" : reason.includes("auto_exit") ? "exit" : reason.includes("auto_retired") ? "retired" : null;
            const isOpen = expanded.has(r.id);
            const parts = reason.split(/\s+/).filter(Boolean);
            return (
              <li key={r.id} className="px-5 py-2.5 text-xs">
                <button onClick={() => toggle(r.id)} className="w-full flex items-center gap-2 text-left">
                  {isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                  {auto === "entry" && <Bot className="h-3.5 w-3.5 text-bull shrink-0" />}
                  {auto === "exit" && <Bot className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                  {auto === "retired" && <Bot className="h-3.5 w-3.5 text-bear shrink-0" />}
                  <span className="font-mono text-muted-foreground shrink-0 w-32 truncate">
                    {new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="font-display font-semibold shrink-0 w-16 truncate">{r.asset}</span>
                  <span className={cn(
                    "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded font-mono shrink-0",
                    r.side === "buy" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear",
                  )}>{r.side}</span>
                  <span className="font-mono shrink-0 hidden sm:inline">{Number(r.quantity).toFixed(4)}</span>
                  <span className="font-mono shrink-0 hidden sm:inline">${Number(r.price).toFixed(2)}</span>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground shrink-0">{r.execution_type}</span>
                  <span className={cn(
                    "text-[10px] uppercase font-mono px-1.5 py-0.5 rounded shrink-0 ml-auto",
                    r.status === "filled" ? "bg-bull/15 text-bull" : r.status === "cancelled" ? "bg-bear/15 text-bear" : "bg-muted text-muted-foreground",
                  )}>{r.status}</span>
                </button>
                {isOpen && reason && (
                  <div className="mt-2 ml-5 pl-3 border-l-2 border-border text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                    {parts.map((p, i) => {
                      const isKV = /^[a-z_]+=/i.test(p);
                      return isKV ? (
                        <span key={i}><strong className="text-foreground font-mono">{p}</strong></span>
                      ) : (
                        <span key={i}>{p}</span>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function SlippageTracker({ userId }: { userId: string | null }) {
  const q = useQuery({
    queryKey: ["slippage-tracker", userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [tradesRes, signalsRes] = await Promise.all([
        supabase
          .from("paper_trades")
          .select("id, asset, side, strategy_id, entry_price, created_at")
          .not("strategy_id", "is", null)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("market_signals")
          .select("asset, direction, entry_price, user_id, created_at")
          .not("entry_price", "is", null)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (tradesRes.error) throw tradesRes.error;
      if (signalsRes.error) throw signalsRes.error;
      const signals = signalsRes.data ?? [];
      // Match each trade to the most recent same-asset signal within 6h before the fill.
      const window = 6 * 3_600_000;
      const rows = (tradesRes.data ?? [])
        .map((t) => {
          const tt = new Date(t.created_at).getTime();
          const candidates = signals.filter((s) => {
            if (s.asset !== t.asset || s.entry_price == null) return false;
            const st = new Date(s.created_at).getTime();
            return st <= tt && tt - st <= window;
          });
          if (candidates.length === 0) return null;
          const signal = candidates[0]; // most recent (list is desc)
          const expected = Number(signal.entry_price);
          const actual = Number(t.entry_price);
          if (!expected || !actual) return null;
          // Slippage as basis points relative to expected. Positive = worse for the trader.
          const raw = ((actual - expected) / expected) * 10000;
          const bps = t.side === "buy" ? raw : -raw;
          return { id: t.id, asset: t.asset, side: t.side, expected, actual, bps, at: t.created_at };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      return rows;
    },
  });

  const rows = q.data ?? [];
  const avgBps = rows.length ? rows.reduce((a, r) => a + r.bps, 0) / rows.length : 0;
  const worst = rows.length ? rows.reduce((m, r) => (r.bps > m.bps ? r : m), rows[0]) : null;
  const best = rows.length ? rows.reduce((m, r) => (r.bps < m.bps ? r : m), rows[0]) : null;

  return (
    <Card className="border-border bg-card">
      <header className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Gauge className="h-4 w-4 text-primary" />
        <h2 className="font-display font-semibold">Slippage Tracker</h2>
        <span className="text-xs text-muted-foreground">signal → fill · last 30d</span>
      </header>
      {q.isLoading ? (
        <div className="p-6 text-center text-xs text-muted-foreground">Loading fills…</div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          No matched fills yet. Trades executed from a strategy signal will show slippage vs. the signal's entry price here.
        </div>
      ) : (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3 text-xs">
            <SlipStat label="Avg Slippage" bps={avgBps} />
            <SlipStat label="Worst Fill" bps={worst?.bps ?? 0} suffix={worst ? ` · ${worst.asset}` : ""} />
            <SlipStat label="Best Fill" bps={best?.bps ?? 0} suffix={best ? ` · ${best.asset}` : ""} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-[10px] uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2">When</th>
                  <th className="text-left py-2">Asset</th>
                  <th className="text-left py-2">Side</th>
                  <th className="text-right py-2">Signal $</th>
                  <th className="text-right py-2">Fill $</th>
                  <th className="text-right py-2">Slippage</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 25).map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 text-muted-foreground">
                      {new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-2 font-semibold">{r.asset}</td>
                    <td className={cn("py-2 uppercase text-[10px] font-bold", r.side === "buy" ? "text-bull" : "text-bear")}>{r.side}</td>
                    <td className="py-2 text-right">${r.expected.toFixed(2)}</td>
                    <td className="py-2 text-right">${r.actual.toFixed(2)}</td>
                    <td className={cn("py-2 text-right font-semibold", r.bps > 5 ? "text-bear" : r.bps < -5 ? "text-bull" : "text-muted-foreground")}>
                      {r.bps >= 0 ? "+" : ""}{r.bps.toFixed(1)} bps
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

function SlipStat({ label, bps, suffix = "" }: { label: string; bps: number; suffix?: string }) {
  const tone = bps > 5 ? "text-bear" : bps < -5 ? "text-bull" : "text-muted-foreground";
  return (
    <div className="border border-border rounded-md p-2 bg-background/40">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className={cn("font-mono text-sm font-semibold", tone)}>
        {bps >= 0 ? "+" : ""}{bps.toFixed(1)} bps<span className="text-muted-foreground text-[10px] font-normal">{suffix}</span>
      </div>
    </div>
  );
}

