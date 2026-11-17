"use client";

import { useEffect } from "react";
import { useBusiness } from "@/lib/context/business-context";

/**
 * Makes the browser tab belong to the business, not to the tool.
 *
 * The title and icon were fixed in the root metadata ("Devcomm Sales OS"), so
 * every customer's tab advertised the vendor. An owner running their own
 * prospecting should see their own name there, and someone with several tabs
 * open needs to tell two businesses apart at a glance.
 *
 * Set from the client because the business is chosen after login and can be
 * switched without navigating; Next's static metadata cannot express that.
 * Renders nothing.
 */
export function WorkspaceBranding() {
  const { currentBusiness, loading } = useBusiness();

  const name = currentBusiness?.name?.trim();
  const logo = currentBusiness?.branding?.logoUrl?.trim();

  useEffect(() => {
    // Wait for the real value rather than flashing the fallback first.
    if (loading) return;
    document.title = name ? `${name} — SDR` : "SDR";
  }, [name, loading]);

  useEffect(() => {
    if (loading || !logo) return;

    const existing = document.querySelector('link[rel="icon"]');
    const link =
      existing instanceof HTMLElement && "href" in existing
        ? (existing as HTMLAnchorElement)
        : (document.head.appendChild(
            Object.assign(document.createElement("link"), { rel: "icon" })
          ) as unknown as HTMLAnchorElement);

    const previous = link.href;
    link.href = logo;

    // Restore on unmount so switching business never leaves a stale icon.
    return () => {
      if (previous) link.href = previous;
    };
  }, [logo, loading]);

  return null;
}
