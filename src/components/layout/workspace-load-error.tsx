"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useBusiness } from "@/lib/context/business-context";

/**
 * Says plainly that the workspace could not be read.
 *
 * The app used to answer an unreadable workspace with two hardcoded default
 * businesses, which meant every screen rendered settings the owner had never
 * saved — including an autonomy level. Failing visibly is the honest option:
 * a message the owner can act on beats a confident wrong answer.
 */
export function WorkspaceLoadError() {
  const { loadError, reloadBusinesses } = useBusiness();

  if (!loadError) return null;

  return (
    <div
      className="border-b border-rose-200 bg-rose-50 px-5 py-3"
      style={{ marginLeft: "var(--sidebar-width, 0px)" }}
      role="alert"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-rose-800">
        <AlertTriangle className="size-4 shrink-0 text-rose-600" />
        <span className="font-medium">Your workspace could not be loaded.</span>
        <span className="text-rose-700/80">
          Nothing on screen reflects your saved settings until this succeeds.
        </span>
        <button
          type="button"
          onClick={() => void reloadBusinesses()}
          className="ml-auto flex items-center gap-1.5 font-medium underline underline-offset-2 hover:text-rose-950"
        >
          <RefreshCw className="size-3.5" />
          Try again
        </button>
      </div>
    </div>
  );
}
