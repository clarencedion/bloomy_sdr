export type EnrichedContact = {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  emailQualification?: "verified" | "guessed" | "uncertain";
  phone?: string;
  jobTitle?: string;
  civility?: string;
  confidence?: number;
  source: string;
};

export interface EnrichmentProvider {
  readonly name: string;
  findContactsForCompany(input: {
    companyName: string;
    domain?: string;
    siren?: string;
    siret?: string;
  }): Promise<EnrichedContact[]>;
}
