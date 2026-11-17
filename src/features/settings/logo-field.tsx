"use client";

import { useRef, useState } from "react";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";

/** Formats browsers render reliably and Storage serves without transcoding. */
const ACCEPTED = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

/**
 * A logo is small by nature. The cap is here so a 12 MB camera photo becomes a
 * clear message rather than a slow upload and a sluggish sidebar on every load.
 */
const MAX_BYTES = 1024 * 1024;

/**
 * Uploads a business logo and hands back its public URL.
 *
 * Stored under the workspace and business it belongs to, so a workspace with
 * several businesses keeps them apart, and deleting one never reaches another's
 * file.
 */
export function LogoField({
  workspaceId,
  businessId,
  value,
  onChange
}: {
  workspaceId: string;
  businessId: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);

    if (!ACCEPTED.includes(file.type)) {
      setError("Use a PNG, JPG, SVG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Logos need to be under 1 MB.`);
      return;
    }
    if (!businessId) {
      setError("Save this business first, then add its logo.");
      return;
    }

    setBusy(true);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `branding/${workspaceId}/${businessId}/logo.${extension}`;
      const result = await uploadBytes(ref(storage, path), file, { contentType: file.type });
      onChange(await getDownloadURL(result.ref));
    } catch (err) {
      // Storage rules are the usual cause; say so rather than fail silently.
      setError(err instanceof Error ? err.message : "The upload did not complete.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {value ? (
            <img src={value} alt="Business logo" className="size-full object-contain" />
          ) : (
            <ImageIcon className="size-5 text-slate-300" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {value ? "Replace" : "Upload a logo"}
          </Button>

          {value && !busy && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-slate-500"
              onClick={() => onChange("")}
            >
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          )}
        </div>

        <input
          ref={input}
          type="file"
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>

      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      <p className="text-[11px] text-slate-400">
        Shown in the sidebar and as the browser tab icon. PNG, JPG, SVG or WebP, under 1 MB.
      </p>
    </div>
  );
}
