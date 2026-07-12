import { LoadingState, ErrorState } from "@/components/StateViews";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CheckCircle, XCircle, Clock, Target, BarChart3, AlertTriangle, ChevronDown, ChevronUp, Zap, Timer,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ZAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import { useProfile } from "@/hooks/use-profile";
import { PremiumLock } from "@/components/PremiumLock";

type HistoricalSignal = {
  id: string;
  asset: string;
  signal_type: "options_flow" | "buy_sell";
  direction: "call" | "put" | "buy" | "sell";
  confidence: number | null;
  entry_price: number | null;
  target_price: number | null;
  stop_price: number | null;
  result: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_pnl_pct: number | null;
  thesis: string | null;
};

type ResultTab = "all" | "win" | "loss" | "pending" | "stale";
type AssetTab = "all" | "stocks" | "crypto" | "options";

const CRYPTO_RE = /^(BTC|ETH|SOL|DOGE|ADA|XRP|AVAX|MATIC|BCH|DOT|LINK|SHIB|LTC|UNI|ATOM|BNB)/i;

type Aggregates = { total: number; wins: number; losses: number; stale: number; pending: number };

export function SignalHistoryPanel() {
  const { hasPro } = useProfile();
  const [signals, setSignals] = useState<HistoricalSignal[]>([]);
  const [agg, setAgg] = useState<Aggregates>({ total: 0, wins: 0, losses: 0, stale: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ResultTab>("all");
  const [assetFilter, setAssetFilter] = useState<AssetTab>("all");
  const [staleAsLoss, setStaleAsLoss] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPro) return;
    let cancelled = false;

    const applyAsset = (rows: HistoricalSignal[]) => {
      if (assetFilter === "crypto") return rows.filter((r) => CRYPTO_RE.test(r.asset));
      if (assetFilter === "stocks") return rows.filter((r) => !CRYPTO_RE.test(r.asset) && r.signal_type !== "options_flow");
      if (assetFilter === "options") return rows.filter((r) => r.signal_type === "options_flow");
      return rows;
    };

    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("market_signals")
        .select("id, asset, signal_type, direction, confidence, entry_price, target_price, stop_price, result, created_at, resolved_at, resolved_pnl_pct, thesis")
        .order("created_at", { ascending: false })
        .limit(300);
      if (cancelled) return;
      const rows = applyAsset((data ?? []) as HistoricalSignal[]);
      setSignals(rows.slice(0, 100));

      const total = rows.length;
      const wins = rows.filter((r) => r.result === "hit_target").length;
      const losses = rows.filter((r) => r.result === "hit_stop").length;
      const stale = rows.filter((r) => r.result === "stale" || r.result === "expired").length;
      const pending = rows.filter((r) => !r.result || r.result === "open").length;
      setAgg({ total, wins, losses, stale, pending });
      setLoading(false);
    };

    load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [hasPro, assetFilter]);

  const filtered = signals.filter((s) => {
    if (filter === "all") return true;
    if (filter === "win") return s.result === "hit_target";
    if (filter === "loss") return s.result === "hit_stop";
    if (filter === "stale") return s.result === "stale" || s.result === "expired";
    return !s.result || s.result === "open";
  });

  const outcomeSummary = useMemo(() => {
    const resolved = signals.filter((s) => ["hit_target", "hit_stop", "stale", "expired"].includes(s.result ?? ""));
    const wins = resolved.filter((s) => s.result === "hit_target").length;
    const stops = resolved.filter((s) => s.result === "hit_stop").length;
    const staleCount = resolved.filter((s) => s.result === "stale" || s.result === "expired").length;
    const staleRate = resolved.length > 0 ? (staleCount / resolved.length) * 100 : 0;
    const withDur = resolved.filter((s) => s.resolved_at);
    const avgHours = withDur.length > 0
      ? withDur.reduce((sum, s) => sum + (new Date(s.resolved_at!).getTime() - new Date(s.created_at).getTime()) / 3600000, 0) / withDur.length
      : 0;
    const totalEv = resolved.reduce((sum, s) => sum + (s.resolved_pnl_pct ?? 0), 0);
    return { wins, stops, staleCount, staleRate, avgHours, totalEv, resolvedCount: resolved.length };
  }, [signals]);

  const effectiveLosses = agg.losses + (staleAsLoss ? agg.stale : 0);
  const resolvedDenom = agg.wins + effectiveLosses;
  const winRate = resolvedDenom > 0 ? (agg.wins / resolvedDenom) * 100 : 0;

  // Calibration buckets
  const calibration = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({ conf: i * 10 + 5, hit: 0, n: 0 }));
    for (const r of signals) {
      if (r.confidence == null || !["hit_target", "hit_stop"].includes(r.result ?? "")) continue;
      const i = Math.min(9, Math.floor(Number(r.confidence) / 10));
      buckets[i].n++;
      if (r.result === "hit_target") buckets[i].hit++;
    }
    return buckets.filter((b) => b.n > 0).map((b) => ({ predicted: b.conf, actual: (b.hit / b.n) * 100, n: b.n }));
  }, [signals]);

  if (!hasPro) {
    return (
      <PremiumLock
        requiredTier="pro"
        title="Signal History"
        description="Review historical AI signal performance, calibration, and P&L. Included with Pro."
        perks={["Full outcome history (hit target / stopped out)", "Confidence calibration chart", "P&L attribution per signal"]}
      />
    );
  }

  const summaryCards = [
    { icon: BarChart3, label: "Total Signals", value: agg.total.toLocaleString(), color: "text-primary" },
    {
      icon: Target,
      label: "Win Rate",
      value: `${winRate.toFixed(1)}%`,
      sub: `${agg.wins} / ${resolvedDenom} resolved`,
      color: winRate >= 50 ? "text-bull" : "text-bear",
    },
    { icon: CheckCircle, label: "Wins", value: agg.wins.toLocaleString(), color: "text-bull" },
    {
      icon: XCircle,
      label: "Losses",
      value: effectiveLosses.toLocaleString(),
      sub: staleAsLoss ? `${agg.losses} stop + ${agg.stale} stale` : undefined,
      color: "text-bear",
    },
    { icon: Clock, label: "Pending", value: agg.pending.toLocaleString(), color: "text-muted-foreground" },
    { icon: AlertTriangle, label: "Stale", value: agg.stale.toLocaleString(), color: "text-yellow-500" },
  ];

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map((s) => (
          <Card key={s.label} className="p-3 border-border bg-card">
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider flex items-center gap-1 mb-0.5">
              <s.icon className="w-3 h-3" /> {s.label}
            </div>
            <div className={cn("text-lg font-num font-bold", s.color)}>{s.value}</div>
            {s.sub && <div className="text-[9px] text-muted-foreground mt-0.5">{s.sub}</div>}
          </Card>
        ))}
      </div>

      {/* Stale toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] text-muted-foreground">
        <div>
          All-time stats{assetFilter !== "all" && <> · filtered to <span className="text-foreground font-semibold capitalize">{assetFilter}</span></>}. List shows most recent 100.
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={staleAsLoss} onChange={(e) => setStaleAsLoss(e.target.checked)} className="accent-primary" />
          Count stale as loss
        </label>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-secondary rounded-lg p-0.5">
          {(["all", "win", "loss", "stale", "pending"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all",
                filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex bg-secondary rounded-lg p-0.5">
          {(["all", "stocks", "crypto", "options"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setAssetFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all",
                assetFilter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Compact Outcome Summary */}
      {outcomeSummary.resolvedCount > 0 && (
        <div className="flex items-center gap-4 flex-wrap bg-secondary/40 rounded-lg border border-border px-3 py-2">
          <SummaryPill icon={CheckCircle} color="text-bull" label="Wins" value={outcomeSummary.wins.toString()} />
          <SummaryPill icon={XCircle} color="text-bear" label="Stop-outs" value={outcomeSummary.stops.toString()} />
          <SummaryPill icon={AlertTriangle} color="text-yellow-500" label="Stale rate" value={`${outcomeSummary.staleRate.toFixed(1)}%`} />
          <SummaryPill icon={Timer} color="text-muted-foreground" label="Avg resolve" value={`${outcomeSummary.avgHours.toFixed(1)}h`} />
          <SummaryPill
            icon={Zap}
            color="text-primary"
            label="Total EV"
            value={`${outcomeSummary.totalEv >= 0 ? "+" : ""}${outcomeSummary.totalEv.toFixed(1)}%`}
            valueColor={outcomeSummary.totalEv >= 0 ? "text-bull" : "text-bear"}
          />
        </div>
      )}

      {/* List + Calibration side-by-side on large screens */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-2">
          {loading && signals.length === 0 ? (
            [1, 2, 3].map((i) => <div key={i} className="h-16 bg-card rounded-lg animate-pulse border border-border" />)
          ) : filtered.length === 0 ? (
            <Card className="p-10 text-center border-border bg-card text-sm text-muted-foreground">No signals found for this filter.</Card>
          ) : (
            filtered.map((s) => {
              const isExpanded = expandedId === s.id;
              const canExpand = !!s.result && s.result !== "open";
              const bull = s.direction === "call" || s.direction === "buy";
              return (
                <Card key={s.id} className="border-border bg-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => canExpand && setExpandedId(isExpanded ? null : s.id)}
                    disabled={!canExpand}
                    className={cn("w-full p-4 flex items-center justify-between gap-4 text-left", canExpand && "hover:bg-secondary/40 cursor-pointer")}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                        s.result === "hit_target" ? "bg-bull/15 text-bull" :
                          s.result === "hit_stop" ? "bg-bear/15 text-bear" :
                            s.result === "stale" || s.result === "expired" ? "bg-yellow-500/15 text-yellow-500" :
                              "bg-muted text-muted-foreground",
                      )}>
                        {s.result === "hit_target" ? <CheckCircle className="w-4 h-4" /> :
                          s.result === "hit_stop" ? <XCircle className="w-4 h-4" /> :
                            s.result === "stale" || s.result === "expired" ? <AlertTriangle className="w-4 h-4" /> :
                              <Clock className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-display font-semibold flex items-center gap-2 flex-wrap">
                          {s.asset}
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-num uppercase", bull ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear")}>
                            {s.direction}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{s.signal_type}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground flex gap-3 mt-0.5 font-num flex-wrap">
                          {s.entry_price != null && <span>Entry ${Number(s.entry_price).toFixed(2)}</span>}
                          {s.target_price != null && <span>Target ${Number(s.target_price).toFixed(2)}</span>}
                          {s.confidence != null && <span>Conf {Number(s.confidence).toFixed(0)}%</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className={cn(
                          "text-xs font-semibold",
                          s.result === "hit_target" ? "text-bull" :
                            s.result === "hit_stop" ? "text-bear" :
                              s.result === "stale" || s.result === "expired" ? "text-yellow-500" :
                                "text-muted-foreground",
                        )}>
                          {s.result ? s.result.toUpperCase().replace("_", " ") : "PENDING"}
                          {s.resolved_pnl_pct != null && (
                            <span className="ml-2 font-num">{Number(s.resolved_pnl_pct) >= 0 ? "+" : ""}{Number(s.resolved_pnl_pct).toFixed(1)}%</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</div>
                      </div>
                      {canExpand && (isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />)}
                    </div>
                  </button>
                  {isExpanded && canExpand && (
                    <div className="px-4 pb-4 -mt-1 border-t border-border pt-3 space-y-2 text-xs">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-num">
                        <Kv label="Entry" value={s.entry_price != null ? `$${Number(s.entry_price).toFixed(2)}` : "—"} />
                        <Kv label="Target" value={s.target_price != null ? `$${Number(s.target_price).toFixed(2)}` : "—"} />
                        <Kv label="Stop" value={s.stop_price != null ? `$${Number(s.stop_price).toFixed(2)}` : "—"} />
                        <Kv label="P&L" value={s.resolved_pnl_pct != null ? `${Number(s.resolved_pnl_pct) >= 0 ? "+" : ""}${Number(s.resolved_pnl_pct).toFixed(1)}%` : "—"} />
                      </div>
                      {s.thesis && <p className="text-muted-foreground leading-relaxed">{s.thesis}</p>}
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>

        <Card className="p-4 border-border bg-card">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Calibration: predicted vs actual</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 20 }}>
                <CartesianGrid strokeOpacity={0.1} />
                <XAxis type="number" dataKey="predicted" name="Predicted" domain={[0, 100]} unit="%" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis type="number" dataKey="actual" name="Actual" domain={[0, 100]} unit="%" stroke="var(--muted-foreground)" fontSize={11} />
                <ZAxis type="number" dataKey="n" range={[60, 220]} name="N" />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Scatter data={calibration} fill="oklch(0.78 0.17 165)" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">Dots on the diagonal = well-calibrated confidence.</p>
        </Card>
      </div>
    </div>
  );
}

function SummaryPill({ icon: Icon, color, label, value, valueColor }: { icon: typeof CheckCircle; color: string; label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <Icon className={cn("w-3 h-3", color)} />
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-num font-semibold", valueColor ?? "text-foreground")}>{value}</span>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div>{value}</div>
    </div>
  );
}
