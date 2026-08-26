import type { SchedulingIntentResult } from "../types/domain.js";

// Days of week mapping (0=Sunday, 1=Monday... 6=Saturday)
const FRENCH_DAYS: Record<string, number> = {
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
  dimanche: 0
};

const ENGLISH_DAYS: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0
};

const CONFIRMATION_PATTERNS = [
  /(?:me\s+convient|parfait\s+pour|c['’]est\s+bon\s+pour|ok\s+pour|d['’]accord\s+pour|va\s+pour|ça\s+marche\s+pour|ça\s+me\s+va\s+pour|valid[ée]\s+pour|je\s+confirme\s+pour|je\s+bloque|works\s+for\s+me|sounds\s+good\s+for|let['’]s\s+do|confirmed\s+for)/i,
  /(?:jeudi|vendredi|lundi|mardi|mercredi|demain)\s+(?:à\s+)?\d{1,2}(?:h|:)\d{0,2}\s*(?:me\s+convient|est\s+parfait|est\s+noté)/i
];

const SCHEDULING_INQUIRY_PATTERNS = [
  /(?:disponible|dispos?|libre|cr[ée]neau|cr[ée]neaux|disponibilit[ée]s?|rdv|rendez-vous|meeting|call|échanger|echange|point\s+t[ée]l[ée]phonique|visio|available|availability|free|slot|schedule)/i
];

const REJECTION_PATTERNS = [
  /\b(?:pas\s+int[ée]ress[ée]|pas\s+le\s+temps|ne\s+souhaite\s+pas|refuse|d[ée]cliner|not\s+interested|stop|unsubscribe)\b/i
];

export interface ParseSchedulingIntentInput {
  messageText: string;
  referenceDate?: Date;
  timezone?: string;
}

/**
 * Parses conversational scheduling intent, date preferences, and slot confirmation in French/English (REQ-072).
 */
export async function parseSchedulingIntent(
  input: ParseSchedulingIntentInput
): Promise<SchedulingIntentResult> {
  const text = (input.messageText || "").trim();
  const normalized = text.toLowerCase();
  const refDate = input.referenceDate ? new Date(input.referenceDate) : new Date();

  // Fast check: rejections or unsubscribe
  if (!text || REJECTION_PATTERNS.some((p) => p.test(normalized))) {
    return {
      hasSchedulingIntent: false,
      intentType: "NONE",
      confidence: 0.9,
      rawText: text
    };
  }

  // Check if there is any scheduling keyword
  const hasSchedulingKeywords = SCHEDULING_INQUIRY_PATTERNS.some((p) => p.test(normalized));
  const hasConfirmationKeywords = CONFIRMATION_PATTERNS.some((p) => p.test(normalized));

  // Check for day of week mentions
  const matchedDays: number[] = [];
  for (const [dayName, dayNum] of Object.entries(FRENCH_DAYS)) {
    if (new RegExp(`\\b${dayName}\\b`, "i").test(normalized)) {
      matchedDays.push(dayNum);
    }
  }
  for (const [dayName, dayNum] of Object.entries(ENGLISH_DAYS)) {
    if (new RegExp(`\\b${dayName}\\b`, "i").test(normalized) && !matchedDays.includes(dayNum)) {
      matchedDays.push(dayNum);
    }
  }

  // Check relative time words
  const mentionsTomorrow = /\b(demain|tomorrow)\b/i.test(normalized);
  const mentionsDayAfterTomorrow = /\b(après-demain|apres-demain|day after tomorrow)\b/i.test(normalized);
  const mentionsNextWeek = /\b(semaine\s+prochaine|next\s+week)\b/i.test(normalized);

  // Check time of day
  let preferredTimeOfDay: "morning" | "afternoon" | "any" = "any";
  if (/\b(matin|matin[ée]e|morning|am)\b/i.test(normalized) && !/\b(après-midi|aprem|pm)\b/i.test(normalized)) {
    preferredTimeOfDay = "morning";
  } else if (/\b(apr[èe]s-midi|aprem|afternoon|pm|fin\s+de\s+journ[ée]e|soir[ée]e)\b/i.test(normalized)) {
    preferredTimeOfDay = "afternoon";
  }

  // Check for specific time extraction (e.g. 10h, 10h30, 14h, 14h30, 10:00, 14:30, 2:30pm)
  let extractedHour: number | null = null;
  let extractedMinute = 0;

  // Match 14h, 14h30, 10h00
  const frenchTimeMatch = normalized.match(/\b(\d{1,2})h(\d{2})?\b/);
  if (frenchTimeMatch) {
    extractedHour = parseInt(frenchTimeMatch[1], 10);
    extractedMinute = frenchTimeMatch[2] ? parseInt(frenchTimeMatch[2], 10) : 0;
  } else {
    // Match 14:30, 10:00
    const colonTimeMatch = normalized.match(/\b(\d{1,2}):(\d{2})\b/);
    if (colonTimeMatch) {
      extractedHour = parseInt(colonTimeMatch[1], 10);
      extractedMinute = parseInt(colonTimeMatch[2], 10);
    } else {
      // Match 2pm, 10am
      const ampmMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
      if (ampmMatch) {
        let h = parseInt(ampmMatch[1], 10);
        const isPm = ampmMatch[3] === "pm";
        if (isPm && h < 12) h += 12;
        if (!isPm && h === 12) h = 0;
        extractedHour = h;
        extractedMinute = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
      }
    }
  }

  // Determine intent type
  const isConfirmation = hasConfirmationKeywords || (extractedHour !== null && (hasConfirmationKeywords || matchedDays.length > 0 || mentionsTomorrow));
  const isReschedule = /\b(d[ée]caler|reporter|reprogrammer|reschedule|changer\s+d['’]heure)\b/i.test(normalized);

  let intentType: "PROPOSE_SLOTS" | "CONFIRM_SLOT" | "RESCHEDULE" | "REJECT_SLOTS" | "NONE" = "NONE";
  let hasSchedulingIntent = false;

  if (isConfirmation && extractedHour !== null) {
    intentType = "CONFIRM_SLOT";
    hasSchedulingIntent = true;
  } else if (isReschedule) {
    intentType = "RESCHEDULE";
    hasSchedulingIntent = true;
  } else if (hasSchedulingKeywords || matchedDays.length > 0 || mentionsTomorrow || mentionsNextWeek || preferredTimeOfDay !== "any" || extractedHour !== null) {
    intentType = "PROPOSE_SLOTS";
    hasSchedulingIntent = true;
  }

  if (!hasSchedulingIntent) {
    return {
      hasSchedulingIntent: false,
      intentType: "NONE",
      confidence: 0.75,
      rawText: text
    };
  }

  // Calculate target date for slot / preference
  let targetDate = new Date(refDate);

  if (mentionsTomorrow) {
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (mentionsDayAfterTomorrow) {
    targetDate.setDate(targetDate.getDate() + 2);
  } else if (matchedDays.length > 0) {
    const targetDay = matchedDays[0];
    const currentDay = refDate.getDay();
    let daysAhead = targetDay - currentDay;

    if (daysAhead <= 0) {
      daysAhead += 7; // Next occurrence
    }

    if (mentionsNextWeek && daysAhead < 7) {
      daysAhead += 7;
    }

    targetDate.setDate(targetDate.getDate() + daysAhead);
  } else if (mentionsNextWeek) {
    // Jump to next Monday
    const currentDay = refDate.getDay();
    const daysUntilNextMonday = (8 - (currentDay || 7)) % 7 || 7;
    targetDate.setDate(targetDate.getDate() + daysUntilNextMonday);
  }

  let specificSlotRequested: { start: string; end: string } | undefined;

  if (extractedHour !== null) {
    targetDate.setHours(extractedHour, extractedMinute, 0, 0);
    const slotEnd = new Date(targetDate.getTime() + 30 * 60 * 1000);
    specificSlotRequested = {
      start: targetDate.toISOString(),
      end: slotEnd.toISOString()
    };
  }

  let preferredDateRange: { start: string; end: string } | undefined;
  if (preferredTimeOfDay === "morning") {
    const morningStart = new Date(targetDate);
    morningStart.setHours(9, 0, 0, 0);
    const morningEnd = new Date(targetDate);
    morningEnd.setHours(12, 0, 0, 0);
    preferredDateRange = { start: morningStart.toISOString(), end: morningEnd.toISOString() };
  } else if (preferredTimeOfDay === "afternoon") {
    const afternoonStart = new Date(targetDate);
    afternoonStart.setHours(14, 0, 0, 0);
    const afternoonEnd = new Date(targetDate);
    afternoonEnd.setHours(18, 0, 0, 0);
    preferredDateRange = { start: afternoonStart.toISOString(), end: afternoonEnd.toISOString() };
  }

  return {
    hasSchedulingIntent: true,
    intentType,
    preferredDays: matchedDays.length > 0 ? matchedDays : undefined,
    preferredTimeOfDay,
    preferredDateRange,
    specificSlotRequested,
    nextWeek: mentionsNextWeek,
    confidence: isConfirmation ? 0.95 : 0.9,
    rawText: text,
    extractedExpression: specificSlotRequested ? `${extractedHour}h${extractedMinute ? extractedMinute : ""}` : undefined
  };
}
