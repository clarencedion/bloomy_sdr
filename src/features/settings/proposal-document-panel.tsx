"use client";

import { useEffect, useState } from "react";
import { Check, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useBusiness } from "@/lib/context/business-context";
import { cn } from "@/lib/utils";

/**
 * What the attached document should argue, written the way the campaign brief is.
 *
 * The document's shape is fixed — headline, opening, why us, the challenges we
 * expect, what we would do, a closing invitation. What belongs in those sections
 * is not: a web studio argues from a speed audit, a sales-training consultancy
 * argues from the gap between a prospect's current commercial setup and what a
 * trained team produces. A form could not hold both, so this is free text.
 *
 * The brief reaches the same generation that writes the email, so the document
 * is grounded in the same researched facts rather than assembled separately.
 */
const PLACEHOLDER = `Exemple, pour un cabinet de formation commerciale :

Ce document s'adresse au dirigeant ou au directeur commercial.
Pars de ce qu'on sait de leur activité et de leur équipe, et montre
concrètement ce qu'une force de vente formée changerait chez eux :
ce qu'ils perdent aujourd'hui, ce que ça représente sur un an.

Reste factuel. Pas de chiffre inventé — si on ne connaît pas leur
effectif commercial, parle en proportion plutôt qu'en euros.
Termine sur une première étape simple, pas sur un devis.`;

export function ProposalDocumentPanel() {
  const { currentBusiness, updateCurrentBusiness } = useBusiness();
  const [brief, setBrief] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBrief(currentBusiness?.proposalDocument?.brief ?? "");
    setEnabled(currentBusiness?.proposalDocument?.enabled !== false);
  }, [currentBusiness?.proposalDocument?.brief, currentBusiness?.proposalDocument?.enabled]);

  const dirty =
    brief !== (currentBusiness?.proposalDocument?.brief ?? "") ||
    enabled !== (currentBusiness?.proposalDocument?.enabled !== false);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateCurrentBusiness({ proposalDocument: { enabled, brief: brief.trim() } });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">The document attached to each message</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          Your SDR writes a short PDF for every prospect, from the same research that grounds the email.
          Tell it what that document should argue.
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => setEnabled((on) => !on)}
        className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-slate-300"
      >
        <span
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
            enabled ? "bg-slate-900" : "bg-slate-200"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-4 rounded-full bg-white transition-all",
              enabled ? "left-[18px]" : "left-0.5"
            )}
          />
        </span>
        <span>
          <span className="block text-[14px] font-medium text-slate-900">Attach a document</span>
          <span className="block text-[13px] text-slate-500">
            {enabled
              ? "Every message carries a PDF written for that company."
              : "Messages go out on their own, with no attachment."}
          </span>
        </span>
      </button>

      {enabled && (
        <>
          <div>
            <label htmlFor="proposal-brief" className="text-[13px] font-medium text-slate-900">
              What should it say?
            </label>
            <Textarea
              id="proposal-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={PLACEHOLDER}
              rows={12}
              className="mt-2 text-[13px] leading-relaxed"
            />
            <p className="mt-2 text-[12px] text-slate-500">
              Write it as you would brief a new salesperson. Leave it empty and the document simply
              summarises the opportunity.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-slate-600">
              <FileText className="size-3.5" />
              What it already knows about each company
            </p>
            <ul className="mt-2 grid gap-1 text-[13px] text-slate-600 sm:grid-cols-2">
              <li>Their name, town, trade and size</li>
              <li>Their website and what it scored</li>
              <li>Everything the research found</li>
              <li>Your offer, proof points and pricing rules</li>
            </ul>
            <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
              It may only use what is actually there. A figure it was not given is one it will not
              invent — so an instruction like &quot;quantify their lost revenue&quot; produces a
              proportion rather than a number, unless the research found one.
            </p>
          </div>
        </>
      )}

      {error && <p className="text-[13px] text-rose-600">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {saving ? "Saving…" : "Save"}
        </Button>
        {saved && (
          <span className="flex items-center gap-1.5 text-[13px] text-emerald-700">
            <Check className="size-4" />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
