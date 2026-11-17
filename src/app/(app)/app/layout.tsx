import { AuthGuard } from "@/components/layout/auth-guard";
import { AppShell } from "@/components/layout/app-shell";

/**
 * The authenticated app is rendered per request, never prerendered to static
 * HTML.
 *
 * Every screen under here is a client component behind an auth guard, so a
 * prerendered shell carries no data and buys nothing. It actively broke
 * navigation on Firebase Hosting: a prerendered route is written to disk as
 * `app/inbox.html`, and Hosting serves that file for *every* request to the
 * path — including the React Server Component request the client router makes
 * to perform a soft navigation. Verified against the deployed site:
 *
 *   GET /app/inbox              (RSC: 1) -> text/html, max-age=3600   (static file)
 *   GET /app/campaigns/{id}     (RSC: 1) -> text/x-component          (SSR function)
 *
 * Receiving HTML where it expects a component payload, the router gives up and
 * performs a full document navigation. That remounts the whole tree, which is
 * why "Loading secure workspace" reappeared on every page change and the app
 * looked like it reloaded.
 *
 * The dynamic campaign route was always correct, which is what isolates this to
 * prerendering rather than to the app code.
 */
export const dynamic = "force-dynamic";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AppShell>{children}</AppShell>
    </AuthGuard>
  );
}
