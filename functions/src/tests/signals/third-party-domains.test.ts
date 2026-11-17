import { describe, it, expect } from "vitest";
import { isThirdPartyEmail, isThirdPartyPresence } from "../../services/third-party-domains.js";

/**
 * A salon whose only web presence is a Planity/Booksy/Fresha listing has no
 * site of its own. Scraping that listing harvests the PLATFORM's addresses, so
 * outreach was being addressed to help.fr@booksy.com and jobs@fresha.com -
 * cold-pitching a booking platform's support desk instead of the salon.
 */
describe("Third-party presence detection", () => {
  it("recognises booking platforms and directories", () => {
    for (const url of [
      "https://www.planity.com/kaolya-44000-nantes",
      "https://booksy.com/fr-fr/12345_the-mane-painters",
      "https://www.fresha.com/a/salon-paris",
      "https://lsrdv.com/nm-coiffure",
      "https://www.facebook.com/salonstlaurent",
      // Recorded as two prospects' own site by the live run of 2026-11-11.
      "https://wanderboat.ai/local-businesses/france/lille/nouvel-hair",
      "https://nail.beauty.ivof.com/le-cercle-dor/"
    ]) {
      expect(isThirdPartyPresence(url), `${url} should be a third-party listing`).toBe(true);
    }
  });

  it("treats a real business domain as its own site", () => {
    for (const url of [
      "https://salonlelabo.com",
      "https://www.cyril-bazin.com/coiffeur",
      "https://coiffeur-saint-germain-des-pres-paris.fr"
    ]) {
      expect(isThirdPartyPresence(url), `${url} should be an own domain`).toBe(false);
    }
  });

  it("rejects platform email addresses as recipients", () => {
    expect(isThirdPartyEmail("help.fr@booksy.com")).toBe(true);
    expect(isThirdPartyEmail("jobs@fresha.com")).toBe(true);
    expect(isThirdPartyEmail("contact@planity.com")).toBe(true);
  });

  it("keeps a genuine prospect address", () => {
    expect(isThirdPartyEmail("contact@salonlelabo.com")).toBe(false);
    expect(isThirdPartyEmail("dessange.rdv@gmail.com")).toBe(false);
  });

  it("handles bare hosts and malformed input safely", () => {
    expect(isThirdPartyPresence("planity.com")).toBe(true);
    expect(isThirdPartyPresence("www.booksy.com")).toBe(true);
    expect(isThirdPartyPresence(undefined)).toBe(false);
    expect(isThirdPartyPresence("")).toBe(false);
    expect(isThirdPartyEmail("not-an-email")).toBe(false);
  });
});
