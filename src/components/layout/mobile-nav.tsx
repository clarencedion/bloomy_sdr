"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { primaryNavItems } from "@/lib/constants/navigation";
import { useBusiness } from "@/lib/context/business-context";
import { useAttentionCount } from "@/lib/sdr/use-attention-count";

/**
 * The four primary surfaces stay reachable on a phone, which is where a busy
 * owner checks meetings and approves replies.
 */
export function MobileNav() {
  const pathname = usePathname();
  const { currentBusiness, workspaceId } = useBusiness();
  const attentionCount = useAttentionCount(workspaceId || "ws_default", currentBusiness?.id);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      {primaryNavItems.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const showBadge = item.href === "/app/inbox" && attentionCount > 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
              active ? "text-slate-900" : "text-slate-400"
            )}
          >
            <Icon className="size-5" />
            {item.label}
            {showBadge && (
              <span className="absolute right-1/4 top-1.5 size-2 rounded-full bg-rose-500" aria-hidden />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
