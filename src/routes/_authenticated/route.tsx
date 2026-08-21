import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { RoutePending } from "@/components/RoutePending";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  pendingComponent: RoutePending,
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
