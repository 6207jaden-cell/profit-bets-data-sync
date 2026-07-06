import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Loader2, TrendingUp, AlertTriangle, Repeat, Sparkles, Lock } from "lucide-react";
import { getPortfolioCommentary, type CommentaryResult } from "@/lib/portfolio.functions";
import { useProfile } from "@/hooks/use-profile";
import { Link } from "@tanstack/react-router";

export type CommentaryPosition = {
  asset: string;
  asset_type: "stock" | "crypto";
  shares: number;
  cost_basis: number;
  price: number | null;
  value: number | null;
  pnl: number | null;
  pnl_pct: number | null;
};

export function PortfolioCommentaryCard({ positions }: { positions: CommentaryPosition[] }) {
  const { hasPro } = useProfile();
  const fn = useServerFn(getPortfolioCommentary);
  const [result, setResult] = useState<CommentaryResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const r = await fn({ data: { positions } });
      setResult(r);
    } catch (e) {
      setResult({ ok: false, reason: e instanceof Error ? e.message : "unknown" });
    } finally {
      setLoading(false);
    }
  }

  if (!hasPro) {
    return (
      <Card className="p-4 border-border bg-card mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/30">
            <Brain className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="font-display font-semibold flex items-center gap-2">
              AI Portfolio Insights <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">PRO</Badge>
            </div>
            <p className="text-xs text-muted-foreground">Get AI-generated commentary, risks, and rebalancing ideas.</p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/">
            <Lock className="h-3 w-3 mr-1" /> Upgrade
          </Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-4 border-border bg-card mb-4">
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold">AI Portfolio Insights</h3>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={loading || positions.length === 0}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
          {result?.ok ? "Refresh" : "Analyze"}
        </Button>
      </header>

      {!result && (
        <p className="text-sm text-muted-foreground">
          {positions.length === 0
            ? "Add positions to unlock AI commentary."
            : "Click Analyze for AI-generated commentary tailored to your holdings."}
        </p>
      )}

      {result && !result.ok && (
        <p className="text-sm text-bear">Could not generate insights: {result.reason.replace(/_/g, " ")}.</p>
      )}

      {result && result.ok && (
        <div className="space-y-3 text-sm">
          <p className="text-foreground leading-relaxed">{result.commentary}</p>
          <InsightList icon={<AlertTriangle className="h-3.5 w-3.5 text-bear" />} label="Risks" items={result.risks} tone="bear" />
          <InsightList icon={<TrendingUp className="h-3.5 w-3.5 text-bull" />} label="Opportunities" items={result.opportunities} tone="bull" />
          <InsightList icon={<Repeat className="h-3.5 w-3.5 text-primary" />} label="Rebalance ideas" items={result.rebalance} tone="primary" />
        </div>
      )}
    </Card>
  );
}

function InsightList({
  icon,
  label,
  items,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  items: string[];
  tone: "bull" | "bear" | "primary";
}) {
  if (items.length === 0) return null;
  const border = tone === "bull" ? "border-bull/30" : tone === "bear" ? "border-bear/30" : "border-primary/30";
  return (
    <div className={`rounded-lg border ${border} bg-background/40 p-3`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {icon} {label}
      </div>
      <ul className="list-disc list-inside space-y-1 text-sm">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}
