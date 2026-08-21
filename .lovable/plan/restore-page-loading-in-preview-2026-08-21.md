# Restore page loading in preview

## Goal
Make public and authenticated pages load reliably in preview without getting trapped on the shared “This page didn’t load” screen.

## Confirmed findings
- Direct requests to `/`, `/auth`, `/markets`, and `/settings` currently return HTML successfully; protected pages correctly redirect signed-out visitors to `/auth`.
- The runtime report and a clean browser run both reproduce a React hydration mismatch at the `/auth` route boundary: the server has a Suspense placeholder while the client immediately renders `AuthPage`.
- The root error boundary clears its preview-recovery marker as soon as the root mounts, before child routes are known to be stable. A child-route failure can therefore repeatedly re-arm the automatic reload.
- The router has no global `defaultErrorComponent`, so failures outside the root route boundary do not share the same recovery behavior.

## Changes
1. **Stabilize root error recovery**
   - Stop clearing the recovery marker during the root component’s initial mount.
   - Limit automatic reload to one attempt per transient preview error and keep the manual hard-reload action available.
   - Use normal router invalidation/reset for genuine application errors so they do not enter a reload loop.

2. **Eliminate the confirmed route-boundary hydration mismatch**
   - Give the auth route a deterministic pending/render boundary so the server and first client render use the same tree instead of `Suspense` on one side and `AuthPage` on the other.
   - Keep session-driven redirects in an effect after hydration so auth state cannot change the initial markup.
   - Review the authenticated layout’s `ssr: false` boundary and give its public-to-protected transitions the same deterministic loading behavior.

3. **Add router-wide fallback coverage**
   - Configure the router’s default error component to use the same shared fallback, covering errors that occur outside a matched route boundary.
   - Preserve the existing root not-found handling and protected-route behavior.

4. **Verify the complete navigation flow**
   - Test `/`, `/auth`, and every authenticated page in a fresh desktop and mobile browser session.
   - Verify signed-out redirects and a signed-in session separately.
   - Confirm there are no hydration errors, reload loops, blank pages, or stuck error boundaries during direct loads and in-app navigation.

## Technical scope
Expected files: `src/routes/__root.tsx`, `src/router.tsx`, `src/routes/auth.tsx`, and, only if required by verification, `src/routes/_authenticated/route.tsx`. No trading logic, database, or Robinhood behavior will be changed.
