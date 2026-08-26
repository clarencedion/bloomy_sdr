import { describe, it, expect } from "vitest";
import type { BusinessDoc } from "@/types/firestore";

describe("Frontend Autonomy Policy Tiers (REQ-068)", () => {
  it("should configure manual policy with requireApprovalBeforeSend", () => {
    const manualBusiness: Partial<BusinessDoc> = {
      automationPolicy: {
        mode: "manual",
        dailyOutreachLimit: 50,
        dailyDiscoveryLimit: 50,
        requireApprovalBeforeSend: true,
        autoReplySafeThreshold: 0.85
      }
    };

    expect(manualBusiness.automationPolicy?.mode).toBe("manual");
    expect(manualBusiness.automationPolicy?.requireApprovalBeforeSend).toBe(true);
  });

  it("should configure autonomous_safe policy with threshold", () => {
    const autoBusiness: Partial<BusinessDoc> = {
      automationPolicy: {
        mode: "autonomous_safe",
        dailyOutreachLimit: 100,
        dailyDiscoveryLimit: 100,
        requireApprovalBeforeSend: false,
        autoReplySafeThreshold: 0.85
      }
    };

    expect(autoBusiness.automationPolicy?.mode).toBe("autonomous_safe");
    expect(autoBusiness.automationPolicy?.autoReplySafeThreshold).toBe(0.85);
  });
});
