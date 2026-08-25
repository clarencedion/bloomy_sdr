import type { DiscoveredCompany } from "@/types/firestore";
import type { DiscoverySearchInput, LeadDiscoveryProvider } from "@/lib/discovery/provider";

type RechercheEntrepriseResult = {
  nom_complet?: string;
  nom_raison_sociale?: string;
  siren?: string;
  activite_principale?: string;
  libelle_activite_principale?: string;
  tranche_effectif_salarie?: string;
  etat_administratif?: string;
  nombre_etablissements?: number;
  siege?: {
    siret?: string;
    activite_principale?: string;
    libelle_activite_principale?: string;
    adresse?: string;
    code_postal?: string;
    commune?: string;
    libelle_commune?: string;
    etat_administratif?: string;
    tranche_effectif_salarie?: string;
  };
  matching_etablissements?: Array<{
    siret?: string;
    adresse?: string;
    code_postal?: string;
    commune?: string;
    libelle_commune?: string;
    activite_principale?: string;
    libelle_activite_principale?: string;
    etat_administratif?: string;
    tranche_effectif_salarie?: string;
  }>;
};

function firstEstablishment(result: RechercheEntrepriseResult) {
  return result.matching_etablissements?.[0] ?? result.siege;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseEmployeeRange(value?: string) {
  if (!value) return undefined;
  const effectifCodes: Record<string, number> = {
    "00": 0,
    "01": 2,
    "02": 5,
    "03": 9,
    "11": 19,
    "12": 49,
    "21": 99,
    "22": 199,
    "31": 249,
    "32": 499,
    "41": 999,
    "42": 1999,
    "51": 4999,
    "52": 9999,
    "53": 10000
  };
  if (value in effectifCodes) return effectifCodes[value];
  const numbers = value.match(/\d+/g)?.map(Number) ?? [];
  return numbers.length ? Math.max(...numbers) : undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatNafForApi(value?: string) {
  const cleaned = value?.trim().toUpperCase().replace(/\s+/g, "");
  if (!cleaned) return undefined;
  if (/^\d{2}\.\d{2}[A-Z]$/.test(cleaned)) return cleaned;
  if (/^\d{4}[A-Z]$/.test(cleaned)) return `${cleaned.slice(0, 2)}.${cleaned.slice(2)}`;
  return cleaned;
}

function normalizeNafForCompare(value?: string) {
  return value?.trim().toUpperCase().replace(".", "");
}

function isMatchingNaf(companyNaf?: string, requestedNaf?: string) {
  if (!requestedNaf) return true;
  if (!companyNaf) return false;
  const companyNorm = normalizeNafForCompare(companyNaf);
  if (!companyNorm) return false;
  const requestedNorms = requestedNaf.split(",").map(normalizeNafForCompare).filter(Boolean);
  return requestedNorms.includes(companyNorm);
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function buildSearchRequests(campaign: DiscoverySearchInput["campaign"]) {
  const salesTerms = campaign.keywords.length ? campaign.keywords.slice(0, 6) : ["commercial", "distribution", "fournisseur professionnel"];
  const sectorTerms = ["transport", "logistique", "distribution", "materiel industriel", "materiel agricole", "medical"];
  const cities = campaign.cities.length ? campaign.cities : [""];
  const nafCodes = campaign.nafCodes ?? [];
  const requests: Array<{ query: string; nafCode?: string; department?: string }> = [];

  if (nafCodes.length) {
    const formattedNafs = nafCodes.map(formatNafForApi).filter(Boolean) as string[];
    const nafChunks = chunkArray(formattedNafs, 25);

    for (const city of cities.slice(0, 12)) {
      for (const nafChunk of nafChunks) {
        requests.push({
          query: city || "entreprise",
          nafCode: nafChunk.join(",")
        });
      }
    }

    for (const department of campaign.departments?.slice(0, 12) ?? []) {
      for (const nafChunk of nafChunks) {
        requests.push({
          query: "entreprise",
          nafCode: nafChunk.join(","),
          department
        });
      }
    }
  } else {
    for (const city of cities.slice(0, 8)) {
      for (const term of [...salesTerms, ...sectorTerms].slice(0, 10)) {
        requests.push({ query: [term, city].filter(Boolean).join(" ") });
        if (requests.length >= 48) return requests;
      }
    }
  }

  return requests;
}

export class RechercheEntreprisesProvider implements LeadDiscoveryProvider {
  name = "recherche_entreprises";

  async searchCompanies({ campaign, startPage = 1, candidateLimit }: DiscoverySearchInput): Promise<DiscoveredCompany[]> {
    const limit = Math.max(1, Math.min(candidateLimit ?? campaign.maxCompaniesPerRun, 100));
    const results: DiscoveredCompany[] = [];
    const seen = new Set<string>();
    const requests = buildSearchRequests(campaign);

    for (const request of requests) {
      const pages = Math.max(1, Math.ceil((limit - results.length) / 25));
      for (let page = startPage; page < startPage + pages; page += 1) {
        const params = new URLSearchParams({
          q: request.query,
          page: String(page),
          per_page: String(Math.min(limit - results.length, 25))
        });
        if (request.nafCode) params.set("activite_principale", request.nafCode);
        if (request.department) params.set("departement", request.department);
        const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`);
        if (!response.ok) {
          if (response.status === 400 && request.nafCode) {
            continue;
          }
          throw new Error(`Recherche d'Entreprises failed with ${response.status}`);
        }
        const payload = (await response.json()) as { results?: RechercheEntrepriseResult[] };
        const pageResults = payload.results ?? [];
        if (!pageResults.length) break;

        for (const item of pageResults) {
          const establishment = firstEstablishment(item);
          const nafCode = establishment?.activite_principale ?? item.activite_principale;
          if (request.nafCode && !isMatchingNaf(nafCode, request.nafCode)) continue;
          const siren = item.siren;
          const siret = establishment?.siret ?? item.siege?.siret;
          const sourceId = siret ?? siren;
          if (!sourceId || seen.has(sourceId)) continue;
          seen.add(sourceId);
          const administrativeStatus = establishment?.etat_administratif ?? item.etat_administratif;
          const employeeCount = parseEmployeeRange(establishment?.tranche_effectif_salarie ?? item.siege?.tranche_effectif_salarie ?? item.tranche_effectif_salarie);
          const establishmentCount = item.nombre_etablissements ?? item.matching_etablissements?.length;
          const nafLabel = establishment?.libelle_activite_principale ?? item.libelle_activite_principale;
          const normalizedQuery = normalizeText(request.query);
          results.push({
            name: item.nom_complet ?? item.nom_raison_sociale,
            siren,
            siret,
            address: establishment?.adresse,
            postalCode: establishment?.code_postal,
            city: establishment?.libelle_commune ?? establishment?.commune,
            country: "France",
            nafCode,
            nafLabel,
            industry: nafLabel,
            employeeCount,
            establishmentCount,
            administrativeStatus,
            description: administrativeStatus ? `Statut administratif: ${administrativeStatus}. Requete: ${normalizedQuery}.` : `Requete: ${normalizedQuery}.`,
            source: "API Recherche d'Entreprises",
            sourceProvider: "recherche_entreprises",
            sourceId,
            sourceUrl: siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}` : `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(sourceId)}`,
            sourceType: "recherche_entreprises",
            sourceConfidence: 0.84,
            rawProviderData: item
          });
          if (results.length >= limit) return results;
        }
        if (results.length >= limit) return results;
        await sleep(160);
      }
    }

    return results;
  }
}
