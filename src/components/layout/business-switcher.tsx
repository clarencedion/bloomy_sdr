"use client";

import { useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { useBusiness } from "@/lib/context/business-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { CreateBusinessWizard } from "@/features/onboarding/create-business-wizard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BusinessDoc } from "@/types/firestore";

/**
 * Switching business changes offers, campaigns, conversations, meetings and
 * settings. The word "business" is used throughout - never "tenant" or
 * "workspace".
 */
export function BusinessSwitcher({ className }: { className?: string }) {
  const { businesses, currentBusiness, currentBusinessId, switchBusiness, deleteBusiness, loading } =
    useBusiness();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BusinessDoc | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteBusiness(pendingDelete.id);
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not remove this business.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-400">
        Loading…
      </div>
    );
  }

  const activeColor = currentBusiness?.branding?.primaryColor || "#0f172a";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left transition-colors hover:border-slate-300 focus:outline-none",
              className
            )}
            title="Switch business"
          >
            {/* The logo when there is one; the coloured initial is the fallback,
                so a business without branding still reads as itself. */}
            {currentBusiness?.branding?.logoUrl ? (
              <img
                src={currentBusiness.branding.logoUrl}
                alt=""
                className="size-6 shrink-0 rounded object-contain"
              />
            ) : (
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white"
                style={{ backgroundColor: activeColor }}
              >
                {currentBusiness?.name?.[0]?.toUpperCase() || "B"}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900">
              {currentBusiness?.name || "Choose a business"}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Business
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {businesses.map((business) => {
            const selected = business.id === currentBusinessId;
            const color = business.branding?.primaryColor || "#0f172a";
            return (
              <DropdownMenuItem
                key={business.id}
                onClick={() => switchBusiness(business.id)}
                className="flex cursor-pointer items-center justify-between gap-2 py-2 focus:bg-slate-50"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {business.name?.[0]?.toUpperCase() || "B"}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block truncate text-[13px]",
                        selected ? "font-semibold text-slate-900" : "text-slate-700"
                      )}
                    >
                      {business.name}
                    </span>
                    {business.branding?.tagline && (
                      <span className="block truncate text-[11px] text-slate-400">
                        {business.branding.tagline}
                      </span>
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {selected && <Check className="size-4 text-slate-900" />}
                  {businesses.length > 1 && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${business.name}`}
                      title={`Remove ${business.name}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setPendingDelete(business);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        setPendingDelete(business);
                      }}
                      className="rounded p-1 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="size-3.5" />
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setWizardOpen(true)}
            className="flex cursor-pointer items-center gap-2 py-2 text-[13px] font-medium text-slate-700 focus:bg-slate-50"
          >
            <Plus className="size-4" />
            Add business
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateBusinessWizard open={wizardOpen} onOpenChange={setWizardOpen} />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {pendingDelete?.name}?</DialogTitle>
            <DialogDescription>
              This deletes the business along with its offers, knowledge and sending identities. Companies,
              conversations and meetings already found are not deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {deleteError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setPendingDelete(null);
                setDeleteError(null);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Remove business
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
