import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { proposeOpenSlots, formatSlotsProposalFrench } from "../../services/booking-negotiator.js";
import { setMockBusyWindows, resetCalendarMocks } from "../../services/calendar-service.js";

describe("Conflict-Free Slot Proposer (REQ-073)", () => {
  beforeEach(() => {
    resetCalendarMocks();
  });

  afterEach(() => {
    resetCalendarMocks();
  });

  const refDate = new Date("2026-08-24T09:00:00Z"); // Monday

  it("should propose 2-3 concrete open slots formatted in French", async () => {
    const proposal = await proposeOpenSlots({
      referenceDate: refDate,
      limit: 3
    });

    expect(proposal.slots.length).toBe(3);
    expect(proposal.formattedProposalFr).toContain("•");
    expect(proposal.hasConflicts).toBe(false);

    for (const slot of proposal.slots) {
      expect(slot.formattedFr).toMatch(/^[A-ZÀ-ÿa-z]+\s+\d+\s+[A-ZÀ-ÿa-z]+\s+à\s+\d{1,2}h\d{2}$/u);
    }
  });

  it("should filter out conflicting slots and propose alternative free windows", async () => {
    // Block Thursday afternoon from 13:00 to 18:00
    const thursdayAfternoonStart = new Date("2026-08-27T13:00:00Z");
    const thursdayAfternoonEnd = new Date("2026-08-27T18:00:00Z");

    setMockBusyWindows([
      {
        start: thursdayAfternoonStart,
        end: thursdayAfternoonEnd,
        subject: "Busy Workshop"
      }
    ]);

    const proposal = await proposeOpenSlots({
      referenceDate: refDate,
      schedulingIntent: {
        hasSchedulingIntent: true,
        intentType: "PROPOSE_SLOTS",
        preferredDays: [4], // Thursday
        preferredTimeOfDay: "afternoon",
        confidence: 0.9,
        rawText: "Dispo jeudi aprem"
      },
      limit: 3
    });

    // Since Thursday afternoon was busy, the negotiator broadens to other available slots
    expect(proposal.slots.length).toBeGreaterThan(0);

    for (const slot of proposal.slots) {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(slot.end);
      // Assert no slot falls in the Thursday afternoon busy window
      const overlaps = slotStart < thursdayAfternoonEnd && slotEnd > thursdayAfternoonStart;
      expect(overlaps).toBe(false);
    }
  });

  it("should format proposal text appropriately for 1, 2 or 3 slots", () => {
    const sampleSlots = [
      { start: "2026-08-27T14:00:00Z", end: "2026-08-27T14:30:00Z", durationMinutes: 30, formattedFr: "Jeudi 27 août à 14h00" },
      { start: "2026-08-27T16:00:00Z", end: "2026-08-27T16:30:00Z", durationMinutes: 30, formattedFr: "Jeudi 27 août à 16h00" }
    ];

    const text = formatSlotsProposalFrench(sampleSlots);
    expect(text).toContain("Jeudi 27 août à 14h00");
    expect(text).toContain("Jeudi 27 août à 16h00");
    expect(text).toContain("Lequel vous conviendrait le mieux ?");
  });
});
