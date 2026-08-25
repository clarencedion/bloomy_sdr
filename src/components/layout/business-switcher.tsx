"use client";

import React, { useState } from "react";
import { Check, ChevronDown, Plus, Sparkles, Building2 } from "lucide-react";
import { useBusiness } from "@/lib/context/business-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function BusinessSwitcher({ className }: { className?: string }) {
  const { businesses, currentBusiness, currentBusinessId, switchBusiness, createBusiness, offers, loading } = useBusiness();
  const [openModal, setOpenModal] = useState(false);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [website, setWebsite] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const [saving, setSaving] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createBusiness({
        name: name.trim(),
        tagline: tagline.trim(),
        website: website.trim(),
        primaryColor,
      });
      setName("");
      setTagline("");
      setWebsite("");
      setOpenModal(false);
    } catch (err) {
      console.error("Failed to create business", err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-400">
        <Building2 className="size-3.5 animate-pulse" />
        <span>Loading businesses...</span>
      </div>
    );
  }

  const activeColor = currentBusiness?.branding?.primaryColor || "#3b82f6";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-800 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 focus:outline-none",
              className
            )}
            title="Switch active business context"
          >
            <div
              className="flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white shadow-xs"
              style={{ backgroundColor: activeColor }}
            >
              {currentBusiness?.name?.[0]?.toUpperCase() || "B"}
            </div>
            <div className="flex flex-col text-left">
              <span className="max-w-[130px] truncate font-semibold leading-tight text-slate-900">
                {currentBusiness?.name || "Select Business"}
              </span>
              <span className="text-[10px] leading-tight text-slate-400">
                {offers.length} {offers.length === 1 ? "offer" : "offers"}
              </span>
            </div>
            <ChevronDown className="ml-1 size-3.5 text-slate-400" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Switch Business
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {businesses.map((biz) => {
            const isSelected = biz.id === currentBusinessId;
            const color = biz.branding?.primaryColor || "#3b82f6";
            return (
              <DropdownMenuItem
                key={biz.id}
                onClick={() => switchBusiness(biz.id)}
                className="flex items-center justify-between py-2 cursor-pointer focus:bg-slate-50"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {biz.name?.[0]?.toUpperCase() || "B"}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className={cn("truncate text-xs", isSelected ? "font-bold text-slate-900" : "text-slate-700")}>
                      {biz.name}
                    </span>
                    {biz.branding?.tagline && (
                      <span className="truncate text-[10px] text-slate-400">
                        {biz.branding.tagline}
                      </span>
                    )}
                  </div>
                </div>
                {isSelected && <Check className="size-4 shrink-0 text-blue-600" />}
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setOpenModal(true)}
            className="flex items-center gap-2 py-2 text-xs font-semibold text-blue-600 focus:bg-blue-50 focus:text-blue-700 cursor-pointer"
          >
            <Plus className="size-4" />
            <span>Add New Business...</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Add New Business Dialog */}
      <Dialog open={openModal} onOpenChange={setOpenModal}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-blue-600" />
                Add New Business
              </DialogTitle>
              <DialogDescription className="text-xs">
                Create a distinct commercial entity with its own offers, branding, sender identities, and knowledge base.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-4">
              <div className="grid gap-1.5">
                <Label htmlFor="biz-name" className="text-xs font-semibold text-slate-700">
                  Business Name *
                </Label>
                <Input
                  id="biz-name"
                  placeholder="e.g. Acme Digital Studio"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="biz-tagline" className="text-xs font-semibold text-slate-700">
                  Tagline / Subtitle
                </Label>
                <Input
                  id="biz-tagline"
                  placeholder="e.g. High-performance B2B sales automation"
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="biz-website" className="text-xs font-semibold text-slate-700">
                  Website URL
                </Label>
                <Input
                  id="biz-website"
                  placeholder="https://example.com"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="biz-color" className="text-xs font-semibold text-slate-700">
                  Branding Color
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    id="biz-color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="size-8 cursor-pointer rounded border border-slate-200 p-0.5"
                  />
                  <Input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-28 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpenModal(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving || !name.trim()}
                className="bg-blue-600 text-white hover:bg-blue-700 text-xs"
              >
                {saving ? "Creating..." : "Create Business"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
