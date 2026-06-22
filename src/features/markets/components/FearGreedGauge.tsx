import { cn } from "@/lib/utils";

export function FearGreedGauge({ value, classification }: { value: number; classification: string }) {
  const color =
    value <= 25 ? "text-bear" :
    value <= 45 ? "text-orange-400" :
    value <= 55 ? "text-neutral" : "text-bull";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-num text-4xl font-semibold">{value}</span>
        <span className={cn("text-sm font-medium", color)}>{classification}</span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden" style={{
        background: "linear-gradient(to right, oklch(0.65 0.22 25), oklch(0.78 0.18 70), oklch(0.78 0.17 165))",
      }}>
        <div
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 h-4 w-1 bg-foreground rounded-full shadow-lg ring-2 ring-background"
          style={{ left: `${Math.max(0, Math.min(100, value))}%`, transform: "translate(-50%, -50%)" }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">
        <span>Extreme Fear</span>
        <span>Extreme Greed</span>
      </div>
    </div>
  );
}
