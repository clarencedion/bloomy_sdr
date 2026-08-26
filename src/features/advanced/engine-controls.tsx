"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pause, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getGlobalSettings, saveGlobalSettings } from "@/lib/firebase/firestore";
import { callRunResearchQueue } from "@/lib/firebase/functions";
import type { GlobalSettings } from "@/types/firestore";
import { cn } from "@/lib/utils";

/**
 * Global engine controls that used to sit in the top bar. They are real
 * operational levers, so they are preserved here rather than removed - but a
 * normal user never needs them: campaigns start themselves and the scheduled
 * jobs keep them moving.
 */
export function EngineControls() {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [paused, setPaused] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void getGlobalSettings().then((loaded) => {
      if (!loaded) return;
      setSettings(loaded as GlobalSettings);
      setPaused(loaded.automationPaused ?? true);
    });
  }, []);

  const toggleAutomation = useCallback(async () => {
    if (!settings) return;
    setToggling(true);
    setMessage(null);
    try {
      const next = !paused;
      const updated = { ...settings, automationPaused: next };
      await saveGlobalSettings(updated);
      setSettings(updated);
      setPaused(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update automation.");
    } finally {
      setToggling(false);
    }
  }, [settings, paused]);

  const runNow = useCallback(async () => {
    setRunning(true);
    setMessage(null);
    try {
      await callRunResearchQueue();
      setMessage("Research run finished.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not run research.");
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-medium text-slate-900">SDR engine</p>
          <p className="mt-1 flex items-center gap-2 text-[13px] text-slate-500">
            <span className={cn("size-2 rounded-full", paused ? "bg-slate-300" : "bg-emerald-500")} />
            {settings === null ? "Loading…" : paused ? "Automation paused" : "Automation running"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void toggleAutomation()} disabled={toggling || !settings}>
            {toggling ? (
              <Loader2 className="size-4 animate-spin" />
            ) : paused ? (
              <Play className="size-4" />
            ) : (
              <Pause className="size-4" />
            )}
            {paused ? "Resume automation" : "Pause automation"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void runNow()} disabled={running}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
            {running ? "Running…" : "Run research now"}
          </Button>
        </div>
      </div>

      {message && <p className="mt-3 text-[13px] text-slate-500">{message}</p>}
    </div>
  );
}
