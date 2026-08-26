import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getFreeBusyWindows,
  getAvailableSlots,
  setMockBusyWindows,
  resetCalendarMocks
} from "../../services/calendar-service.js";

describe("Real-Time Calendar Free/Busy & Slot Computation (REQ-071)", () => {
  beforeEach(() => {
    resetCalendarMocks();
  });

  afterEach(() => {
    resetCalendarMocks();
  });

  it("should query free/busy windows and filter out busy periods", async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    const busyEnd = new Date(tomorrow);
    busyEnd.setHours(11, 0, 0, 0);

    setMockBusyWindows([
      {
        start: tomorrow,
        end: busyEnd,
        subject: "Client Strategy Session"
      }
    ]);

    const windows = await getFreeBusyWindows({
      startDate: new Date(tomorrow.getTime() - 24 * 60 * 60 * 1000),
      endDate: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
    });

    expect(windows.length).toBe(1);
    expect(windows[0].subject).toBe("Client Strategy Session");
    expect(windows[0].start.getTime()).toBe(tomorrow.getTime());
  });

  it("should compute open slots within working hours and exclude overlapping busy windows", async () => {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + 2);
    // Ensure baseDate is on a weekday (Mon-Fri: 1-5)
    if (baseDate.getDay() === 0) baseDate.setDate(baseDate.getDate() + 1);
    if (baseDate.getDay() === 6) baseDate.setDate(baseDate.getDate() + 2);
    baseDate.setHours(9, 0, 0, 0);

    // Busy slot from 14:00 to 15:30 on baseDate
    const busyStart = new Date(baseDate);
    busyStart.setHours(14, 0, 0, 0);
    const busyEnd = new Date(baseDate);
    busyEnd.setHours(15, 30, 0, 0);

    setMockBusyWindows([
      {
        start: busyStart,
        end: busyEnd,
        subject: "Busy Block"
      }
    ]);

    const slots = await getAvailableSlots({
      startDate: baseDate,
      endDate: new Date(baseDate.getTime() + 24 * 60 * 60 * 1000),
      slotDurationMinutes: 30,
      preferredDay: baseDate.getDay(),
      preferredTimeOfDay: "afternoon"
    });

    // Afternoon hours are 13:00 - 18:00
    // 14:00-14:30, 14:30-15:00, 15:00-15:30 are busy
    // Should have 13:00, 13:30, 15:30, 16:00, 16:30, 17:00, 17:30
    expect(slots.length).toBeGreaterThan(0);

    for (const slot of slots) {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(slot.end);
      // Assert no slot overlaps the 14:00 - 15:30 window
      const overlaps = slotStart < busyEnd && slotEnd > busyStart;
      expect(overlaps).toBe(false);
    }
  });

  it("should respect morning vs afternoon preferences", async () => {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + 2);
    if (baseDate.getDay() === 0) baseDate.setDate(baseDate.getDate() + 1);
    if (baseDate.getDay() === 6) baseDate.setDate(baseDate.getDate() + 2);

    const morningSlots = await getAvailableSlots({
      startDate: baseDate,
      endDate: new Date(baseDate.getTime() + 24 * 60 * 60 * 1000),
      preferredDay: baseDate.getDay(),
      preferredTimeOfDay: "morning"
    });

    for (const slot of morningSlots) {
      const h = new Date(slot.start).getHours();
      expect(h).toBeLessThan(12);
    }

    const afternoonSlots = await getAvailableSlots({
      startDate: baseDate,
      endDate: new Date(baseDate.getTime() + 24 * 60 * 60 * 1000),
      preferredDay: baseDate.getDay(),
      preferredTimeOfDay: "afternoon"
    });

    for (const slot of afternoonSlots) {
      const h = new Date(slot.start).getHours();
      expect(h).toBeGreaterThanOrEqual(13);
    }
  });
});
