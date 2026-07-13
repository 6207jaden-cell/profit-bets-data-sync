import { createFileRoute } from "@tanstack/react-router";

const PROD_URL =
  "https://project--a4cfc4c8-5d00-4bc0-a84a-408f0bcb34ad.lovable.app";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieGllZ3NwbXdrcWJ0Y2hkYWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzgyNzEsImV4cCI6MjA5NzcxNDI3MX0.JRVZe0Z0KJS6NUSQ0OBhkcxaVGpvVOgQeJDX2h6FrEw";

// Every cron job the app needs — update this list whenever new crons are added
const ALL_JOBS: Array<{ name: string; schedule: string; endpoint: string; body: string }> = [
  // ── Autonomous agent scans ─────────────────────────────────────────────
  { name: "autonomous-morning-scan",    schedule: "30 13 * * 1-5",          endpoint: "/api/public/autonomous-agent",       body: '{"session":"morning"}' },
  { name: "autonomous-midmorning-scan", schedule: "30 14 * * 1-5",          endpoint: "/api/public/autonomous-agent",       body: '{"session":"midday"}' },
  { name: "autonomous-midday-scan",     schedule: "30 16 * * 1-5",          endpoint: "/api/public/autonomous-agent",       body: '{"session":"midday"}' },
  { name: "autonomous-afternoon-scan",  schedule: "30 18 * * 1-5",          endpoint: "/api/public/autonomous-agent",       body: '{"session":"midday"}' },
  { name: "autonomous-weekend-prep",    schedule: "0 12 * * 6",             endpoint: "/api/public/autonomous-agent",       body: '{"session":"weekend_prep"}' },
  // ── Scalp scans every 30 min 10am-3:30pm ET ───────────────────────────
  { name: "scalp-1000",  schedule: "0 14 * * 1-5",  endpoint: "/api/public/autonomous-agent", body: '{"session":"scalp"}' },
  { name: "scalp-1030",  schedule: "30 14 * * 1-5", endpoint: "/api/public/autonomous-agent", body: '{"session":"scalp"}' },
  { name: "scalp-1100",  schedule: "0 15 * * 1-5",  endpoint: "/api/public/autonomous-agent", body: '{"session":"scalp"}' },
  { name: "scalp-1130",  schedule: "30 15 * * 1-5", endpoint: "/api/public/autonomous-agent", body: '{"session":"scalp"}' },
  { name: "scalp-1200",  schedule: "0 16 * * 1-5",  endpoint: "/api/public/autonomous-agent", body: '{"session":"scalp"}' },
  { name: "scalp-1300",  schedule: "0 17 * * 1-5",  endpoint: "/api/public/autonomous-agent", body: '{"session":"scalp"}' },
  { name: "scalp-1330",  schedule: "30 17 * * 1-5", endpoint: "/api/public/autonomous-agent", body: '{"session":"scalp"}' },
  { name: "scalp-1400",  schedule: "0 18 * * 1-5",  endpoint: "/api/public/autonomous-agent", body: '{"session":"scalp"}' },
  { name: "scalp-1500",  schedule: "0 19 * * 1-5",  endpoint: "/api/public/autonomous-agent", body: '{"session":"scalp"}' },
  { name: "scalp-1530",  schedule: "30 19 * * 1-5", endpoint: "/api/public/autonomous-agent", body: '{"session":"scalp"}' },
  // ── Exit, learning, maintenance ────────────────────────────────────────
  { name: "autonomous-exit-check",      schedule: "0 11,13,15,17,19 * * 1-5", endpoint: "/api/public/autonomous-exit-check",  body: '{}' },
  { name: "autonomous-weekly-learning", schedule: "0 0 * * 1",              endpoint: "/api/public/autonomous-learning",    body: '{}' },
  { name: "evaluate-strategies",        schedule: "*/5 * * * *",            endpoint: "/api/public/evaluate-strategies",    body: '{}' },
  { name: "generate-strategies",        schedule: "0 * * * *",              endpoint: "/api/public/generate-strategies",    body: '{}' },
  { name: "resolve-signals",            schedule: "0 * * * *",              endpoint: "/api/public/resolve-signals",        body: '{}' },
  { name: "snapshot-portfolio",         schedule: "0 9 * * *",              endpoint: "/api/public/snapshot-portfolio",     body: '{}' },
  { name: "daily-digest",               schedule: "0 8 * * *",              endpoint: "/api/public/daily-digest",           body: '{}' },
  { name: "friday-position-review",     schedule: "45 19 * * 5",            endpoint: "/api/public/friday-review",          body: '{}' },
  { name: "sync-robinhood-balance",     schedule: "15 13 * * 1-5",          endpoint: "/api/public/sync-robinhood-balance", body: '{}' },
  { name: "decay-agent-memory",         schedule: "0 4 * * *",              endpoint: "/api/public/agent-memory-decay",     body: '{}' },
];

export const Route = createFileRoute("/api/public/sync-crons")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const results: Array<{ name: string; status: "ok" | "error"; error?: string }> = [];

        for (const job of ALL_JOBS) {
          try {
            // Build the SQL for this cron job
            const cronSql = `
              SELECT cron.unschedule(name) FROM cron.job WHERE jobname = '${job.name}';
              SELECT cron.schedule(
                '${job.name}',
                '${job.schedule}',
                $q$SELECT net.http_post(
                  url:='${PROD_URL}${job.endpoint}',
                  headers:=jsonb_build_object('Content-Type','application/json','apikey','${ANON_KEY}'),
                  body:='${job.body}'::jsonb
                ) AS r;$q$
              );
            `.trim();

            // Use supabaseAdmin to call a raw SQL RPC
            // We use the pg_cron schema directly via rpc
            const { error } = await supabaseAdmin.rpc("exec_sql" as never, {
              sql: cronSql,
            } as never);

            if (error) {
              // Fallback: try registering via direct cron.schedule call
              const { error: cronError } = await supabaseAdmin
                .schema("cron" as never)
                .rpc("schedule" as never, {
                  jobname: job.name,
                  schedule: job.schedule,
                  command: `SELECT net.http_post(url:='${PROD_URL}${job.endpoint}',headers:=jsonb_build_object('Content-Type','application/json','apikey','${ANON_KEY}'),body:='${job.body}'::jsonb) AS r;`,
                } as never);

              if (cronError) {
                results.push({ name: job.name, status: "error", error: cronError.message });
              } else {
                results.push({ name: job.name, status: "ok" });
              }
            } else {
              results.push({ name: job.name, status: "ok" });
            }
          } catch (e) {
            results.push({ name: job.name, status: "error", error: String(e) });
          }
        }

        const succeeded = results.filter((r) => r.status === "ok").length;
        const failed = results.filter((r) => r.status === "error");

        // Check if pg_cron is even enabled
        const { data: cronCheck } = await supabaseAdmin
          .from("cron.job" as never)
          .select("jobname")
          .limit(1);

        if (failed.length > 0 && !cronCheck) {
          return Response.json({
            ok: false,
            error: "pg_cron extension is not enabled. Go to Supabase Dashboard → Database → Extensions → enable pg_cron and pg_net, then click this button again.",
            succeeded: 0,
            failed: ALL_JOBS.length,
          });
        }

        return Response.json({
          ok: failed.length === 0,
          succeeded,
          failed: failed.length,
          failed_jobs: failed.map((f) => `${f.name}: ${f.error}`),
          total: ALL_JOBS.length,
        });
      },
    },
  },
});
