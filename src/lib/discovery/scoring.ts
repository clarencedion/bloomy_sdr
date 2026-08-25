import type { DiscoveredCompany, DiscoveryCampaign } from "@/types/firestore";
import { extractDomain, normalizeFrenchIdentifier, qualityWarnings, scoreQuality } from "@/lib/data/quality";
import { commercialSalesForceSignals } from "@/lib/discovery/devcomm-sales-force-template";

const segmentSignals = {
  commercial_performance: ["commercial", "sales", "business", "agence", "b2b", "saas", "logiciel", "client"],
  training_hr: ["formation", "rh", "ressources humaines", "recrutement", "talent", "skills"],
  road_safety: ["flotte", "transport", "livraison", "technicien", "maintenance", "qHSE".toLowerCase(), "prévention", "securite", "sécurité"],
  custom: []
};

export function scoreDiscoveredCompany(company: DiscoveredCompany, campaign: DiscoveryCampaign) {
  if (campaign.segment === "commercial_performance") {
    return scoreCommercialSalesForceFit(company, campaign);
  }

  const text = normalizeSearchText([company.name, company.industry, company.description, company.nafLabel, ...(campaign.keywords ?? [])].join(" "));
  const reasons: string[] = [];
  let score = 10;

  if (company.website || company.domain) {
    score += 15;
    reasons.push("has website/domain");
  }
  if (company.siren || company.siret) {
    score += 20;
    reasons.push("has SIREN/SIRET");
  }
  if (company.city && campaign.cities.map((city) => city.toLowerCase()).includes(company.city.toLowerCase())) {
    score += 10;
    reasons.push("matches target city");
  }
  if (company.employeeCount && (!campaign.minEmployeeCount || company.employeeCount >= campaign.minEmployeeCount)) {
    score += 10;
    reasons.push("matches employee threshold");
  }
  if (company.nafCode && campaignNafSet(campaign).has(normalizeNaf(company.nafCode))) {
    score += 12;
    reasons.push("matches NAF code");
  }

  const signalMatches = segmentSignals[campaign.segment].filter((signal) => text.includes(signal));
  if (signalMatches.length) {
    score += Math.min(22, signalMatches.length * 7);
    reasons.push(`segment signals: ${signalMatches.join(", ")}`);
  }

  const keywordMatches = campaign.keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
  if (keywordMatches.length) {
    score += Math.min(16, keywordMatches.length * 4);
    reasons.push(`keyword matches: ${keywordMatches.join(", ")}`);
  }

  return {
    discoveryScore: Math.min(100, score),
    discoveryReasons: reasons,
    hasSectorSignal: signalMatches.length > 0,
    hasSalesForceSignal: signalMatches.length > 0,
    hasStrongNegativeSignal: false,
    isActiveIfKnown: true
  };
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matchedTerms(text: string, terms: string[]) {
  return terms.filter((term) => text.includes(normalizeSearchText(term)));
}

function normalizeNaf(value?: string) {
  return value?.toUpperCase().replace(".", "");
}

function campaignNafSet(campaign: DiscoveryCampaign) {
  return new Set((campaign.nafCodes ?? []).map(normalizeNaf).filter(Boolean));
}

function isActiveAdministrativeStatus(value?: string) {
  const normalized = normalizeSearchText(value ?? "");
  return !normalized || normalized === "a" || normalized.includes("actif");
}

function scoreCommercialSalesForceFit(company: DiscoveredCompany, campaign: DiscoveryCampaign) {
  const text = normalizeSearchText([company.name, company.industry, company.description, company.nafLabel].join(" "));
  const explicitNafCodes = campaignNafSet(campaign);
  const normalizedCompanyNaf = normalizeNaf(company.nafCode);
  const sectorMatches = matchedTerms(text, commercialSalesForceSignals.sectorKeywords);
  const salesMatches = matchedTerms(text, commercialSalesForceSignals.salesForceKeywords);
  const proxyMatches = matchedTerms(text, commercialSalesForceSignals.proxyKeywords);
  const negativeMatches = matchedTerms(text, commercialSalesForceSignals.negativeKeywords);
  const matchedTemplateNafCodes = normalizedCompanyNaf && commercialSalesForceSignals.sectorNafCodes.has(normalizedCompanyNaf) ? [company.nafCode] : [];
  const matchedCampaignNafCodes = normalizedCompanyNaf && explicitNafCodes.has(normalizedCompanyNaf) ? [company.nafCode] : [];
  const campaignKeywordMatches = matchedTerms(text, campaign.keywords);
  const locationMatches = company.city && campaign.cities.map((city) => normalizeSearchText(city)).includes(normalizeSearchText(company.city)) ? [company.city] : [];
  const employeeSignals: string[] = [];
  const qualitySignals: string[] = [];
  const hasExplicitTargeting = Boolean(campaign.keywords.length || explicitNafCodes.size || campaign.cities.length);
  let score = 8;

  if (company.siren || company.siret) {
    score += 14;
    qualitySignals.push("has SIREN/SIRET");
  }
  if (company.sourceProvider && company.sourceId) qualitySignals.push("has sourceProvider/sourceId");
  if (company.administrativeStatus && isActiveAdministrativeStatus(company.administrativeStatus)) {
    score += 6;
    qualitySignals.push("active company");
  }

  if (sectorMatches.length) score += Math.min(24, sectorMatches.length * 6);
  if (salesMatches.length) score += Math.min(24, salesMatches.length * 6);
  if (proxyMatches.length) score += Math.min(18, proxyMatches.length * 5);
  if (matchedTemplateNafCodes.length) score += 18;
  if (matchedCampaignNafCodes.length) score += 32;
  if (campaignKeywordMatches.length) score += Math.min(10, campaignKeywordMatches.length * 2);
  if (locationMatches.length) score += 10;
  if (company.website || company.domain) score += 6;

  if (company.employeeCount && campaign.minEmployeeCount && company.employeeCount >= campaign.minEmployeeCount) {
    score += 12;
    employeeSignals.push(`employee count proxy >= ${campaign.minEmployeeCount}`);
  } else if (company.employeeCount && campaign.minEmployeeCount && company.employeeCount < campaign.minEmployeeCount) {
    score -= 16;
    employeeSignals.push(`likely below employee threshold ${campaign.minEmployeeCount}`);
  }

  if ((company.establishmentCount ?? 0) > 1) {
    score += 10;
    employeeSignals.push("multiple establishments/agencies proxy");
  }

  if (negativeMatches.length) score -= Math.min(32, negativeMatches.length * 12);

  const discoveryReasons = [
    sectorMatches.length ? `matchedSectorSignals: ${sectorMatches.join(", ")}` : undefined,
    salesMatches.length || proxyMatches.length ? `matchedSalesForceSignals: ${[...salesMatches, ...proxyMatches].join(", ")}` : undefined,
    matchedTemplateNafCodes.length ? `matchedTemplateNafCodes: ${matchedTemplateNafCodes.join(", ")}` : undefined,
    matchedCampaignNafCodes.length ? `matchedCampaignNafCodes: ${matchedCampaignNafCodes.join(", ")}` : undefined,
    campaignKeywordMatches.length ? `matchedKeywords: ${campaignKeywordMatches.join(", ")}` : undefined,
    locationMatches.length ? `locationMatches: ${locationMatches.join(", ")}` : undefined,
    employeeSignals.length ? `employeeCountSignals: ${employeeSignals.join(", ")}` : undefined,
    negativeMatches.length ? `negativeSignals: ${negativeMatches.join(", ")}` : undefined,
    qualitySignals.length ? `qualitySignals: ${qualitySignals.join(", ")}` : undefined
  ].filter(Boolean) as string[];

  return {
    discoveryScore: Math.max(0, Math.min(100, score)),
    discoveryReasons,
    hasSectorSignal: sectorMatches.length > 0 || matchedTemplateNafCodes.length > 0 || matchedCampaignNafCodes.length > 0,
    hasSalesForceSignal: salesMatches.length > 0 || proxyMatches.length > 0 || (company.establishmentCount ?? 0) > 1 || (hasExplicitTargeting && matchedCampaignNafCodes.length > 0),
    hasStrongNegativeSignal: negativeMatches.length > 0,
    isActiveIfKnown: isActiveAdministrativeStatus(company.administrativeStatus)
  };
}

export function assessDiscoveryQuality(company: DiscoveredCompany) {
  const domain = extractDomain(company.domain) ?? extractDomain(company.website) ?? extractDomain(company.sourceUrl);
  const siren = normalizeFrenchIdentifier(company.siren, 9);
  const siret = normalizeFrenchIdentifier(company.siret, 14);
  const warnings = qualityWarnings({
    name: company.name,
    domain,
    siren,
    siret,
    sourceUrl: company.sourceUrl,
    sourceId: company.sourceId,
    address: company.address,
    city: company.city,
    source: company.source,
    sourceConfidence: company.sourceConfidence
  });
  const qualityScore = scoreQuality({
    name: company.name,
    domain,
    siren,
    siret,
    sourceUrl: company.sourceUrl,
    sourceId: company.sourceId,
    address: company.address,
    city: company.city,
    sourceConfidence: company.sourceConfidence
  });
  return { qualityScore, warnings };
}
