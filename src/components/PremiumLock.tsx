import { Crown, Lock, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tier = "pro" | "elite";

const TIER_META = {
  pro: { label: "Pro", icon: Sparkles, className: "text-primary border-primary/40 bg-primary/10" },
  elite: { label: "Elite", icon: Crown, className: "text-amber-500 border-amber-500/40 bg-amber-500/10" },
} as const;

export function PremiumLock({
  requiredTier,
  title,
  description,
  perks,
}: {
  requiredTier: Tier;
  title: string;
  description: string;
  perks?: string[];
}) {
  const meta = TIER_META[requiredTier];
  const Icon = meta.icon;
  return (
    <Card className="p-8 md:p-12 bg-card border-border">
      <div className="max-w-md mx-auto text-center space-y-5">
        <div className={cn("mx-auto h-14 w-14 rounded-2xl border flex items-center justify-center", meta.className)}>
          <Lock className="h-6 w-6" />
        </div>
        <div>
          <div className="flex items-center justify-center gap-2 mb-1">
            <h3 className="font-display text-2xl font-semibold">{title}</h3>
            <Badge variant="outline" className={cn("gap-1 text-[10px]", meta.className)}>
              <Icon className="h-3 w-3" /> {meta.label.toUpperCase()}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {perks && (
          <ul className="text-left text-sm text-muted-foreground space-y-2 max-w-sm mx-auto">
            {perks.map((p) => (
              <li key={p} className="flex gap-2">
                <Sparkles className={cn("h-4 w-4 shrink-0 mt-0.5", requiredTier === "elite" ? "text-amber-500" : "text-primary")} />
                {p}
              </li>
            ))}
          </ul>
        )}
        <div className="text-xs text-muted-foreground border-t border-border pt-4">
          Contact your workspace admin to upgrade your tier.
        </div>
      </div>
    </Card>
  );
}
