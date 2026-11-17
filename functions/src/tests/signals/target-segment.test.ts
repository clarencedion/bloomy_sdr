import { describe, it, expect } from "vitest";
import {
  getSegmentPolicy,
  isGenericMailbox,
  resolveTargetSegment,
  shouldSkipPaidEnrichment
} from "../../services/target-segment.js";

/**
 * The two segments fail in opposite ways. Measured on real data: 7/7 French
 * salons returned organisation-only data from paid enrichment, while their
 * published contact@ address and phone number were available for free. A large
 * company is the reverse - a generic inbox will not reach a Directeur
 * Commercial, and paid lookup works.
 */
describe("Target segment policy", () => {
  it("accepts published contact details for small businesses", () => {
    const policy = getSegmentPolicy("small_business");
    expect(policy.acceptGenericEmail).toBe(true);
    expect(policy.acceptPhoneOnly).toBe(true);
    expect(policy.usePaidContactEnrichment).toBe(false);
  });

  it("requires a named contact for large companies", () => {
    const policy = getSegmentPolicy("large_company");
    expect(policy.acceptGenericEmail).toBe(false);
    expect(policy.acceptPhoneOnly).toBe(false);
    expect(policy.usePaidContactEnrichment).toBe(true);
  });

  it("lets the operator's explicit choice win over headcount", () => {
    expect(
      resolveTargetSegment({ campaignSegment: "large_company", employeeCount: 2 })
    ).toBe("large_company");
    expect(
      resolveTargetSegment({ campaignSegment: "small_business", employeeCount: 500 })
    ).toBe("small_business");
  });

  it("falls back to headcount when no choice was made", () => {
    expect(resolveTargetSegment({ employeeCount: 3 })).toBe("small_business");
    expect(resolveTargetSegment({ employeeCount: 250 })).toBe("large_company");
  });

  it("only skips paid lookup when the prospect is KNOWN to be small", () => {
    // Explicit choice, or a real headcount below the threshold.
    expect(shouldSkipPaidEnrichment({ campaignSegment: "small_business" })).toBe(true);
    expect(shouldSkipPaidEnrichment({ employeeCount: 4 })).toBe(true);

    // Unknown headcount must NOT silently disable enrichment: that would be a
    // far worse failure than a few wasted lookups.
    expect(shouldSkipPaidEnrichment({})).toBe(false);
    expect(shouldSkipPaidEnrichment({ employeeCount: null })).toBe(false);
    expect(shouldSkipPaidEnrichment({ campaignSegment: "large_company", employeeCount: 2 })).toBe(false);
  });

  it("recognises the mailboxes that are an owner's real inbox", () => {
    for (const email of ["contact@salon.fr", "info@salon.fr", "rdv@salon.fr", "direction@pme.fr"]) {
      expect(isGenericMailbox(email), email).toBe(true);
    }
    expect(isGenericMailbox("jean.dupont@pme.fr")).toBe(false);
    expect(isGenericMailbox(undefined)).toBe(false);
  });
});
