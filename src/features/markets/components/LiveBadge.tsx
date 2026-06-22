import { cn } from "@/lib/utils";

export function LiveBadge({ updatedAt, className }: { updatedAt?: string | Date | null; className?: string }) {
  const ts = updatedAt ? (typeof updatedAt === "string" ? new Date(updatedAt) : updatedAt) : null;
  const label = ts ? `${ts.getHours().toString().padStart(2, "0")}:${ts.getMinutes().toString().padStart(2, "0")}:${ts.getSeconds().toString().padStart(2, "0")}` : "—";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground", className)}>
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
      </span>
      LIVE · {label}
    </span>
  );
}
