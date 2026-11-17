"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBusiness } from "@/lib/context/business-context";
import { callPurgeBusinessData, getCallableErrorMessage } from "@/lib/firebase/functions";
import { invalidateReadCache } from "@/lib/sdr/query-cache";

/**
 * Empties a business's prospecting data without touching how it is set up.
 *
 * This exists for the state every test workspace reaches: hundreds of companies
 * from trial runs, drafts written against an offer that has since changed, a
 * campaign nobody remembers starting. Deleting the business and rebuilding it
 * would work, but it also throws away the offers, knowledge base, sender and
 * API keys that took real effort to get right.
 *
 * The name has to be retyped. A one-click button for an irreversible bulk
 * delete is a button that eventually gets clicked by accident.
 */
export function ResetDataPanel() {
  const { workspaceId, currentBusiness, currentBusinessId, reloadBusinesses } = useBusiness();
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ total: number; unassigned: number } | null>(null);

  const name = currentBusiness?.name ?? "";
  const matches = confirmName.trim().toLowerCase() === name.trim().toLowerCase() && name.length > 0;

  const purge = async () => {
    if (!currentBusinessId || !matches) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await callPurgeBusinessData({
        workspaceId: workspaceId || "ws_default",
        businessId: currentBusinessId,
        confirmName
      });
      setDone({ total: result.total, unassigned: result.unassignedDeleted });
      setConfirmName("");
      // Every screen's numbers just changed; nothing cached may survive.
      invalidateReadCache();
      await reloadBusinesses();
    } catch (err) {
      setError(getCallableErrorMessage(err, "The purge did not complete."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Start this business over</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          Deletes everything {name || "this business"} has prospected — companies, contacts, drafts,
          conversations, meetings, campaigns and history — and keeps the way it is set up.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-rose-700">Deleted</p>
          <ul className="mt-2 space-y-1 text-[13px] text-rose-900/80">
            <li>Companies and contacts</li>
            <li>Drafts, sent messages and replies</li>
            <li>Meetings and campaigns</li>
            <li>Research, evidence and activity history</li>
          </ul>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">Kept</p>
          <ul className="mt-2 space-y-1 text-[13px] text-slate-600">
            <li>Your business, offers and knowledge</li>
            <li>Autonomy, sender and API keys</li>
            <li>
              <span className="font-medium text-slate-800">The do-not-contact list</span> — people who
              asked never to be contacted stay suppressed
            </li>
            <li>Your API spend history</li>
          </ul>
        </div>
      </div>

      {done && (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          <Check className="mt-0.5 size-4 shrink-0" />
          <span>
            {done.total.toLocaleString("en")} documents deleted
            {done.unassigned > 0 && (
              <>
                {" "}
                (including {done.unassigned.toLocaleString("en")} left over from earlier runs that
                carried no business)
              </>
            )}
            . Your settings are untouched.
          </span>
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</p>
      )}

      <div className="rounded-xl border border-rose-200 p-4">
        <label htmlFor="purge-confirm" className="flex items-start gap-2 text-[13px] text-slate-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" />
          <span>
            This cannot be undone. Type <span className="font-semibold text-slate-900">{name}</span> to
            confirm.
          </span>
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            id="purge-confirm"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            placeholder={name}
            disabled={busy || !currentBusinessId}
            className="max-w-xs"
            autoComplete="off"
          />
          <Button variant="destructive" onClick={() => void purge()} disabled={!matches || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {busy ? "Deleting…" : "Delete prospecting data"}
          </Button>
        </div>
      </div>
    </div>
  );
}
