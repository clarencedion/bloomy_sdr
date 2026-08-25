import type { DiscoveredCompany, DiscoverySearchInput, LeadDiscoveryProvider } from "./lead-discovery-provider.js";
import { getIntegrationSecrets } from "../../utils/settings.js";

type SerperPlacesResult = {
  title: string;
  address?: string;
  website?: string;
  phoneNumber?: string;
  category?: string;
  rating?: number;
  ratingCount?: number;
  cid?: string;
};

export class GooglePlacesDiscoveryProvider implements LeadDiscoveryProvider {
  name = "google_places";

  async searchCompanies(input: DiscoverySearchInput): Promise<DiscoveredCompany[]> {
    const secrets = await getIntegrationSecrets();
    const apiKey = secrets.serperApiKey;
    if (!apiKey) {
      throw new Error("Serper API key not configured in integration secrets.");
    }

    const keywords = input.keywords?.length ? input.keywords : ["fleuriste"];
    const cities = input.cities?.length ? input.cities : ["Nantes"];
    const limit = input.maxResults ?? 15;
    const results: DiscoveredCompany[] = [];
    const seen = new Set<string>();

    for (const city of cities) {
      for (const keyword of keywords) {
        const query = `${keyword} ${city}`;
        try {
          const response = await fetch("https://google.serper.dev/places", {
            method: "POST",
            headers: {
              "X-API-KEY": apiKey,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ 
              q: query, 
              gl: "fr", 
              hl: "fr",
              page: input.startPage ?? 1
            })
          });

          if (!response.ok) {
            continue;
          }

          const data = (await response.json()) as { places?: SerperPlacesResult[] };
          for (const place of data.places ?? []) {
            const sourceId = place.cid ?? place.title;
            if (seen.has(sourceId)) continue;
            seen.add(sourceId);

            results.push({
              name: place.title,
              website: place.website,
              address: place.address,
              city,
              country: "France",
              industry: place.category,
              nafLabel: place.category,
              description: `Google Places category: ${place.category ?? "Unknown"}. Rating: ${place.rating ?? "N/A"} (${place.ratingCount ?? 0} reviews). Query: ${query}`,
              source: "Google Places (via Serper)",
              sourceProvider: "google_places",
              sourceId,
              sourceType: "google_places",
              sourceConfidence: 0.90,
              rawProviderData: place
            });

            if (results.length >= limit) return results;
          }
        } catch {
          // Continue to next keyword/city combination if one request fails
        }
      }
    }

    return results;
  }
}

