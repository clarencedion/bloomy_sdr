import type { DiscoveredCompany, DiscoverySearchInput, LeadDiscoveryProvider } from "./lead-discovery-provider.js";

export class SireneDiscoveryProvider implements LeadDiscoveryProvider {
  name = "sirene";

  async searchCompanies(_input: DiscoverySearchInput): Promise<DiscoveredCompany[]> {
    return [];
  }
}
