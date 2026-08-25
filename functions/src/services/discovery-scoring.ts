import type { DiscoveredCompany, DiscoverySearchInput } from "../providers/discovery/lead-discovery-provider.js";
import { extractDomain } from "./data-quality.js";

export function scoreDiscoveryFit(company: DiscoveredCompany, input: DiscoverySearchInput) {
  const reasons: string[] = [];
  let score = 10;
  const text = [company.name, company.industry, company.nafLabel].join(" ").toLowerCase();
  const targetNafCodes = new Set((input.nafCodes ?? []).map((code) => code.toUpperCase().replace(".", "")));
  const companyNafCode = company.nafCode?.toUpperCase().replace(".", "");

  if (extractDomain(company.domain ?? company.website)) {
    score += 15;
    reasons.push("has domain");
  }
  if (company.siren || company.siret) {
    score += 20;
    reasons.push("has French identifier");
  }
  if (company.city && input.cities?.map((city) => city.toLowerCase()).includes(company.city.toLowerCase())) {
    score += 10;
    reasons.push("city match");
  }
  for (const keyword of input.keywords ?? []) {
    if (text.includes(keyword.toLowerCase())) {
      score += 5;
      reasons.push(`keyword: ${keyword}`);
    }
  }
  if (company.nafCode && companyNafCode && targetNafCodes.has(companyNafCode)) {
    score += 32;
    reasons.push("NAF match");
  }
  if (company.employeeCount) {
    score += 8;
    reasons.push("employee count present");
  }

  return { discoveryScore: Math.min(score, 100), discoveryReasons: reasons };
}
