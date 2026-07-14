import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { History, TrendingUp, TrendingDown, Search } from "lucide-react";
import { LoadingState, EmptyState } from "@/components/StateViews";

type Trade = {
  id: string;
  asset: string;
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  created_at: string;
  closed_at: string | null;
  rationale: string | null;
  instrument: string | null;
  hold_duration: string | null;
};

function sessionLabel(rationale: string | null): "[SCALP]" | "[SWING]" | "[CRYPTO]" | null {
  if (!rationale) return null;
  if (rationale.includes("[SCALP]")) return "[SCALP]";
  if (rationale.includes("[SWING]")) return "[SWING]";
  if (rationale.includes("[CRYPTO]")) return "[CRYPTO]";
  return null;
}

function tradePnL(t: Trade) {
  if (!t.exit_price) return null;
  const qty = Number(t.quantity);
  const entry = Number(t.entry_price);
  const exit = Number(t.exit_price);
  const dir = t.side === "buy" ? 1 : -1;
  return (exit - entry) * qty * dir;
}

function tradePnLPct(t: Trade) {
  if (!t.exit_price) return null;
  const entry = Number(t.entry_price);
  const exit = Number(t.exit_price);
  const dir = t.side === "buy" ? 1 : -1;
  return ((exit - entry) / entry) * 100 * dir;
}

