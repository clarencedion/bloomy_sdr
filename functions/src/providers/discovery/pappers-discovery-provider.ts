import type { DiscoveredCompany, DiscoverySearchInput, LeadDiscoveryProvider } from "./lead-discovery-provider.js";

type PappersCompany = {
  nom_entreprise?: string;
  denomination?: string;
  siren?: string;
  siege?: {
    siret?: string;
    adresse_ligne_1?: string;
    code_postal?: string;
    ville?: string;
  };
  code_naf?: string;
  libelle_code_naf?: string;
  site_internet?: string;
  effectif?: string;
};

function parseEmployeeCount(value?: string) {
  if (!value) return undefined;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

export class PappersDiscoveryProvider implements LeadDiscoveryProvider {
  name = "pappers";

  async searchCompanies(input: DiscoverySearchInput): Promise<DiscoveredCompany[]> {
    const apiKey = process.env.PAPPERS_API_KEY;
    const enabled = process.env.ENABLE_PAPPERS_ENRICHMENT === "true";
    if (!apiKey || !enabled) return [];

    const queries = input.keywords?.length ? input.keywords : ["entreprise"];
    const cities = input.cities?.length ? input.cities : [undefined];
    const results: DiscoveredCompany[] = [];

    for (const query of queries) {
      for (const city of cities) {
        const params = new URLSearchParams({
          api_token: apiKey,
          q: [query, city].filter(Boolean).join(" "),
          par_page: String(Math.min(input.maxResults ?? 20, 20))
        });
        if (input.nafCodes?.length) params.set("code_naf", input.nafCodes.join(","));

        const response = await fetch(`https://api.pappers.fr/v2/recherche?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Pappers API failed with ${response.status}`);
        }
        const payload = (await response.json()) as { resultats?: PappersCompany[] };
        for (const company of payload.resultats ?? []) {
          const sourceId = company.siege?.siret ?? company.siren;
          if (!sourceId) continue;
          results.push({
            name: company.nom_entreprise ?? company.denomination,
            website: company.site_internet,
            siren: company.siren,
            siret: company.siege?.siret,
            address: company.siege?.adresse_ligne_1,
            postalCode: company.siege?.code_postal,
            city: company.siege?.ville,
            country: "France",
            nafCode: company.code_naf,
            nafLabel: company.libelle_code_naf,
            industry: company.libelle_code_naf,
            employeeCount: parseEmployeeCount(company.effectif),
            source: "Pappers API",
            sourceUrl: company.siren ? `https://www.pappers.fr/entreprise/${company.siren}` : undefined,
            sourceProvider: "pappers",
            sourceId,
            sourceType: "pappers",
            sourceConfidence: 0.92,
            rawProviderData: company
          });
          if (results.length >= (input.maxResults ?? 20)) return results;
        }
      }
    }

    return results;
  }
}
