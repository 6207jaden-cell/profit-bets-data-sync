import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/sync-crons")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Call the register_all_crons() SQL function defined in migrations.
        // That function runs as SECURITY DEFINER so it can call cron.schedule()
        // even from a regular authenticated context.
        const { data, error } = await supabaseAdmin.rpc("register_all_crons" as never);

        if (error) {
          // Detect the most common failure: pg_cron not enabled
          const isPgCronMissing =
            error.message?.includes("cron") ||
            error.message?.includes("pg_cron") ||
            error.message?.includes("schema") ||
            error.code === "42883"; // undefined function

          return Response.json({
            ok: false,
            error: isPgCronMissing
              ? "pg_cron extension is not enabled. Go to Supabase Dashboard → Database → Extensions → enable pg_cron and pg_net, then click this button again."
              : error.message,
          });
        }

        const result = data as { ok: boolean; registered: number; failed: number; errors: string[] };

        return Response.json({
          ok: result.ok,
          succeeded: result.registered,
          failed: result.failed,
          failed_jobs: result.errors ?? [],
          total: result.registered + result.failed,
        });
      },
    },
  },
});
