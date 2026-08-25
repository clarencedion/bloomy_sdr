import { describe, it, expect } from "vitest";
import { PlacesSignalProvider } from "../../providers/signals/places-signal-provider.js";
import type { SignalContext } from "../../providers/signals/signal-provider.js";

describe("Google Places Signal Provider (REQ-027)", () => {
  const provider = new PlacesSignalProvider();

  it("extracts commercial facts from Google Places data", async () => {
    const rawPlaceData = {
      title: "Fleuriste Le Jardin Secret",
      address: "24 Rue Crébillon, 44000 Nantes",
      phoneNumber: "+33 2 40 12 34 56",
      category: "Fleuriste",
      rating: 4.7,
      ratingCount: 142,
      cid: "12345678901234567890",
      status: "OPERATIONAL",
      website: "https://jardinsecret-nantes.fr"
    };

    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_test",
      company: {
        id: "comp_places_1",
        name: "Fleuriste Le Jardin Secret",
        city: "Nantes",
        rawProviderData: rawPlaceData
      }
    };

    expect(provider.supports(context)).toBe(true);

    const result = await provider.collect(context);
    expect(result.error).toBeUndefined();
    expect(result.providerId).toBe("google_places");
    expect(result.evidence.length).toBeGreaterThanOrEqual(6);

    const evidenceMap = new Map(result.evidence.map((e) => [e.key, e]));

    expect(evidenceMap.get("google_rating")?.value).toBe(4.7);
    expect(evidenceMap.get("google_rating")?.nature).toBe("fact");
    expect(evidenceMap.get("google_rating")?.sourceType).toBe("google_places");

    expect(evidenceMap.get("google_review_count")?.value).toBe(142);
    expect(evidenceMap.get("google_review_count")?.nature).toBe("fact");

    expect(evidenceMap.get("place_category")?.value).toBe("Fleuriste");
    expect(evidenceMap.get("operational_status")?.value).toBe("OPERATIONAL");

    expect(evidenceMap.get("google_cid")?.value).toBe("12345678901234567890");
    expect(evidenceMap.get("google_cid")?.sourceUrl).toBe("https://maps.google.com/?cid=12345678901234567890");
  });
});
