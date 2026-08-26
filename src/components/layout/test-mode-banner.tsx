"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

interface TestModeBannerProps {
  /** Whether outbound sending is currently restricted to the safety allowlist. */
  testModeEnabled?: boolean;
  allowlist?: string[];
}

/**
 * A single quiet line confirming that real sending is still locked.
 *
 * It renders ONLY while safe mode is on — an owner running for real should not
 * see a testing bar at all. Turning the lock off, managing the allowlist and
 * running the simulation all live in Settings, so a two-click path to
 * disabling send safety is never exposed from a primary screen.
 */
export function TestModeBanner({ testModeEnabled = false, allowlist = [] }: TestModeBannerProps) {
  if (!testModeEnabled) return null;

  return (
    <div
      className="sticky top-0 z-40 flex h-9 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 text-amber-900"
      style={{ marginLeft: "var(--sidebar-width, 0px)" }}
    >
      <span className="flex items-center gap-2 text-[12px]">
        <ShieldCheck className="size-3.5 shrink-0 text-amber-600" />
        <span className="font-medium">Safe mode</span>
        <span className="hidden sm:inline text-amber-800/80">
          Your SDR can only email {allowlist.length} approved{" "}
          {allowlist.length === 1 ? "address" : "addresses"}. No prospect will be contacted.
        </span>
      </span>

      <Link
        href="/app/settings"
        className="shrink-0 text-[12px] font-medium underline underline-offset-2 hover:text-amber-950"
      >
        Change
      </Link>
    </div>
  );
}
