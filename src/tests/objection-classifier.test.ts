import { describe, it, expect } from "vitest";
import { ObjectionTypeSchema } from "../../functions/src/services/reply-classifier-schema.js";

describe("Objection Classifier Schema Validation (REQ-064)", () => {
  it("should validate all standard fine-grained objection categories", () => {
    const categories = [
      "PRICE",
      "EXISTING_PROVIDER",
      "NO_BUDGET",
      "NOT_PRIORITY",
      "BAD_TIMING",
      "NO_TIME",
      "OTHER"
    ];

    for (const cat of categories) {
      const parsed = ObjectionTypeSchema.safeParse(cat);
      expect(parsed.success).toBe(true);
    }
  });

  it("should reject invalid objection categories", () => {
    const invalidCat = "UNRECOGNIZED_OBJECTION_TYPE";
    const parsed = ObjectionTypeSchema.safeParse(invalidCat);
    expect(parsed.success).toBe(false);
  });
});
