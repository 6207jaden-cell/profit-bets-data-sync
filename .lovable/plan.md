# Restore page loading in preview and live

## Goal
Make public and authenticated pages load reliably in both preview and the published website without hydration failures or getting trapped on the shared “This page didn’t load” screen.

## Confirmed findings
- Direct HTTP requests to `/`, `/auth`, and `/markets` return HTML successfully from the local preview and published website, so this is a browser startup/hydration failure rather than missing routes or hosting rewrites.
- The runtime report and a clean browser run reproduce a React hydration mismatch at the `/auth` route boundary: the server has a Suspense placeholder while the client immediately renders `AuthPage`.
- The root error boundary clears its recovery marker as soon as the root mounts, before child routes are known to be stable. A child-route failure can therefore repeatedly re-arm automatic recovery.
- The router has no global `defaultErrorComponent`, so failures outside the root route boundary do not share the same recovery behavior.

## Changes
1. **Eliminate the confirmed hydration mismatch**
   - Give the auth route a deterministic pending/render boundary so the server and first client render use the same tree.
   - Keep session-driven redirects after hydration so auth state cannot change initial markup.
   - Make the authenticated layout’s client-only transition deterministic as well.

2. **Stabilize shared error recovery**
   - Stop clearing recovery state before child routes are stable.
   - Restrict automatic hard reloads to transient preview module errors and one attempt per error.
   - Use router invalidation/reset for normal application errors, including on the live site.

3. **Add router-wide fallback coverage**
   - Configure the router’s default error component to use the same shared fallback for errors outside a matched route boundary.
   - Preserve current not-found and protected-route behavior.

4. **Verify both environments**
   - Test `/`, `/auth`, `/markets`, `/trading`, `/settings`, and `/admin` with desktop and mobile viewports.
   - Verify direct loads and in-app navigation while signed out and signed in.
   - Confirm preview and published behavior have no hydration errors, reload loops, blank pages, or stuck error screens.

## Technical scope
Expected files: `src/routes/__root.tsx`, `src/router.tsx`, `src/routes/auth.tsx`, and `src/routes/_authenticated/route.tsx`. No trading logic, database, or Robinhood behavior will change.