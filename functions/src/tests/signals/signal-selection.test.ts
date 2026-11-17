import { describe, it, expect } from "vitest";
import { selectSignalStrategy } from "../../services/signal-selector.js";
import type { OfferDoc } from "../../types/domain.js";

/**
 * A campaign that never enables `pagespeed` cannot detect a slow site, which is
 * the measurable half of a website-modernisation pitch. Equally, an operator who
 * declared `requiredSignals` on the offer has stated intent that keyword
 * inference must not quietly drop.
 */
describe("Signal selection", () => {
  const websiteOffer = {
    name: "Site web & réservation en ligne pour salons de coiffure",
    description: "Création d'un site vitrine moderne et rapide, optimisé mobile.",
    valuePropositions: ["Un site moderne et rapide, pensé pour le mobile"],
    targetPersonas: [{ title: "Gérant", priority: 1, keywords: ["gérant"] }],
    proofPoints: [],
    prohibitedPromises: []
  } as unknown as Partial<OfferDoc>;

  it("enables the speed audit for a website offer", () => {
    const strategy = selectSignalStrategy({
      prompt: "Vendre des sites internet pour les coiffeurs à Paris avec un site de mauvaise qualité",
      offer: websiteOffer
    });

    expect(strategy.enabledSignalProviders).toContain("website_technical");
    expect(strategy.enabledSignalProviders, "pagespeed is required to detect a slow site").toContain(
      "pagespeed"
    );
  });

  it("honours signals explicitly required by the offer", () => {
    const strategy = selectSignalStrategy({
      // Deliberately unrelated wording so inference alone would not add these.
      prompt: "trouver des entreprises",
      offer: {
        ...websiteOffer,
        name: "Offre",
        description: "Offre générique",
        valuePropositions: [],
        scoringRules: { requiredSignals: ["website_ecommerce", "pagespeed"] }
      } as unknown as Partial<OfferDoc>
    });

    expect(strategy.enabledSignalProviders).toContain("website_ecommerce");
    expect(strategy.enabledSignalProviders).toContain("pagespeed");
  });

  it("does not duplicate a signal that inference already added", () => {
    const strategy = selectSignalStrategy({
      prompt: "refonte de site internet",
      offer: {
        ...websiteOffer,
        scoringRules: { requiredSignals: ["website_technical", "pagespeed"] }
      } as unknown as Partial<OfferDoc>
    });

    const unique = new Set(strategy.enabledSignalProviders);
    expect(unique.size).toBe(strategy.enabledSignalProviders.length);
  });

  it("stays offer-agnostic: a non-web offer gets no website audits", () => {
    const strategy = selectSignalStrategy({
      prompt: "formation et coaching commercial pour PME industrielles",
      offer: {
        name: "Coaching commercial",
        description: "Formation des forces de vente",
        valuePropositions: ["Accélérer le cycle de vente"],
        targetPersonas: [],
        proofPoints: [],
        prohibitedPromises: []
      } as unknown as Partial<OfferDoc>
    });

    expect(strategy.enabledSignalProviders).not.toContain("pagespeed");
    expect(strategy.enabledSignalProviders).toContain("company_hiring");
  });

  it("only requests providers that actually exist", async () => {
    const { defaultSignalRegistry } = await import("../../providers/signals/signal-registry.js");
    const implemented = new Set(defaultSignalRegistry.getAll().map((p) => p.id));
    // `website_presence` is a legacy alias resolved by the registry.
    const aliased = new Set(["website_presence"]);

    const strategy = selectSignalStrategy({ prompt: "refonte site internet coiffeur", offer: websiteOffer });
    const unusable = strategy.enabledSignalProviders.filter(
      (id) => !implemented.has(id) && !aliased.has(id)
    );

    expect(unusable, `these signals have no provider: ${unusable.join(", ")}`).toEqual([]);
  });
});
