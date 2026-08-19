# Fix the Open Dashboard flow

## Goal
Make **Open dashboard** reliably open `/markets` in preview and production, whether the visitor is already signed in or needs to authenticate first.

## Changes
1. **Correct the landing-page controls**
   - Replace the current nested `Link > button` markup with the design-system button rendered as the link itself.
   - Keep the CTA in a neutral loading state until the local session check finishes, so it cannot navigate to a protected route with unknown auth state.
   - Send authenticated users to `/markets`; send signed-out users to `/auth` with `/markets` preserved as the post-login destination.

2. **Make authentication redirect consistently**
   - Validate and read the requested destination on `/auth`.
   - After email or Google sign-in, navigate to that destination instead of relying on multiple hardcoded `/markets` redirects.
   - If a session already exists, forward directly to the requested destination.

3. **Harden preview recovery without masking real errors**
   - Keep the full-page reload behavior for disconnected preview modules.
   - Restore router invalidate-and-reset behavior for ordinary route errors, so genuine dashboard errors retry correctly rather than only refreshing the browser.

4. **Verify the complete flow**
   - Test the signed-out path: landing CTA → auth page with redirect retained.
   - Test the signed-in path: landing CTA → `/markets`, with the dashboard visible and no root error screen.
   - Check mobile and desktop button interaction and inspect browser errors during navigation.

## Technical details
- Continue using TanStack Router navigation and the existing protected `_authenticated` layout.
- Use the existing `Button` component with its `asChild` composition API; do not nest interactive elements.
- Do not change dashboard business logic, background jobs, or database behavior.