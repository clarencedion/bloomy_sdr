"use client";

import Link from "next/link";
import { advancedNavItems } from "@/lib/constants/navigation";
import { EngineControls } from "@/features/advanced/engine-controls";

/**
 * Every operational tool the product had before the simplification, preserved
 * and grouped. Nothing here is part of the normal user journey, but power users
 * and debugging still need all of it.
 */
export function AdvancedPage() {
  const groups = advancedNavItems.reduce<Record<string, typeof advancedNavItems>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-10 py-2">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Advanced</h1>
        <p className="mt-2 max-w-xl text-[15px] text-slate-500">
          Your SDR handles all of this on its own. These tools are here when you want to look under the
          hood or fix something by hand.
        </p>
      </div>

      <EngineControls />

      {Object.entries(groups).map(([group, items]) => (
        <section key={group}>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                    <Icon className="size-4 text-slate-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{item.label}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{item.description}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
