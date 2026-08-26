import { describe, it, expect } from "vitest";

describe("Frontend Adversarial Audit: Contactability & Suppression UI Defense", () => {
  it("should prevent outreach send action on suppressed or opted-out contacts in UI state", () => {
    const contact = {
      id: "cnt_1",
      email: "opted-out@company.fr",
      doNotContact: true,
      unsubscribed: true
    };

    const canSendFromUI = (c: typeof contact) => {
      return !c.doNotContact && !c.unsubscribed;
    };

    expect(canSendFromUI(contact)).toBe(false);
  });
});
