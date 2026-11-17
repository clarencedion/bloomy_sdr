"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { IcpTranslationResult } from "@/types/domain";

/**
 * Plain-language confirmation of the targeting the AI derived from the user's
 * sentence. Deliberately shows five ideas, not thirty configuration fields;
 * the full technical configuration stays behind "Advanced settings".
 */

export interface PlanOverrides {
  name?: string;
  maxCompaniesPerRun?: number;
  targetSegment?: TargetSegment;
  channels?: OutreachChannel[];
}

export type TargetSegment = "small_business" | "large_company";
export type OutreachChannel = "email" | "social_dm" | "contact_form";

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "Who" in the user's words: keywords describe the business type. */
function describeWho(plan: IcpTranslationResult): string {
  const words = plan.keywords?.filter(Boolean) ?? [];
  if (words.length) return titleCase(words.slice(0, 4).join(", "));
  return plan.campaignName || "Companies matching your description";
}

/** "Where" from cities, then departments, then regions, then nationwide. */
function describeWhere(plan: IcpTranslationResult): string {
  if (plan.cities?.length) return plan.cities.join(", ");
  if (plan.departments?.length) return plan.departments.join(", ");
  if (plan.regions?.length) return plan.regions.join(", ");
  return "France";
}

/**
 * Turns the enabled signal providers into what the SDR will look for, in the
 * user's language. Generic: driven only by the signal ids the AI selected.
 */
const SIGNAL_LANGUAGE: Record<string, string> = {
  company_registry: "Real, active businesses",
  google_places: "Strong local reputation",
  website_presence: "Weak or missing website",
  website_technical: "Slow or dated website",
  website_ecommerce: "No online ordering or booking",
  company_scale: "The right company size",
  company_hiring: "Signs of growth and hiring",
  technology_stack: "The tools they already use"
};

function describePriorities(plan: IcpTranslationResult): string[] {
  const signals = plan.researchStrategy?.enabledSignalProviders ?? [];
  const lines = signals.map((signal) => SIGNAL_LANGUAGE[signal]).filter(Boolean);
  if (lines.length) return Array.from(new Set(lines));
  return ["Real, active businesses that fit your offer"];
}

function describeContacts(plan: IcpTranslationResult): string {
  const personas = plan.targetPersonas?.filter(Boolean) ?? [];
  if (personas.length) return personas.join(" / ");
  return "Owner / Founder / Manager";
}

