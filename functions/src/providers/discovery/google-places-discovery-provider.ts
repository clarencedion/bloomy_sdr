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

/**
 * The town a business is actually in, read from its postal address.
 *
 * Places is queried city by city ("tatoueur Lille"), and the search city used
 * to be stored as the company's own. It frequently is not: the engine returns
 * neighbouring towns and sometimes far-away ones. Measured on 57 real
 * companies, 5 were filed under the wrong town — a Tours studio and a Marseille
 * one both stored as "Lille", plus three suburbs recorded as their nearest big
 * city. That field is quoted back to the prospect in the email, so it has to be
 * where they are, not where we happened to look.
 *
 * French addresses end "... 37000 Tours", so the town follows the postcode.
 * Falls back to the search city when the address cannot be parsed - better a
 * rough answer than none, and the copywriter is told to prefer the address.
 */
function townFromAddress(address: string | undefined, fallback: string): string {
  const match = String(address ?? "").match(/\b\d{5}\s+([^,]+?)\s*$/);
  const town = match?.[1]?.trim();
  return town && town.length > 1 ? town : fallback;
}

export class GooglePlacesDiscoveryProvider implements LeadDiscoveryProvider {
  name = "google_places";

  async searchCompanies(input: DiscoverySearchInput): Promise<DiscoveredCompany[]> {
    const secrets = await getIntegrationSecrets();
    const apiKey = secrets.serperApiKey;
    if (!apiKey) {
      throw new Error("Serper API key not configured in integration secrets.");
    }

    // No invented search terms. A hardcoded trade and a hardcoded city used to
    // stand in here, so a campaign for tattoo studios across France silently
    // searched one city, exhausted it in a day, then returned zero results on
    // every run for the rest of its life while still reporting "active".
    // A search we cannot form is an error the caller must see, not a different
    // search performed quietly.
    const keywords = input.keywords?.filter(Boolean) ?? [];
    const cities = input.cities?.filter(Boolean) ?? [];

    if (!keywords.length) throw new Error("Google Places search needs at least one keyword.");
    if (!cities.length) throw new Error("Google Places search needs at least one city or area.");
    // Serper returns up to ~20 places per query; ask for what the caller wants.
    const limit = input.maxResults ?? 20;
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
              // Where they are, not where we searched.
              city: townFromAddress(place.address, city),
              postalCode: String(place.address ?? "").match(/\b(\d{5})\b/)?.[1],
              /** The city this result was found under, kept for diagnostics. */
              searchCity: city,
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

