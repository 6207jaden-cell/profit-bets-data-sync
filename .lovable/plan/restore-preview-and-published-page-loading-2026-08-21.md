# Restore preview and published page loading

## Goal
Make every public and authenticated page start normally in both preview and the published app.

## Confirmed cause
- The local preview currently loads `/`, `/auth`, and the signed-out `/markets` redirect without browser errors.
- The published app returns HTML, but every tested route reaches “This page didn’t load.” Its browser console shows that the deployed bundle is missing the managed backend URL and publishable key when `src/integrations/supabase/client.ts` first accesses auth.
- The Lovable Cloud backend is healthy, and the current sandbox has all four expected client/server variables, so the remaining failure is the binding carried into the published frontend build—not a route, database, Robinhood, or hosting-rewrite problem.

## Changes
1. **Repair the managed backend binding**
   - Re-derive and rebind the project’s managed backend variables through Lovable Cloud.
   - Keep credentials out of source code and do not modify generated integration files.

2. **Rebuild on the corrected binding**
   - Confirm preview starts with the rebound variables.
   - Publish/update the frontend so the corrected build-time public configuration is included in the live bundle.

3. **Verify all page paths**
   - Test `/`, `/auth`, `/markets`, `/trading`, `/settings`, and `/admin` in fresh desktop and mobile browser contexts.
   - Check signed-out redirects and a signed-in session separately.
   - Confirm no missing-configuration errors, hydration errors, reload loops, or shared error screen remain.

4. **Fallback only if preview still fails**
   - Capture the exact signed-in preview error and fix that route boundary only if it is independently reproducible after rebinding; do not mix speculative hydration changes into the confirmed deployment fix.

## Technical scope
The primary correction is managed environment rebinding plus a fresh frontend deployment. Source changes are only expected if post-rebind verification reveals a separate reproducible preview error. No trading logic, database schema, cron schedule, or Robinhood behavior will change.
