import type { DiscoveredCompany, DiscoveryCampaign } from "@/types/firestore";

export type DiscoverySearchInput = {
  campaign: DiscoveryCampaign;
  startPage?: number;
  candidateLimit?: number;
};

export interface LeadDiscoveryProvider {
  name: string;
  searchCompanies(input: DiscoverySearchInput): Promise<DiscoveredCompany[]>;
}
