import { describe, it, expect } from "vitest";
import { isDeterministicOutOfOffice, classifyReply } from "../../services/reply-classifier.js";

describe("Out of Office (OOO) Classification (REQ-063)", () => {
  it("should detect French and English out-of-office subject patterns deterministically", () => {
    const oooSubjects = [
      "Automatic reply: Diagnostic pour votre entreprise",
      "Auto-reply: Re: Optimisation de votre site",
      "Out of office: Proposition de rendez-vous",
      "Absence du bureau: Diagnostic Devcomm",
      "Réponse automatique : Je suis absent",
      "Congés annuels : retour le 1er septembre",
      "Message automatisé : En déplacement"
    ];

    for (const subject of oooSubjects) {
      const isOoo = isDeterministicOutOfOffice({ subject, bodyText: "" });
      expect(isOoo, `Expected subject "${subject}" to trigger OOO classification`).toBe(true);
    }
  });

  it("should detect out-of-office body patterns", () => {
    const oooBodies = [
      "Je suis actuellement absent du bureau jusqu'au 25 août inclus.",
      "I am currently out of the office on leave with limited access to email.",
      "Merci de noter que je suis en congés. En cas d'urgence, veuillez contacter mon collègue."
    ];

    for (const body of oooBodies) {
      const isOoo = isDeterministicOutOfOffice({ bodyText: body });
      expect(isOoo, `Expected body "${body}" to trigger OOO classification`).toBe(true);
    }
  });

  it("should classify OOO emails with 100% confidence and suggestedAction 'ignore_auto_reply'", async () => {
    const res = await classifyReply({
      leadEmail: "vacation-lead@example.com",
      subject: "Automatic reply: Diagnostic pour votre entreprise",
      bodyText: "Je suis absent du bureau jusqu'à lundi prochain. Merci de contacter le support."
    });

    expect(res.intent).toBe("OUT_OF_OFFICE");
    expect(res.confidence).toBe(1.0);
    expect(res.suggestedAction).toBe("ignore_auto_reply");
    expect(res.requiresHumanAttention).toBe(false);
  });
});
