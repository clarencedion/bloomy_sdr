"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBusiness } from "@/lib/context/business-context";
import { cn } from "@/lib/utils";

type AutonomyMode = "manual" | "assisted" | "autonomous_safe";

/**
 * Autonomy expressed as a choice a business owner can actually make.
 * The value maps directly to `business.automationPolicy.mode`, which the reply
 * dispatcher reads when deciding whether to send a reply on its own.
 */
const MODES: Array<{ id: AutonomyMode; title: string; description: string }> = [
  {
    id: "manual",
    title: "Draft only",
    description: "Your SDR writes everything and waits for you to approve it. Nothing is sent on its own."
  },
  {
    id: "assisted",
    title: "Assisted",
    description: "Sends first emails automatically, and asks you before answering important replies."
  },
  {
    id: "autonomous_safe",
    title: "Autonomous",
    description:
      "Handles straightforward conversations on its own, and still asks you whenever it is unsure."
  }
];

export function AutonomySettings() {
  const { currentBusiness, updateCurrentBusiness } = useBusiness();
  const [mode, setMode] = useState<AutonomyMode>("assisted");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentBusiness?.automationPolicy?.mode) {
      setMode(currentBusiness.automationPolicy.mode);
    }
  }, [currentBusiness?.automationPolicy?.mode]);

  const handleSave = async () => {
    if (!currentBusiness) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateCurrentBusiness({
        automationPolicy: {
          ...currentBusiness.automationPolicy,
          mode,
          // "Draft only" must also stop first emails going out unattended.
          requireApprovalBeforeSend: mode === "manual"
        }
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your choice.");
    } finally {
      setSaving(false);
    }
  };

  const dirty = mode !== (currentBusiness?.automationPolicy?.mode ?? "assisted");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">How independently should your SDR work?</h2>
        <p className="mt-1.5 text-[13px] text-slate-500">
          This applies to {currentBusiness?.name ?? "this business"}. You can change it at any time.
        </p>
      </div>

      <div className="space-y-3" role="radiogroup" aria-label="SDR autonomy">
        {MODES.map((option) => {
          const selected = mode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setMode(option.id);
                setSaved(false);
              }}
              className={cn(
                "flex w-full gap-3 rounded-xl border p-4 text-left transition-colors",
                selected ? "border-slate-900 bg-white" : "border-slate-200 bg-white hover:border-slate-300"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  selected ? "border-slate-900 bg-slate-900" : "border-slate-300"
                )}
                aria-hidden
              >
                {selected && <span className="size-1.5 rounded-full bg-white" />}
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-slate-900">{option.title}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-slate-500">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => void handleSave()} disabled={saving || !dirty || !currentBusiness}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
        {saved && !dirty && (
          <span className="flex items-center gap-1.5 text-[13px] text-emerald-600">
            <Check className="size-4" />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
