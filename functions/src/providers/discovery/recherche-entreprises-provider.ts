import type { DiscoveredCompany, DiscoverySearchInput, LeadDiscoveryProvider } from "./lead-discovery-provider.js";

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
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildSearchRequests(input: DiscoverySearchInput) {
  const keywords = input.keywords?.length ? input.keywords.slice(0, 10) : [];
  const cities = input.cities?.length ? input.cities : [""];
  const nafCodes = input.nafCodes ?? [];
  const requests: Array<{ query: string; nafCode?: string; department?: string }> = [];

  // 1. If NAF codes are provided, restrict search to these NAF codes
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

    for (const department of input.departments?.slice(0, 12) ?? []) {
      for (const nafChunk of nafChunks) {
        requests.push({
          query: "entreprise",
          nafCode: nafChunk.join(","),
          department
        });
      }
    }
  } else {
    // 2. No NAF codes, search by keywords or default fallback sectors in cities
    const terms = keywords.length ? keywords : ["transport", "logistique", "distribution", "materiel industriel", "materiel agricole", "medical"];
    for (const city of cities.slice(0, 8)) {
      for (const term of terms.slice(0, 10)) {
        requests.push({ query: [term, city].filter(Boolean).join(" ") });
      }
    }
  }

  return requests;
}

function getTranchesForMinEmployees(minEmployees: number): string | undefined {
  if (minEmployees <= 0) return undefined;
  const tranches = [
    { code: "01", max: 2 },
    { code: "02", max: 5 },
    { code: "03", max: 9 },
    { code: "11", max: 19 },
    { code: "12", max: 49 },
    { code: "21", max: 99 },
    { code: "22", max: 199 },
    { code: "31", max: 249 },
    { code: "32", max: 499 },
    { code: "41", max: 999 },
    { code: "42", max: 1999 },
    { code: "51", max: 4999 },
    { code: "52", max: 9999 },
    { code: "53", max: Infinity }
  ];
  const matchingCodes = tranches
    .filter((t) => t.max >= minEmployees)
    .map((t) => t.code);
  return matchingCodes.length ? matchingCodes.join(",") : undefined;
}

export class RechercheEntreprisesProvider implements LeadDiscoveryProvider {
  name = "recherche_entreprises";

  async searchCompanies(input: DiscoverySearchInput): Promise<DiscoveredCompany[]> {
    const limit = Math.max(1, Math.min(input.candidateLimit ?? input.maxResults ?? 25, 100));
    const startPage = Math.max(1, input.startPage ?? 1);
    const results: DiscoveredCompany[] = [];
    const seen = new Set<string>();
    const requests = buildSearchRequests(input);

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
        if (input.minEmployeeCount && input.minEmployeeCount > 0) {
          const tranches = getTranchesForMinEmployees(input.minEmployeeCount);
          if (tranches) {
            params.set("tranche_effectif_salarie", tranches);
          }
        }
        let response;
        let retries = 3;
        while (retries > 0) {
          response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`);
          if (response.status === 429) {
            retries -= 1;
            await sleep(1500);
            continue;
          }
          break;
        }

        if (!response || !response.ok) {
          if (response && response.status === 400 && request.nafCode) {
            continue;
          }
          throw new Error(`Recherche d'Entreprises failed with ${response ? response.status : "unknown status"}`);
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
            name: item.nom_raison_sociale ?? item.nom_complet,
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
            sourceType: "recherche_entreprises",
            sourceUrl: siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}` : `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(sourceId)}`,
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
