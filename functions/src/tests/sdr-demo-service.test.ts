import { describe, it, expect } from "vitest";
import { runSdrDemoSimulation } from "../services/sdr-demo-service.js";

describe("One-Click SDR Demo Mode Simulation Service", () => {
  it("should run complete 8-stage simulation for Bloomy Digital Studio (Web/Florists)", async () => {
    const result = await runSdrDemoSimulation({
      archetype: "bloomy",
      replyScenario: "BOOKING_REQUEST"
    });

    expect(result.success).toBe(true);
    expect(result.archetype).toBe("bloomy");
    expect(result.steps.length).toBe(8);

    // Verify each stage completed
    for (const step of result.steps) {
      expect(step.status).toBe("completed");
      expect(step.logs.length).toBeGreaterThan(0);
    }

    // Verify summary
    expect(result.summary.companyName).toBe("Fleurs de Loire SAS");
    expect(result.summary.contactName).toBe("Sophie Martin");
    expect(result.summary.leadScore).toBe(88);
    expect(result.summary.intentClassified).toBe("BOOKING_REQUEST");
    expect(result.summary.meetingBooked).toBe(true);
    expect(result.summary.scheduledSlot).toBeDefined();
  });

  it("should run complete 8-stage simulation for Devcomm Consulting (B2B Sales)", async () => {
    const result = await runSdrDemoSimulation({
      archetype: "devcomm",
      replyScenario: "QUESTION"
    });

    expect(result.success).toBe(true);
    expect(result.archetype).toBe("devcomm");
    expect(result.summary.companyName).toBe("Usinage Précis de l'Ouest");
    expect(result.summary.contactName).toBe("Marc Durand");
    expect(result.summary.leadScore).toBe(85);
    expect(result.summary.intentClassified).toBe("QUESTION");
    expect(result.summary.meetingBooked).toBe(false);
  });

  it("should handle OBJECTION reply scenario gracefully", async () => {
    const result = await runSdrDemoSimulation({
      archetype: "bloomy",
      replyScenario: "OBJECTION"
    });

    expect(result.summary.intentClassified).toBe("OBJECTION");
    expect(result.steps[6].data.suggestedAction).toBe("handle_objection");
    expect(result.summary.meetingBooked).toBe(false);
  });

  it("should handle UNSUBSCRIBE reply scenario gracefully", async () => {
    const result = await runSdrDemoSimulation({
      archetype: "devcomm",
      replyScenario: "UNSUBSCRIBE"
    });

    expect(result.summary.intentClassified).toBe("UNSUBSCRIBE");
    expect(result.steps[6].data.suggestedAction).toBe("unsubscribe_contact");
    expect(result.summary.meetingBooked).toBe(false);
  });

  it("should handle OUT_OF_OFFICE auto-responder scenario", async () => {
    const result = await runSdrDemoSimulation({
      archetype: "bloomy",
      replyScenario: "OUT_OF_OFFICE"
    });

    expect(result.summary.intentClassified).toBe("OUT_OF_OFFICE");
    expect(result.steps[6].data.suggestedAction).toBe("ignore_auto_reply");
    expect(result.summary.meetingBooked).toBe(false);
  });
});
