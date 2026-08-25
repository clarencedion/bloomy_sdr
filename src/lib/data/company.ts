import { serverTimestamp, type DocumentData } from "firebase/firestore";
import type { SourceType } from "@/types/firestore";
import {
  buildContactName,
  cleanString,
  defaultSource,
  extractDomain,
  normalizeCompanyName,
  normalizeEmail,
  normalizeFrenchIdentifier,
  normalizePhone,
  qualityWarnings,
  scoreQuality
} from "@/lib/data/quality";

export type CompanyInput = {
  workspaceId?: unknown;
  businessId?: unknown;
  offerId?: unknown;
  name?: unknown;
  website?: unknown;
  domain?: unknown;
  linkedinUrl?: unknown;
  siren?: unknown;
  siret?: unknown;
  address?: unknown;
  postalCode?: unknown;
  city?: unknown;
  country?: unknown;
  industry?: unknown;
  nafCode?: unknown;
  nafLabel?: unknown;
  employeeCount?: unknown;
  establishmentCount?: unknown;
  administrativeStatus?: unknown;
  description?: unknown;
  source?: unknown;
  sourceUrl?: unknown;
  sourceProvider?: SourceType;
  sourceId?: unknown;
  sourceType?: SourceType;
  rawProviderData?: unknown;
};

export type ContactInput = {
  workspaceId?: unknown;
  businessId?: unknown;
  offerId?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  fullName?: unknown;
  role?: unknown;
  email?: unknown;
  phone?: unknown;
  linkedinUrl?: unknown;
  source?: unknown;
  sourceUrl?: unknown;
  sourceType?: SourceType;
  rawProviderData?: unknown;
};


export function normalizeCompanyInput(input: CompanyInput): { data?: DocumentData; skippedReason?: string } {
  const name = cleanString(input.name);
  const normalizedName = normalizeCompanyName(name);
  if (!name || !normalizedName) {
    return { skippedReason: "Company name is required." };
  }

  const website = cleanString(input.website);
  const domain = extractDomain(input.domain) ?? extractDomain(website);
  const source = defaultSource(input.sourceType ?? "manual", cleanString(input.source), cleanString(input.sourceUrl));
  const siren = normalizeFrenchIdentifier(input.siren, 9);
  const siret = normalizeFrenchIdentifier(input.siret, 14);
  const city = cleanString(input.city);
  const sourceUrl = cleanString(input.sourceUrl);
  const sourceId = cleanString(input.sourceId);
  const warnings = qualityWarnings({ name, domain, siren, siret, sourceUrl, sourceId, address: cleanString(input.address), city, source: source.source, sourceConfidence: source.sourceConfidence });

  return {
    data: {
      ...source,
      sourceProvider: input.sourceProvider ?? input.sourceType ?? "manual",
      sourceId,
      rawProviderData: input.rawProviderData,
      name,
      normalizedName,
      website,
      domain,
      linkedinUrl: cleanString(input.linkedinUrl),
      siren,
      siret,
      address: cleanString(input.address),
      postalCode: cleanString(input.postalCode),
      city,
      country: cleanString(input.country) ?? "France",
      industry: cleanString(input.industry),
      nafCode: cleanString(input.nafCode),
      nafLabel: cleanString(input.nafLabel),
      employeeCount: typeof input.employeeCount === "number" ? input.employeeCount : undefined,
      establishmentCount: typeof input.establishmentCount === "number" ? input.establishmentCount : undefined,
      administrativeStatus: cleanString(input.administrativeStatus),
      description: cleanString(input.description),
      importedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: "imported",
      qualityScore: scoreQuality({ name, domain, siren, siret, sourceUrl, sourceId, address: cleanString(input.address), city, sourceConfidence: source.sourceConfidence }),
      dataQualityWarnings: warnings
    }
  };
}

export function normalizeContactInput(input: ContactInput, companyId: string): { data?: DocumentData; skippedReason?: string } {
  const normalizedEmail = normalizeEmail(input.email);
  const source = defaultSource(input.sourceType ?? "manual", cleanString(input.source), cleanString(input.sourceUrl));
  const firstName = cleanString(input.firstName);
  const lastName = cleanString(input.lastName);
  const fullName = cleanString(input.fullName) ?? cleanString([firstName, lastName].filter(Boolean).join(" "));
  const phone = cleanString(input.phone);
  const normalizedPhone = normalizePhone(phone);
  const warnings = normalizedEmail ? [] : (["contact_missing_email"] as const);

  if (!normalizedEmail && !fullName && !phone) {
    return { skippedReason: "Contact needs at least an email, name, or phone." };
  }

  return {
    data: {
      ...source,
      rawProviderData: input.rawProviderData,
      companyId,
      firstName,
      lastName,
      fullName: fullName ?? buildContactName({ firstName, lastName }),
      role: cleanString(input.role),
      email: normalizedEmail,
      normalizedEmail,
      phone,
      normalizedPhone,
      linkedinUrl: cleanString(input.linkedinUrl),
      status: normalizedEmail ? "new" : "invalid",
      emailVerified: false,
      doNotContact: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      qualityScore: normalizedEmail ? 75 : 35,
      dataQualityWarnings: [...warnings]
    }
  };
}
