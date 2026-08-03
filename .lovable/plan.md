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

**Publishing alone fixes it.** The jobs already point at the production URL, so the moment a published build exists they start hitting live code — no SQL changes, no re-registering, nothing to re-trigger. The next scheduled session runs on its own.

Optional extras:

1. **Verify once after publishing** — trigger a manual scan and confirm a new `agent_decisions` row plus a `200` in the HTTP response log. Not required for the fix; it just means you find out in 2 minutes instead of waiting for the next cron slot. You can also verify passively by watching the Agent tab after the next scheduled session.
2. **Align the stale weekend job** — `autonomous-weekend-prep` (jobid 13) still points at the `-dev` preview host while the other 22 use production. It works today, but it's the odd one out and will drift. Worth folding into `register_all_crons()` so all schedules share one URL.


## Technical details

- Publish the project so `https://project--<id>.lovable.app` serves a real build; the 23 cron jobs need no changes.
- Optional cleanup: delete the stale `autonomous-weekend-prep` job (jobid 13) and add `weekend_prep` to the job list inside `register_all_crons()` so every schedule lives in one place, then run `SELECT register_all_crons();`.
- Keep `APPLY_CRONS.sql` in sync with the production URL so future manual runs don't reintroduce a mismatch.
- Verification queries: `cron.job_run_details` for firing, and `net._http_response` `status_code` for whether the endpoint actually answered `200`.

## Note

The endpoints themselves look healthy — `resolve-signals` returned `{"ok":true,...}` with a `200` today, so the app and API routes work. This is purely a URL/publish-target problem.
