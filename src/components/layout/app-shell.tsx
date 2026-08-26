"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Topbar } from "@/components/layout/topbar";
import { TestModeBanner } from "@/components/layout/test-mode-banner";
import { BusinessProvider } from "@/lib/context/business-context";
import { getGlobalSettings } from "@/lib/firebase/firestore";
import type { GlobalSettings } from "@/types/firestore";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [settings, setSettings] = useState<GlobalSettings | null>(null);

  // Re-read on navigation so the SDR status reflects changes made elsewhere
  // (for example pausing automation in Advanced) without a full reload.
  useEffect(() => {
    void getGlobalSettings().then((loaded) => {
      if (loaded) setSettings(loaded as GlobalSettings);
    });
  }, [pathname]);

  return (
    <BusinessProvider>
      <div className="min-h-screen bg-slate-50">
        <AppSidebar />
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
