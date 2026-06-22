import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export function BlurLock({ active, label = "Unlock with Pro", children }: { active: boolean; label?: string; children: ReactNode }) {
  if (!active) return <>{children}</>;
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none blur-sm select-none">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/40 backdrop-blur-sm rounded-xl">
        <Lock className="h-6 w-6 text-primary mb-2" />
        <p className="text-sm font-medium mb-3">{label}</p>
        <Button size="sm" disabled>Upgrade</Button>
      </div>
    </div>
  );
}
