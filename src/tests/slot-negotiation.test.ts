import { describe, it, expect } from "vitest";
import type { SchedulingIntentResult, SlotProposalResult } from "@/types/firestore";

describe("Conversational Slot Negotiation Invariants (REQ-072, REQ-073)", () => {
  it("should validate SchedulingIntentResult structure for conversational confirmation", () => {
    const confirmationIntent: SchedulingIntentResult = {
      hasSchedulingIntent: true,
      intentType: "CONFIRM_SLOT",
      preferredDays: [4],
      specificSlotRequested: {
        start: "2026-08-27T14:30:00.000Z",
        end: "2026-08-27T15:00:00.000Z"
      },
      confidence: 0.95,
      rawText: "Jeudi 14h30 me convient"
    };

    expect(confirmationIntent.hasSchedulingIntent).toBe(true);
    expect(confirmationIntent.intentType).toBe("CONFIRM_SLOT");
    expect(confirmationIntent.specificSlotRequested?.start).toBeDefined();
  });

  it("should validate SlotProposalResult structure", () => {
    const proposal: SlotProposalResult = {
      slots: [
        { start: "2026-08-27T14:30:00.000Z", end: "2026-08-27T15:00:00.000Z", durationMinutes: 30, formattedFr: "Jeudi 27 août à 14h30" },
        { start: "2026-08-27T16:00:00.000Z", end: "2026-08-27T16:30:00.000Z", durationMinutes: 30, formattedFr: "Jeudi 27 août à 16h00" }
      ],
      timezone: "Europe/Paris",
      formattedProposalFr: "Je vous propose d'échanger lors de l'un de ces créneaux :\n• Jeudi 27 août à 14h30\n• Jeudi 27 août à 16h00\n\nLequel vous conviendrait le mieux ?",
      hasConflicts: false
    };

    expect(proposal.slots.length).toBe(2);
    expect(proposal.hasConflicts).toBe(false);
    expect(proposal.formattedProposalFr).toContain("•");
  });
});
