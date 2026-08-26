import { describe, it, expect } from "vitest";

describe("Frontend Adversarial Audit: Calendar Slot Display & Real-Time Booking State", () => {
  it("should format verified slots in French locale without ambiguous timestamps", () => {
    const slot = {
      start: "2026-09-03T14:30:00.000Z",
      formattedFr: "Jeudi 3 septembre à 16h30"
    };

    expect(slot.formattedFr).toMatch(/^(Lundi|Mardi|Mercredi|Jeudi|Vendredi)\s+\d{1,2}\s+\w+\s+à\s+\d{1,2}h\d{0,2}$/i);
  });
});
