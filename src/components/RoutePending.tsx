import { Loader2 } from "lucide-react";

export function RoutePending() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
    </main>
  );
}