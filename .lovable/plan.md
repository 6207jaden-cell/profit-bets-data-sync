# Fix: autonomous agent stopped scanning on weekdays

## What's actually wrong

The schedules are fine — every job fired on time today. The problem is where they point.

Verified from the database:

- All 23 scan/exit/scalp jobs call `https://project--<id>.lovable.app/...`, which is the **published** site.
- The project has **no published build**, so all 92 of today's calls came back **HTTP 404** with the "No working published build found yet" page. The agent code never ran.
- The one job that still works, `autonomous-weekend-prep` (job 13, created earlier), points at the `-dev` preview URL instead — which is exactly why the only recent `agent_decisions` rows are the Saturday weekend-prep runs (Aug 1, Jul 25, Jul 18).
- Weekday scans last produced a decision on Jul 14, right around when the jobs were re-registered against the production URL.

```text
cron fires  ->  https://project--<id>.lovable.app/api/public/autonomous-agent
                        |
                        v
              404 "No published build"   ->  no scan, no decision row
```

## The fix

Two parts, both needed.

1. **Publish the app.** This is the real fix: the production URL is the correct, stable target for cron, and it only works once a published build exists. After publishing, the existing jobs start hitting live code with no SQL changes.
2. **Repoint the jobs to the preview URL as an interim, and align the weekend job.** Re-register all jobs against `project--<id>-dev.lovable.app` so scanning resumes immediately, even before/independent of publishing. This also removes the inconsistency where one job used a different host than the other 22.

Then trigger one manual `morning`/`scalp` scan and confirm a new `agent_decisions` row plus a `200` in the HTTP response log.

Recommended: do both — repoint now so today's sessions run, publish so the agent keeps running on the stable production URL.

## Technical details

- Update `public.register_all_crons()` so its `v_url` is driven by one constant, and change that constant to the `-dev` host; run `SELECT register_all_crons();` to unschedule/reschedule all jobs.
- Delete the stale `autonomous-weekend-prep` job (jobid 13) and add `weekend_prep` to the job list inside `register_all_crons()` so every schedule lives in one place.
- Keep `APPLY_CRONS.sql` in sync with the same URL so future manual runs don't reintroduce the mismatch.
- Verification queries: `cron.job_run_details` for firing, and `net._http_response` `status_code` for whether the endpoint actually answered `200`.

## Note

The endpoints themselves look healthy — `resolve-signals` returned `{"ok":true,...}` with a `200` today, so the app and API routes work. This is purely a URL/publish-target problem.
