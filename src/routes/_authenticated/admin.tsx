import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AdminTiersPanel } from "@/features/admin/AdminTiersPanel";
import { TopNav } from "@/components/TopNav";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userRes.user.id,
      _role: "admin",
    });
    if (!isAdmin) throw redirect({ to: "/markets" });
  },
  head: () => ({ meta: [{ title: "Admin · Membership" }] }),
  component: AdminPage,
});

function AdminPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <h1 className="font-display text-lg font-semibold">Admin</h1>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        <AdminTiersPanel />
      </main>
    </div>
  );
}

