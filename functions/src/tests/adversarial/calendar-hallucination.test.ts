import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getAvailableSlots,
  setMockBusyWindows,
  resetCalendarMocks
} from "../../services/calendar-service.js";
import { bookMeetingAtomically } from "../../services/meeting-creator.js";
import { adminDb } from "../../config/firebase.js";

describe("Adversarial Security Audit: Calendar Truth & Zero Hallucinated Slots (Invariant 6)", () => {
  beforeEach(() => {
    resetCalendarMocks();
  });

  afterEach(() => {
    resetCalendarMocks();
  });

  describe("Conflict-Free Slot Calculation", () => {
    it("should never propose a slot that overlaps with a known busy window", async () => {
      // Mock busy windows: Thursday 09:00 - 12:00 and 14:00 - 16:30
      const busy1Start = new Date("2026-09-03T09:00:00.000Z");
      const busy1End = new Date("2026-09-03T12:00:00.000Z");
      const busy2Start = new Date("2026-09-03T14:00:00.000Z");
      const busy2End = new Date("2026-09-03T16:30:00.000Z");

      setMockBusyWindows([
        { start: busy1Start, end: busy1End, subject: "Executive Board Meeting" },
        { start: busy2Start, end: busy2End, subject: "Client Workshop" }
      ]);

      const slots = await getAvailableSlots({
        startDate: new Date("2026-09-03T08:00:00.000Z"),
        endDate: new Date("2026-09-03T19:00:00.000Z"),
        preferredDay: 4, // Thursday
        limit: 10,
        minLeadHours: 0
      });

      expect(slots.length).toBeGreaterThan(0);

      // Verify that every single proposed slot is outside busy windows
      for (const slot of slots) {
        const slotStart = new Date(slot.start);
        const slotEnd = new Date(slot.end);

        const overlapsBusy1 = slotStart < busy1End && slotEnd > busy1Start;
        const overlapsBusy2 = slotStart < busy2End && slotEnd > busy2Start;

        expect(overlapsBusy1).toBe(false);
        expect(overlapsBusy2).toBe(false);
      }
    });

    it("should never propose slots on weekends or outside configured business hours (09:00 - 18:00)", async () => {
      const slots = await getAvailableSlots({
        startDate: new Date("2026-09-01T00:00:00.000Z"),
        endDate: new Date("2026-09-14T23:59:59.000Z"),
        limit: 20,
        minLeadHours: 0
      });

      for (const slot of slots) {
        const d = new Date(slot.start);
        const dayOfWeek = d.getDay();
        const hour = d.getUTCHours();

        // Must be Monday through Friday (1 to 5)
        expect(dayOfWeek).toBeGreaterThanOrEqual(1);
        expect(dayOfWeek).toBeLessThanOrEqual(5);

        // Must be between 07:00 and 18:00 UTC (9:00 - 18:00 Paris)
        expect(hour).toBeGreaterThanOrEqual(7);
        expect(hour).toBeLessThan(18);
      }
    });
  });

  describe("Atomic Double-Booking Guard", () => {
    it("should block booking attempt when real calendar slot is already occupied", async () => {
      const targetStart = new Date("2026-09-03T14:30:00.000Z");
      const targetEnd = new Date("2026-09-03T15:00:00.000Z");

      // Inject active busy window at this exact slot
      setMockBusyWindows([
        { start: targetStart, end: targetEnd, subject: "Existing Conflict" }
      ]);

      const result = await bookMeetingAtomically({
        workspaceId: "ws_default",
        businessId: "biz_devcomm",
        prospectEmail: "prospect@busy.fr",
        prospectName: "Jean Dupont",
        startTime: targetStart.toISOString(),
        endTime: targetEnd.toISOString()
      });

      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
      expect(result.error).toContain("no longer available");
      expect(result.meetingId).toBeUndefined();
    });

    it("should atomically terminate ongoing cold sequence when meeting is booked", async () => {
      const contactId = "contact_booking_victim_1";
      const prospectEmail = "booked-client@industrial-corp.fr";

      // Seed active outreach draft & conversation
      await adminDb.collection("outreach").doc("outreach_meeting_test_1").set({
        id: "outreach_meeting_test_1",
        contactId,
        status: "sent",
        generatedSubject: "Cold outreach",
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await adminDb.collection("conversations").doc("conv_meeting_test_1").set({
        id: "conv_meeting_test_1",
        contactId,
        prospectEmail,
        status: "active",
        unreadHumanAttention: true,
        updatedAt: new Date()
      });

      const openSlot = new Date("2026-09-03T11:00:00.000Z");

      const result = await bookMeetingAtomically({
        workspaceId: "ws_default",
        businessId: "biz_devcomm",
        contactId,
        conversationId: "conv_meeting_test_1",
        prospectEmail,
        prospectName: "Paul Valery",
        startTime: openSlot.toISOString()
      });

      expect(result.success).toBe(true);
      expect(result.meetingId).toBeDefined();
      expect(result.sequenceTerminated).toBe(true);

      // Verify outreach document was terminated
      const outreachSnap = await adminDb.collection("outreach").doc("outreach_meeting_test_1").get();
      expect(outreachSnap.data()?.status).toBe("meeting_booked");

      // Verify conversation document status updated
      const convSnap = await adminDb.collection("conversations").doc("conv_meeting_test_1").get();
      expect(convSnap.data()?.status).toBe("meeting_booked");
      expect(convSnap.data()?.unreadHumanAttention).toBe(false);
    });
  });
});
