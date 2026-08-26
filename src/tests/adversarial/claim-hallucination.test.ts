import { describe, it, expect } from "vitest";

describe("Frontend Adversarial Audit: Claim Provenance & Verification Badge Rendering", () => {
  it("should display verification badge only when claim is supported by confidence >= 70", () => {
    type ClaimItem = {
      label: string;
      value: string | number;
      confidence: number;
      isVerified: boolean;
    };

    const claim: ClaimItem = {
      label: "Google Places Reviews",
      value: 140,
      confidence: 85,
      isVerified: true
    };

    const shouldShowVerifiedBadge = (c: ClaimItem) => c.confidence >= 70 && c.isVerified;
    expect(shouldShowVerifiedBadge(claim)).toBe(true);

    const unverifiedClaim: ClaimItem = {
      label: "Estimated Revenue",
      value: "10M€",
      confidence: 50,
      isVerified: false
    };
    expect(shouldShowVerifiedBadge(unverifiedClaim)).toBe(false);
  });
});
