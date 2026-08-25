"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart2,
  Building2,
  CalendarCheck,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  ScrollText,
  Settings,
  Target,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Navigation ordered like a workflow ─────────────────────
const STEPS = [
  {
    group: "OVERVIEW",
    items: [
      { label: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    group: "STEP 1 — FIND",
    items: [
      { label: "Campaigns", href: "/app/discovery", icon: Target },
      { label: "Companies", href: "/app/companies", icon: Building2 },
      { label: "Contacts", href: "/app/contacts", icon: Users },
    ],
  },
  {
    group: "STEP 2 — RESEARCH",
    items: [
      { label: "AI Research", href: "/app/research", icon: FlaskConical },
    ],
  },
  {
    group: "STEP 3 — REACH OUT",
    items: [
      { label: "Outreach", href: "/app/outreach", icon: Inbox },
    ],
  },
  {
    group: "RESULTS",
    items: [
      { label: "Meetings", href: "/app/meetings", icon: CalendarCheck },
      { label: "Analytics", href: "/app/analytics", icon: BarChart2 },
    ],
  },
];

const BOTTOM = [
  { label: "Settings", href: "/app/settings", icon: Settings },
  { label: "Logs", href: "/app/logs", icon: ScrollText },
];

export function AppSidebar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 flex flex-col bg-white border-r border-slate-200"
      style={{ width: "var(--sidebar-width, 220px)" }}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 border-b border-slate-100 px-4">
        <div className="flex size-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
          <span className="text-[11px] font-bold">DS</span>
        </div>
        <div>
          <p className="text-[13px] font-semibold text-slate-800">Devcomm OS</p>
          <p className="text-[10px] text-slate-400">Sales Automation</p>
        </div>
      </div>

      {/* Workflow navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {STEPS.map((section) => (
          <div key={section.group}>
            <p className="mb-1 px-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">
              {section.group}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                      active
                        ? "bg-blue-50 text-blue-700"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        active ? "text-blue-600" : "text-slate-400"
                      )}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom utilities */}
      <div className="border-t border-slate-100 px-3 py-2 space-y-0.5">
        {BOTTOM.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12px] font-medium transition-colors",
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
