"use client";

import { BrainView } from "@/features/brain/brain-view";
import { useBrain } from "@/features/brain/use-brain";
import { useBusiness } from "@/lib/context/business-context";

/**
 * The SDR brain: every agent, figure and alert of the current business, live.
 * Part of the primary navigation (promoted from Advanced on 2026-11-10).
 */
export default function Page() {
  const { workspaceId, currentBusinessId, loading, loadError } = useBusiness();

  // Until the business list is known the scope is not either: stay idle rather
  // than read the whole workspace and then re-read the business.
  const ready = !loading && !loadError;
  const scopeWorkspaceId = ready ? workspaceId || "ws_default" : "";
  const scopeBusinessId = currentBusinessId || undefined;
  const brain = useBrain({ workspaceId: scopeWorkspaceId, businessId: scopeBusinessId });

  return (
    <BrainView
      // A business switch starts a fresh view: no particle, selection or filter
      // of the previous business survives into the next one.
      key={`${scopeWorkspaceId}::${scopeBusinessId ?? ""}`}
      snapshot={ready ? brain.snapshot : null}
      pulses={ready ? brain.pulses : []}
      error={loadError ? "Your businesses could not be loaded, so their activity cannot be shown." : brain.error}
    />
  );
}
