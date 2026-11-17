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
  /**
   * A listing page a provider returned as the "website" that is not the
   * business's own site - a booking platform, a directory, a blog post about
   * them. Kept as evidence (having no site of their own is the need we sell
   * against) but never treated as their site.
   */
  directoryUrl?: string;
  websiteRejectedReason?: string;
  siren?: string;
  siret?: string;
  city?: string;
  /**
   * The city this result was found under. Place searches run city by city and
   * routinely return neighbouring or distant towns, so this is kept separate
   * from `city` - which must be where the business actually is, because it gets
   * quoted back to them in the email.
   */
  searchCity?: string;
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
