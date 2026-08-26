"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBusiness } from "@/lib/context/business-context";
import { useAttentionCount } from "@/lib/sdr/use-attention-count";
import { ATTENTION_COUNT_CAP } from "@/lib/firebase/firestore";
import {
  advancedNavItem,
  advancedNavItems,
  primaryNavItems,
  settingsNavItem
} from "@/lib/constants/navigation";
import { BusinessSwitcher } from "@/components/layout/business-switcher";

export function AppSidebar() {
  const pathname = usePathname();
  const { currentBusiness, workspaceId } = useBusiness();
  const attentionCount = useAttentionCount(workspaceId || "ws_default", currentBusiness?.id);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const advancedActive = useMemo(
    () => isActive(advancedNavItem.href) || advancedNavItems.some((item) => isActive(item.href)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname]
  );

  // Keep Advanced expanded while the user is inside one of its pages.
  useEffect(() => {
    if (advancedActive) setAdvancedOpen(true);
  }, [advancedActive]);


  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-slate-200 bg-white md:flex"
      style={{ width: "var(--sidebar-width, 240px)" }}
    >
      <div className="border-b border-slate-100 p-3">
        <BusinessSwitcher />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {primaryNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const showBadge = item.href === "/app/inbox" && attentionCount > 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-10 items-center justify-between rounded-lg px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <span className="flex items-center gap-3">
                <Icon className={cn("size-[18px] shrink-0", active ? "text-white" : "text-slate-400")} />
                {item.label}
              </span>
              {showBadge && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-bold",
                    active ? "bg-white text-slate-900" : "bg-rose-100 text-rose-700"
                  )}
                >
                  {attentionCount >= ATTENTION_COUNT_CAP ? `${ATTENTION_COUNT_CAP}+` : attentionCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-slate-100 px-3 py-3">
        <Link
          href={settingsNavItem.href}
          className={cn(
            "flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
            isActive(settingsNavItem.href)
              ? "bg-slate-100 text-slate-900"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          )}
        >
          <settingsNavItem.icon className="size-[18px] shrink-0 text-slate-400" />
          {settingsNavItem.label}
        </Link>

        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          className="flex h-9 w-full items-center justify-between rounded-lg px-3 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <span className="flex items-center gap-3">
            <advancedNavItem.icon className="size-[18px] shrink-0 text-slate-400" />
            {advancedNavItem.label}
          </span>
          <ChevronDown className={cn("size-4 transition-transform", advancedOpen && "rotate-180")} />
        </button>

        {advancedOpen && (
          <div className="space-y-0.5 pb-1 pl-6">
            {advancedNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "block rounded-md px-3 py-1.5 text-[13px] transition-colors",
                  isActive(item.href)
                    ? "bg-slate-100 font-medium text-slate-900"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
