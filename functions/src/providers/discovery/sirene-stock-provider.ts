import type { DiscoveredCompany, DiscoverySearchInput, LeadDiscoveryProvider } from "./lead-discovery-provider.js";

export class SireneStockProvider implements LeadDiscoveryProvider {
  name = "sirene_stock";

  async searchCompanies(_input: DiscoverySearchInput): Promise<DiscoveredCompany[]> {
    return [];
  }
}
