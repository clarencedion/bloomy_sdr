import type { SchedulingIntentResult, SlotProposalResult, TimeSlot } from "../types/domain.js";
import { getAvailableSlots } from "./calendar-service.js";
import { getCalendarConfig } from "./business-service.js";

export interface ProposeSlotsInput {
  workspaceId?: string;
  businessId?: string;
  schedulingIntent?: SchedulingIntentResult;
  referenceDate?: Date;
  limit?: number;
  slotDurationMinutes?: number;
  timezone?: string;
}

/**
 * Formats 2-3 verified open calendar slots into consultative French proposal copy (REQ-073).
 */
export function formatSlotsProposalFrench(slots: TimeSlot[]): string {
  if (slots.length === 0) {
    return "Je reste à votre entière disposition pour caler un échange selon vos convenances. Quelles seraient vos disponibilités ?";
  }

  const bulletList = slots.map((s) => `• ${s.formattedFr}`).join("\n");

  if (slots.length === 1) {
    return `Je vous propose d'échanger le créneau suivant :\n${bulletList}\n\nEst-ce que cela vous conviendrait ?`;
  }

  return `Je vous propose d'échanger lors de l'un de ces créneaux :\n${bulletList}\n\nLequel vous conviendrait le mieux ?`;
}

/**
 * Queries real calendar availability and proposes 2–3 conflict-free open slots matching prospect preferences (REQ-073).
 */
export async function proposeOpenSlots(input: ProposeSlotsInput = {}): Promise<SlotProposalResult> {
  const workspaceId = input.workspaceId || "ws_default";
  const businessId = input.businessId || "biz_devcomm";
  const limit = input.limit || 3;
  const slotDurationMinutes = input.slotDurationMinutes || 30;
  const refDate = input.referenceDate ? new Date(input.referenceDate) : new Date();

  // Retrieve Business timezone
  let timezone = input.timezone;
  if (!timezone) {
    try {
      const config = await getCalendarConfig(workspaceId, businessId);
      timezone = config?.timezone || "Europe/Paris";
    } catch {
      timezone = "Europe/Paris";
    }
  }

  const intent = input.schedulingIntent;
  let preferredDay: number | undefined = intent?.preferredDays?.[0];
  let preferredTimeOfDay: "morning" | "afternoon" | "any" = intent?.preferredTimeOfDay || "any";

  let startDate = new Date(refDate);
  if (intent?.nextWeek) {
    const currentDay = refDate.getDay();
    const daysUntilNextMonday = (8 - (currentDay || 7)) % 7 || 7;
    startDate.setDate(startDate.getDate() + daysUntilNextMonday);
  }

  // 1. First attempt: Query slots matching the prospect's exact preference
  let slots = await getAvailableSlots({
    workspaceId,
    businessId,
    startDate,
    slotDurationMinutes,
    limit,
    preferredDay,
    preferredTimeOfDay,
    timezone
  });

  // 2. If we don't have enough slots, broaden search to any time of day
  if (slots.length < limit && preferredTimeOfDay !== "any") {
    const broadenedSlots = await getAvailableSlots({
      workspaceId,
      businessId,
      startDate,
      slotDurationMinutes,
      limit: limit - slots.length,
      preferredDay,
      preferredTimeOfDay: "any",
      timezone
    });

    for (const slot of broadenedSlots) {
      if (!slots.some((s) => s.start === slot.start)) {
        slots.push(slot);
      }
      if (slots.length >= limit) break;
    }
  }

  // 3. If still fewer than limit, broaden to any upcoming working day
  if (slots.length < limit) {
    const anyDaySlots = await getAvailableSlots({
      workspaceId,
      businessId,
      startDate,
      slotDurationMinutes,
      limit: limit - slots.length,
      preferredTimeOfDay: "any",
      timezone
    });

    for (const slot of anyDaySlots) {
      if (!slots.some((s) => s.start === slot.start)) {
        slots.push(slot);
      }
      if (slots.length >= limit) break;
    }
  }

  // Sort slots chronologically
  slots.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const formattedProposalFr = formatSlotsProposalFrench(slots);

  return {
    slots,
    timezone,
    formattedProposalFr,
    hasConflicts: false
  };
}
