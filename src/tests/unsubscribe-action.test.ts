import { describe, it, expect } from "vitest";
import { isDeterministicUnsubscribe } from "../../functions/src/services/reply-classifier.js";

describe("Deterministic Unsubscribe Action (REQ-065)", () => {
  it("should detect all French unsubscribe variations", () => {
    const expressions = [
      "Merci de me retirer de votre liste",
      "Veuillez me désabonner",
      "Ne plus me contacter svp",
      "Stop !",
      "Supprimer mes informations",
      "Retirez-moi",
      "Pas intéressé, merci de supprimer mes coordonnées"
    ];

    for (const exp of expressions) {
      expect(isDeterministicUnsubscribe({ bodyText: exp })).toBe(true);
    }
  });

  it("should not flag normal questions or positive replies as unsubscribe", () => {
    const nonUnsubExpressions = [
      "Bonjour, quel est votre prix pour une refonte ?",
      "Pouvez-vous m'appeler jeudi à 14h ?",
      "Nous travaillons déjà avec une agence à Nantes.",
      "C'est intéressant, envoyez-moi plus d'informations.",
      "Je suis absent du bureau jusqu'à lundi."
    ];

    for (const exp of nonUnsubExpressions) {
      expect(isDeterministicUnsubscribe({ bodyText: exp })).toBe(false);
    }
  });
});
