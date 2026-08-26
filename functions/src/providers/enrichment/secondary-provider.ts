import type { EnrichedContact, EnrichmentProvider } from "./enrichment-provider.js";

/**
 * Pluggable secondary enrichment adapter (e.g. Apollo, Prospeo, or external registry)
 * Used in the contact discovery waterfall when Dropcontact returns 0 contacts.
 */
export class SecondaryEnrichmentProvider implements EnrichmentProvider {
  readonly name = "secondary_provider";

  constructor(
    readonly apiKey?: string,
    private readonly customFetcher?: (input: {
      companyName: string;
      domain?: string;
      siren?: string;
      siret?: string;
    }) => Promise<EnrichedContact[]>
  ) {}

  async findContactsForCompany(input: {
    companyName: string;
    domain?: string;
    siren?: string;
    siret?: string;
  }): Promise<EnrichedContact[]> {
    if (this.customFetcher) {
      return this.customFetcher(input);
    }

    // Default fallback adapter: returns empty list if no custom provider API configured
    return [];
  }
}