export function CampaignPlanReview({
  plan,
  onBack,
  onStart,
  starting,
  error
}: {
  plan: IcpTranslationResult;
  onBack: () => void;
  onStart: (overrides: PlanOverrides) => void;
  starting: boolean;
  error?: string | null;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [name, setName] = useState(plan.campaignName || "New campaign");
  const [perRun, setPerRun] = useState(15);

  // Pre-selected from what the AI understood, but always the user's call: it
  // decides how the SDR finds contacts and how much that costs.
  const [segment, setSegment] = useState<TargetSegment>(
    (plan.minEmployeeCount ?? 0) >= 20 ? "large_company" : "small_business"
  );

  // Email is always on. The other two reach businesses that publish no address
  // at all, but they carry reputational weight, so you choose them deliberately.
  const [dmEnabled, setDmEnabled] = useState(false);
  const [formEnabled, setFormEnabled] = useState(false);

  const rows = useMemo(
    () => [
      { label: "Who", value: describeWho(plan) },
      { label: "Where", value: describeWhere(plan) },
      { label: "I'll contact", value: describeContacts(plan) },
      { label: "Objective", value: "Book a 20-minute call" }
    ],
    [plan]
  );

  const priorities = useMemo(() => describePriorities(plan), [plan]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Sparkles className="size-5 text-slate-400" />
          Here&apos;s what I understood
        </h2>
        {plan.reasoningSummary && (
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-500">{plan.reasoningSummary}</p>
        )}
      </div>

      <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-1 p-4 sm:flex-row sm:gap-6">
            <dt className="w-32 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {row.label}
            </dt>
            <dd className="text-[15px] text-slate-800">{row.value}</dd>
          </div>
        ))}
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:gap-6">
          <dt className="w-32 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            I&apos;ll prioritize
          </dt>
          <dd>
            <ul className="space-y-1.5">
              {priorities.map((line) => (
                <li key={line} className="flex items-start gap-2 text-[15px] text-slate-800">
                  <span aria-hidden className="mt-1 text-emerald-600">✓</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          What kind of companies?
        </p>
        <p className="mb-3 text-[13px] text-slate-500">
          This changes how your SDR finds someone to contact.
        </p>

        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Company size">
          {(
            [
              {
                id: "small_business" as const,
                title: "Small businesses",
                detail: "Salons, shops, artisans. Uses their published contact details and phone number. No extra cost."
              },
              {
                id: "large_company" as const,
                title: "Larger companies",
                detail: "With teams and departments. Looks up the named decision maker. Uses paid lookups."
              }
            ]
          ).map((option) => {
            const selected = segment === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSegment(option.id)}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  selected ? "border-slate-900 bg-white" : "border-slate-200 bg-white hover:border-slate-300"
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-slate-900 bg-slate-900" : "border-slate-300"
                    )}
                  >
                    {selected && <span className="size-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="font-medium text-slate-900">{option.title}</span>
                </span>
                <span className="mt-1.5 block text-[13px] leading-relaxed text-slate-500">{option.detail}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          How should we reach them?
        </p>
        <p className="mb-3 text-[13px] text-slate-500">
          Many small businesses publish no email address at all.
        </p>

        <div className="space-y-2">
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <span aria-hidden className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-slate-900 bg-slate-900">
              <Check className="size-3 text-white" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-slate-900">Email</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-slate-500">
                Whenever an address can be found. Always on.
              </span>
            </span>
          </div>

          {(
            [
              {
                on: dmEnabled,
                set: setDmEnabled,
                title: "Direct message",
                detail:
                  "When they only have an Instagram or Facebook page. Your SDR writes it, you send it in one click."
              },
              {
                on: formEnabled,
                set: setFormEnabled,
                title: "Contact form",
                detail:
                  "When their site has one. Sent after you approve it — never where a CAPTCHA asks for a person."
              }
            ] as const
          ).map((option) => (
            <button
              key={option.title}
              type="button"
              role="switch"
              aria-checked={option.on}
              onClick={() => option.set(!option.on)}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                option.on ? "border-slate-900 bg-white" : "border-slate-200 bg-white hover:border-slate-300"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                  option.on ? "border-slate-900 bg-slate-900" : "border-slate-300"
                )}
              >
                {option.on && <Check className="size-3 text-white" />}
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-slate-900">{option.title}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-slate-500">{option.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={() =>
            onStart({
              name,
              maxCompaniesPerRun: perRun,
              targetSegment: segment,
              channels: [
                "email" as const,
                ...(dmEnabled ? (["social_dm"] as const) : []),
                ...(formEnabled ? (["contact_form"] as const) : [])
              ]
            })
          } disabled={starting}>
          {starting && <Loader2 className="size-4 animate-spin" />}
          {starting ? "Starting…" : "Start prospecting"}
        </Button>
        <Button variant="ghost" onClick={onBack} disabled={starting}>
          <ArrowLeft className="size-4" />
          Change my description
        </Button>
      </div>

      <div className="border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800"
        >
          Advanced settings
          <ChevronDown className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")} />
        </button>

        {advancedOpen && (
          <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-name">Campaign name</Label>
              <Input id="campaign-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-per-run">Companies per search</Label>
              <Input
                id="campaign-per-run"
                type="number"
                min={1}
                max={100}
                value={perRun}
                onChange={(event) => setPerRun(Math.max(1, Number(event.target.value) || 1))}
              />
            </div>
            <p className="text-[13px] text-slate-500 sm:col-span-2">
              Your SDR handles the rest. If you ever want to fine-tune exactly how it searches, everything
              is available under Advanced once the campaign is running.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
