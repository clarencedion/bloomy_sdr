"use client";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Topbar } from "@/components/layout/topbar";
import { TestModeBanner } from "@/components/layout/test-mode-banner";
import { WorkspaceLoadError } from "@/components/layout/workspace-load-error";
import { WorkspaceBranding } from "@/components/layout/workspace-branding";
import { BusinessProvider } from "@/lib/context/business-context";
import { useLiveDoc } from "@/lib/sdr/use-live";
import type { GlobalSettings } from "@/types/firestore";

export function AppShell({ children }: { children: React.ReactNode }) {
  // Live rather than refetched on navigation. This used to run on every
  // pathname change, so the topbar status and the safe-mode banner re-resolved
  // on each page view — the flicker that made a client-side navigation feel
  // like a full page reload. A single document listener costs one read on
  // connect and one per actual change, and now reflects a change made in
  // another tab or by the backend without any navigation at all.
  const { data: settings } = useLiveDoc<GlobalSettings>("settings/global");

  return (
    <BusinessProvider>
      <div className="min-h-screen bg-slate-50">
        <WorkspaceBranding />
        <AppSidebar />
        <WorkspaceLoadError />
        {/* Renders only once settings have loaded, so no page ever flashes a
            safe-mode claim that may not be true. */}
        {settings !== null && (
          <TestModeBanner
            testModeEnabled={settings.testModeEnabled ?? false}
            allowlist={settings.testEmailAllowlist ?? []}
          />
        )}
        <Topbar automationPaused={settings?.automationPaused ?? true} />
        <main
          className="px-5 py-6 pb-24 md:pb-6"
          style={{ marginLeft: "var(--sidebar-width, 240px)" }}
        >
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
        <MobileNav />
      </div>
    </BusinessProvider>
  );
}
