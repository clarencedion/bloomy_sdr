"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBusiness } from "@/lib/context/business-context";
import { saveOfferClient, saveSenderIdentityClient } from "@/lib/firebase/firestore";
import { cn } from "@/lib/utils";
import type { BusinessDoc } from "@/types/firestore";

type CalendarProvider = BusinessDoc["calendarConfig"]["provider"];

const CALENDAR_OPTIONS: Array<{ value: CalendarProvider; label: string }> = [
  { value: "microsoft_graph", label: "Outlook / Microsoft 365" },
  { value: "google_calendar", label: "Google Calendar" },
  { value: "cal_com", label: "Cal.com" }
];

/**
 * Three questions, then the SDR is ready. Everything else a business needs
 * (knowledge base, pricing guardrails, data sources) has a sensible default and
 * can be refined later in Settings.
 */
export function CreateBusinessWizard({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { workspaceId, createBusiness, reloadOffers } = useBusiness();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [sells, setSells] = useState("");
  const [calendarProvider, setCalendarProvider] = useState<CalendarProvider>("microsoft_graph");
  const [bookingLink, setBookingLink] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("");

  const reset = () => {
    setStep(0);
    setName("");
    setSells("");
    setBookingLink("");
    setSenderEmail("");
    setSenderName("");
    setError(null);
  };

  const close = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const canContinue = step === 0 ? name.trim().length > 1 && sells.trim().length > 5 : true;

  const handleFinish = async () => {
    setSaving(true);
    setError(null);
    try {
      // One write with the whole profile. Creating first and patching after
      // would read a stale `currentBusinessId` from context and patch the
      // previously selected business instead of this one.
      const business = await createBusiness({
        name: name.trim(),
        tagline: sells.trim().slice(0, 120),
        calendarConfig: {
          provider: calendarProvider,
          ...(bookingLink.trim() ? { bookingLink: bookingLink.trim() } : {})
        },
        ...(senderEmail.trim()
          ? {
              senderConfig: {
                defaultSenderEmail: senderEmail.trim(),
                defaultSenderName: senderName.trim() || name.trim()
              }
            }
          : {})
      });

      // What they sell becomes their first offer: the SDR uses it both to
      // target companies and to write emails.
      await saveOfferClient(workspaceId, business.id, {
        name: name.trim(),
        description: sells.trim(),
        targetPersonas: [],
        valuePropositions: [],
        proofPoints: [],
        prohibitedPromises: []
      });

      if (senderEmail.trim()) {
        await saveSenderIdentityClient(workspaceId, business.id, {
          email: senderEmail.trim(),
          name: senderName.trim() || name.trim(),
          isDefault: true
        });
      }

      await reloadOffers();
      close(false);
      router.push("/app/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your business.");
    } finally {
      setSaving(false);
    }
  };

  const steps = [
    {
      title: "What does your business sell?",
      description: "Your SDR uses this to decide who to contact and what to say.",
      body: (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="biz-name">Business name</Label>
            <Input
              id="biz-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Bloomy Digital Studio"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="biz-sells">What you sell</Label>
            <Textarea
              id="biz-sells"
              value={sells}
              onChange={(event) => setSells(event.target.value)}
              placeholder="We build modern websites and online stores for independent businesses."
              className="min-h-[110px] resize-none"
            />
          </div>
        </div>
      )
    },
    {
      title: "Where can customers book meetings?",
      description: "Your SDR checks this calendar before it ever proposes a time.",
      body: (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Calendar</Label>
            <Select
              value={calendarProvider}
              onValueChange={(value) => setCalendarProvider(value as CalendarProvider)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALENDAR_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="biz-booking">Booking link (optional)</Label>
            <Input
              id="biz-booking"
              value={bookingLink}
              onChange={(event) => setBookingLink(event.target.value)}
              placeholder="https://cal.com/your-name/20min"
            />
          </div>
          <p className="text-[13px] leading-relaxed text-slate-500">
            You can connect the account itself later in Settings. Until then your SDR asks you before
            confirming any time.
          </p>
        </div>
      )
    },
    {
      title: "Which email should the SDR use?",
      description: "Every message your SDR sends comes from this address.",
      body: (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="biz-sender-email">Sending address</Label>
            <Input
              id="biz-sender-email"
              type="email"
              value={senderEmail}
              onChange={(event) => setSenderEmail(event.target.value)}
              placeholder="hello@yourbusiness.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="biz-sender-name">Sender name</Label>
            <Input
              id="biz-sender-name"
              value={senderName}
              onChange={(event) => setSenderName(event.target.value)}
              placeholder={name || "Your name"}
            />
          </div>
        </div>
      )
    }
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.description}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1.5 pb-2">
          {steps.map((_, index) => (
            <span
              key={index}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                index <= step ? "bg-slate-900" : "bg-slate-200"
              )}
            />
          ))}
        </div>

        <div className="py-2">{current.body}</div>

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((value) => value - 1)} disabled={saving}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
          ) : (
            <span />
          )}

          {isLast ? (
            <Button onClick={() => void handleFinish()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {saving ? "Setting up…" : "You're ready"}
            </Button>
          ) : (
            <Button onClick={() => setStep((value) => value + 1)} disabled={!canContinue}>
              Continue
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
