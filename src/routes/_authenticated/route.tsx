import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  pendingComponent: AuthenticatedPending,
  beforeLoad: async () => {
    // Use the locally persisted session first: it resolves instantly and does not
    // bounce signed-in users to /auth when the network call is slow or flaky.
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.user) return { user: sessionData.session.user };

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});

function AuthenticatedPending() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading dashboard" />
    </main>
  );
}