export function ClosedTradesHistory() {
  const { userId } = useProfile();
  const [search, setSearch] = useState("");
  const [winFilter, setWinFilter] = useState<"all" | "win" | "loss">("all");
  const [sessionFilter, setSessionFilter] = useState<"all" | "[SCALP]" | "[SWING]" | "[CRYPTO]">("all");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const { data: trades, isLoading } = useQuery({
    queryKey: ["closed-trades-history", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("paper_trades")
        .select("id, asset, side, quantity, entry_price, exit_price, created_at, closed_at, rationale, instrument, hold_duration")
        .eq("user_id", userId!)
        .eq("is_open", false)
        .not("exit_price", "is", null)
        .order("closed_at", { ascending: false })
        .limit(1000);
      return (data ?? []) as Trade[];
    },
  });

  const filtered = useMemo(() => {
    if (!trades) return [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    return trades.filter(t => {
      const pnl = tradePnL(t);
      const date = new Date(t.closed_at ?? t.created_at);

      if (search && !t.asset.toLowerCase().includes(search.toLowerCase())) return false;
      if (winFilter === "win" && (pnl ?? 0) <= 0) return false;
      if (winFilter === "loss" && (pnl ?? 0) >= 0) return false;
      if (sessionFilter !== "all" && sessionLabel(t.rationale) !== sessionFilter) return false;
      if (dateFilter === "today" && date < todayStart) return false;
      if (dateFilter === "week" && date < weekStart) return false;
      if (dateFilter === "month" && date < monthStart) return false;
      return true;
    });
  }, [trades, search, winFilter, sessionFilter, dateFilter]);

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const totalPnL = filtered.reduce((sum, t) => sum + (tradePnL(t) ?? 0), 0);
  const wins = filtered.filter(t => (tradePnL(t) ?? 0) > 0).length;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-semibold text-sm flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          Closed Trades
          {filtered.length > 0 && (
            <span className="text-[10px] text-muted-foreground font-normal">
              {filtered.length} trade{filtered.length !== 1 ? "s" : ""}
              {" · "}
              <span className={cn("font-mono", totalPnL >= 0 ? "text-emerald-400" : "text-red-400")}>
                {totalPnL >= 0 ? "+" : ""}${Math.abs(totalPnL).toFixed(2)}
              </span>
              {filtered.length > 0 && ` · ${Math.round(wins/filtered.length*100)}% win rate`}
            </span>
          )}
        </h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[140px] max-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search asset…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Select value={dateFilter} onValueChange={v => { setDateFilter(v as typeof dateFilter); setPage(0); }}>
          <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All time</SelectItem>
            <SelectItem value="today" className="text-xs">Today</SelectItem>
            <SelectItem value="week" className="text-xs">This week</SelectItem>
            <SelectItem value="month" className="text-xs">This month</SelectItem>
          </SelectContent>
        </Select>
        <Select value={winFilter} onValueChange={v => { setWinFilter(v as typeof winFilter); setPage(0); }}>
          <SelectTrigger className="h-8 w-[90px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All</SelectItem>
            <SelectItem value="win" className="text-xs">Wins only</SelectItem>
            <SelectItem value="loss" className="text-xs">Losses only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sessionFilter} onValueChange={v => { setSessionFilter(v as typeof sessionFilter); setPage(0); }}>
          <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All types</SelectItem>
            <SelectItem value="[SCALP]" className="text-xs">Scalp</SelectItem>
            <SelectItem value="[SWING]" className="text-xs">Swing</SelectItem>
            <SelectItem value="[CRYPTO]" className="text-xs">Crypto</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border-border/60 bg-card overflow-hidden">
        {isLoading ? (
          <LoadingState message="Loading trade history…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No closed trades match your filters"
            description="The agent closes trades when they hit their target, stop, or at end of day for scalps."
          />
        ) : (
          <>
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-[80px_1fr_90px_90px_90px_80px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50 font-medium">
              <span>Date</span>
              <span>Asset</span>
              <span className="text-right">Entry</span>
              <span className="text-right">Exit</span>
              <span className="text-right">P&L $</span>
              <span className="text-right">P&L %</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-border/30">
              {paginated.map(t => {
                const pnl = tradePnL(t);
                const pnlPct = tradePnLPct(t);
                const isWin = (pnl ?? 0) > 0;
                const session = sessionLabel(t.rationale);
                const date = new Date(t.closed_at ?? t.created_at);

                return (
                  <div key={t.id} className="grid grid-cols-1 sm:grid-cols-[80px_1fr_90px_90px_90px_80px] gap-1 sm:gap-2 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                    {/* Date */}
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {date.toLocaleDateString([], { month: "short", day: "numeric" })}
                      <span className="block text-[9px]">{date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    </div>

                    {/* Asset + badges */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded font-mono", t.side === "buy" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                        {t.side.toUpperCase()}
                      </span>
                      <span className="font-mono font-semibold text-sm">{t.asset.replace("-USD", "")}</span>
                      {session && (
                        <Badge className={cn("text-[9px] border-none py-0 px-1.5",
                          session === "[SCALP]" ? "bg-blue-500/20 text-blue-300" :
                          session === "[SWING]" ? "bg-purple-500/20 text-purple-300" :
                          "bg-amber-500/20 text-amber-300"
                        )}>
                          {session.replace(/[\[\]]/g, "")}
                        </Badge>
                      )}
                    </div>

                    {/* Entry */}
                    <div className="text-right text-xs font-mono text-muted-foreground">
                      <span className="sm:hidden text-[9px] text-muted-foreground/60 mr-1">Entry</span>
                      ${Number(t.entry_price).toFixed(Number(t.entry_price) >= 10 ? 2 : 4)}
                    </div>

                    {/* Exit */}
                    <div className="text-right text-xs font-mono text-muted-foreground">
                      <span className="sm:hidden text-[9px] text-muted-foreground/60 mr-1">Exit</span>
                      ${Number(t.exit_price ?? 0).toFixed(Number(t.exit_price ?? 0) >= 10 ? 2 : 4)}
                    </div>

                    {/* P&L $ */}
                    <div className={cn("text-right text-xs font-mono font-semibold", isWin ? "text-emerald-400" : "text-red-400")}>
                      {isWin ? "+" : ""}{pnl != null ? `$${Math.abs(pnl).toFixed(2)}` : "—"}
                    </div>

                    {/* P&L % */}
                    <div className={cn("text-right text-xs font-mono font-semibold flex items-center justify-end gap-0.5", isWin ? "text-emerald-400" : "text-red-400")}>
                      {isWin ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                      {pnlPct != null ? `${Math.abs(pnlPct).toFixed(2)}%` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 text-xs text-muted-foreground">
                <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-2 py-1 rounded hover:bg-muted disabled:opacity-40"
                  >←</button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-2 py-1 rounded hover:bg-muted disabled:opacity-40"
                  >→</button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
