import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminTiersPanel } from "@/features/admin/AdminTiersPanel";

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
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link to="/markets" className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <h1 className="font-display text-lg font-semibold ml-2">Admin</h1>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        <AdminTiersPanel />
      </main>
    </div>
  );
}
