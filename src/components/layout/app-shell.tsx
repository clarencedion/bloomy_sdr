"use client";

import { useEffect, useState, useCallback } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BusinessProvider } from "@/lib/context/business-context";
import { callRunResearchQueue } from "@/lib/firebase/functions";
import { getGlobalSettings, saveGlobalSettings } from "@/lib/firebase/firestore";
import type { GlobalSettings } from "@/types/firestore";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [automationPaused, setAutomationPaused] = useState(true);
  const [togglingAutomation, setTogglingAutomation] = useState(false);
  const [runningQueue, setRunningQueue] = useState(false);
  const [settings, setSettings] = useState<Partial<GlobalSettings> | null>(null);

  useEffect(() => {
    void getGlobalSettings().then((s) => {
      if (s) {
        setSettings(s);
        setAutomationPaused(s.automationPaused ?? true);
      }
    });
  }, []);

  const handleToggleAutomation = useCallback(async () => {
    if (settings === null) return;
    setTogglingAutomation(true);
    try {
      const next = !automationPaused;
      const updated = { ...(settings as GlobalSettings), automationPaused: next };
      await saveGlobalSettings(updated);
      setSettings(updated);
      setAutomationPaused(next);
    } finally {
      setTogglingAutomation(false);
    }
  }, [settings, automationPaused]);

  const handleRunQueue = useCallback(async () => {
    setRunningQueue(true);
    try {
      await callRunResearchQueue();
    } catch (err) {
      console.error(err);
    } finally {
      setRunningQueue(false);
    }
  }, []);

  return (
    <BusinessProvider>
      <div className="min-h-screen bg-slate-50">
        <AppSidebar />
        <Topbar
          automationPaused={automationPaused}
          onToggleAutomation={() => void handleToggleAutomation()}
          onRunQueue={() => void handleRunQueue()}
          runningQueue={runningQueue}
          togglingAutomation={togglingAutomation}
        />
        <main
          className="px-6 py-6"
          style={{ marginLeft: "var(--sidebar-width, 220px)" }}
        >
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </BusinessProvider>
  );
}
