export type DiscoverySearchInput = {
  keywords?: string[];
  cities?: string[];
  departments?: string[];
  regions?: string[];
  nafCodes?: string[];
  maxResults?: number;
  startPage?: number;
  candidateLimit?: number;
  minEmployeeCount?: number;
};

export type DiscoveryProviderName =
  | "recherche_entreprises"
  | "sirene"
  | "sirene_stock"
  | "google_places"
  | "pappers"
  | "manual"
  | "csv";

export type DiscoveredCompany = {
  name?: string;
  website?: string;
  domain?: string;
  siren?: string;
  siret?: string;
  city?: string;
  country?: string;
  industry?: string;
  postalCode?: string;
  address?: string;
  nafCode?: string;
  nafLabel?: string;
  employeeCount?: number;
  establishmentCount?: number;
  administrativeStatus?: string;
  description?: string;
  source: string;
  sourceUrl?: string;
  sourceProvider: DiscoveryProviderName;
  sourceId: string;
  sourceType: DiscoveryProviderName;
  sourceConfidence?: number;
  rawProviderData?: unknown;
};

export interface LeadDiscoveryProvider {
  name: string;
  searchCompanies(input: DiscoverySearchInput): Promise<DiscoveredCompany[]>;
}
