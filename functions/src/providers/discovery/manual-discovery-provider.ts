import type { DiscoveredCompany, DiscoverySearchInput, LeadDiscoveryProvider } from "./lead-discovery-provider.js";

export class ManualDiscoveryProvider implements LeadDiscoveryProvider {
  name = "manual";

  async searchCompanies(input: DiscoverySearchInput): Promise<DiscoveredCompany[]> {
    const city = input.cities?.[0] ?? "Nantes";
    return [
      {
        name: `${city} Test Discovery Company`,
        website: "https://test-discovery.example.fr",
        city,
        country: "France",
        nafCode: input.nafCodes?.[0] ?? "4941B",
        nafLabel: "Transports routiers de fret de proximité",
        industry: "Transport and field operations",
        employeeCount: 42,
        source: "Manual test discovery provider",
        sourceUrl: "manual://functions/discovery/test",
        sourceProvider: "manual",
        sourceId: `manual:functions:${city}:${input.keywords?.join("-") ?? "test"}`,
        sourceType: "manual",
        sourceConfidence: 0.72,
        rawProviderData: { input }
      }
    ];
  }
}
