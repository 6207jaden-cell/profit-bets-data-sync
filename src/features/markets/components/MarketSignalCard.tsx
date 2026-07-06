import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { robinhoodLinkForSignal } from "@/lib/robinhood-links";

interface Props {
  asset: string;
  direction: "call" | "put" | "buy" | "sell";
  signalType: "options_flow" | "buy_sell";
  confidence: number;
  entryPrice: number | null;
  targetPrice: number | null;
  stopPrice: number | null;
  expectedEdgePct: number | null;
  thesis?: string | null;
  index?: number;
  locked?: boolean;
  onDetailsClick?: (asset: string, kind: "stock" | "crypto") => void;
}

export function MarketSignalCard(p: Props) {
  const isBullish = p.direction === "call" || p.direction === "buy";
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: (p.index ?? 0) * 0.04 }}
      className={cn(
        "rounded-xl border border-border bg-card p-4 relative",
        p.locked && "select-none"
      )}
    >
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-display font-semibold text-lg">{p.asset}</span>
          <span className={cn(
            "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold",
            isBullish ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
          )}>
            {p.direction}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{p.signalType === "options_flow" ? "Options" : "Equity"}</span>
      </header>
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-xs text-muted-foreground">Confidence</span>
          <span className="font-num text-sm">{p.confidence.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full", isBullish ? "bg-bull" : "bg-bear")} style={{ width: `${p.confidence}%` }} />
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-[10px] text-muted-foreground uppercase">Entry</dt>
          <dd className="font-num text-sm">{p.entryPrice != null ? `$${p.entryPrice.toFixed(2)}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-muted-foreground uppercase">Target</dt>
          <dd className="font-num text-sm text-bull">{p.targetPrice != null ? `$${p.targetPrice.toFixed(2)}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-muted-foreground uppercase">Stop</dt>
          <dd className="font-num text-sm text-bear">{p.stopPrice != null ? `$${p.stopPrice.toFixed(2)}` : "—"}</dd>
        </div>
      </dl>
      {p.expectedEdgePct != null && (
        <p className="text-xs text-muted-foreground mt-3 flex justify-between">
          <span>Expected edge</span>
          <span className="font-num text-primary">{p.expectedEdgePct.toFixed(1)}%</span>
        </p>
      )}
      {p.thesis && <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-2">{p.thesis}</p>}

      {!p.locked && (() => {
        const kind: "stock" | "crypto" | "options" =
          p.signalType === "options_flow" ? "options"
          : /^(BTC|ETH|SOL|DOGE|ADA|XRP|AVAX|MATIC|BCH|DOT|LINK|SHIB|LTC|UNI|ATOM|BNB)(-USD)?$/i.test(p.asset) ? "crypto"
          : "stock";
        const rh = robinhoodLinkForSignal({ asset: p.asset, assetKind: kind, direction: p.direction });
        return (
          <div className="mt-3 flex items-center gap-2">
            <a
              href={rh.url}
              target="_blank"
              rel="noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              aria-label={rh.label}
            >
              <ExternalLink className="h-3 w-3" /> Robinhood
            </a>
            {p.onDetailsClick && kind !== "options" && (
              <button
                onClick={() => p.onDetailsClick?.(p.asset, kind)}
                className="inline-flex items-center justify-center h-8 px-3 rounded-md text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/80 transition-colors"
              >
                Details
              </button>
            )}
          </div>
        );
      })()}
    </motion.article>
  );
}
