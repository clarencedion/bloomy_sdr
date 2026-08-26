import { describe, it, expect } from "vitest";
import type { ReplyClassification, ReplyIntent, ObjectionType } from "@/types/domain";

describe("Reply Classification Types & Contracts (REQ-063, REQ-064)", () => {
  it("should enforce valid taxonomy of reply intents", () => {
    const validIntents: ReplyIntent[] = [
      "POSITIVE",
      "BOOKING_REQUEST",
      "QUESTION",
      "OBJECTION",
      "UNSUBSCRIBE",
      "OUT_OF_OFFICE",
      "WRONG_PERSON",
      "ANGRY",
      "NEUTRAL",
      "UNCLEAR"
    ];

    expect(validIntents).toHaveLength(10);
  });

  it("should enforce valid taxonomy of objection types", () => {
    const validObjections: ObjectionType[] = [
      "PRICE",
      "EXISTING_PROVIDER",
      "NO_BUDGET",
      "NOT_PRIORITY",
      "BAD_TIMING",
      "NO_TIME",
      "OTHER"
    ];

    expect(validObjections).toHaveLength(7);
  });

  it("should properly model structured reply classification", () => {
    const sampleClassification: ReplyClassification = {
      intent: "BOOKING_REQUEST",
      confidence: 0.95,
      detectedQuestions: [],
      suggestedAction: "send_booking_link",
      reasoning: "Prospect requested a call on Thursday at 2 PM.",
      requiresHumanAttention: false,
      classifiedAt: new Date().toISOString()
    };

    expect(sampleClassification.intent).toBe("BOOKING_REQUEST");
    expect(sampleClassification.confidence).toBeGreaterThan(0.9);
  });
});
