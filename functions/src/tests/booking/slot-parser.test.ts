import { describe, it, expect } from "vitest";
import { parseSchedulingIntent } from "../../services/slot-parser.js";

describe("Conversational Slot Parser (REQ-072)", () => {
  // Use a fixed reference date: Monday 2026-08-24 09:00 Paris time
  const refDate = new Date("2026-08-24T09:00:00Z");

  it("should parse 'Je suis disponible jeudi après-midi' correctly", async () => {
    const result = await parseSchedulingIntent({
      messageText: "Bonjour, je suis disponible jeudi après-midi pour échanger.",
      referenceDate: refDate
    });

    expect(result.hasSchedulingIntent).toBe(true);
    expect(result.intentType).toBe("PROPOSE_SLOTS");
    expect(result.preferredDays).toContain(4); // Thursday = 4
    expect(result.preferredTimeOfDay).toBe("afternoon");
    expect(result.preferredDateRange).toBeDefined();
  });

  it("should parse 'Vendredi à 10h' with specific time slot", async () => {
    const result = await parseSchedulingIntent({
      messageText: "Vendredi à 10h me conviendrait bien.",
      referenceDate: refDate
    });

    expect(result.hasSchedulingIntent).toBe(true);
    expect(result.preferredDays).toContain(5); // Friday = 5
    expect(result.specificSlotRequested).toBeDefined();

    const start = new Date(result.specificSlotRequested!.start);
    expect(start.getDay()).toBe(5);
    expect(start.getHours()).toBe(10);
  });

  it("should parse 'Demain matin' relative day expression", async () => {
    const result = await parseSchedulingIntent({
      messageText: "Dispo demain matin si vous voulez faire le point.",
      referenceDate: refDate
    });

    expect(result.hasSchedulingIntent).toBe(true);
    expect(result.preferredTimeOfDay).toBe("morning");
  });

  it("should parse confirmation phrase 'Jeudi 14h30 me convient'", async () => {
    const result = await parseSchedulingIntent({
      messageText: "Jeudi 14h30 me convient parfaitement pour le call.",
      referenceDate: refDate
    });

    expect(result.hasSchedulingIntent).toBe(true);
    expect(result.intentType).toBe("CONFIRM_SLOT");
    expect(result.specificSlotRequested).toBeDefined();

    const start = new Date(result.specificSlotRequested!.start);
    expect(start.getDay()).toBe(4); // Thursday
    expect(start.getHours()).toBe(14);
    expect(start.getMinutes()).toBe(30);
  });

  it("should detect next week preference 'plutôt la semaine prochaine'", async () => {
    const result = await parseSchedulingIntent({
      messageText: "Pas possible cette semaine, plutôt la semaine prochaine mardi.",
      referenceDate: refDate
    });

    expect(result.hasSchedulingIntent).toBe(true);
    expect(result.nextWeek).toBe(true);
    expect(result.preferredDays).toContain(2); // Tuesday
  });

  it("should reject non-scheduling messages like 'Non merci, pas intéressé'", async () => {
    const result = await parseSchedulingIntent({
      messageText: "Non merci, nous ne sommes pas intéressés par vos services.",
      referenceDate: refDate
    });

    expect(result.hasSchedulingIntent).toBe(false);
    expect(result.intentType).toBe("NONE");
  });
});
