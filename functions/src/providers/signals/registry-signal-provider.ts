import type { SignalContext, SignalProvider, SignalResult } from "./signal-provider.js";
import type { EvidenceItem } from "../../types/domain.js";

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
    nom_commercial?: string | null;
    liste_enseignes?: string[] | null;
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
    nom_commercial?: string | null;
    liste_enseignes?: string[] | null;
  }>;
};


const REGISTRY_URL = "https://recherche-entreprises.api.gouv.fr/search";
/** The API's documented limit is 7 requests per second per IP: a 429 is retried once, after a pause. */
const REGISTRY_TIMEOUT_MS = 10_000;

/** Words a listing appends to the business's name ("… - Tatouage Paris"): what it is and where, not who. */
const TRADE_SUFFIX_WORDS = new Set([
  "tatouage", "tatouages", "tattoo", "tattoos", "tatoueur", "tatoueuse", "piercing", "barbier", "barber", "barbershop",
  "coiffure", "coiffeur", "coiffeuse", "salon", "studio", "shop", "atelier", "boutique", "institut", "spa", "fleuriste",
  "boulangerie", "patisserie", "pâtisserie", "restaurant", "garage", "paris", "france", "et", "&"
]);

/**
 * The name a business is registered under is shorter than the one its
 * listing shows: "Maison Python - Tatouage Paris" is "Maison Python",
 * "La Bête Humaine Tatouage" is "La Bête Humaine". Cut at the first
 * separator, then drop trailing trade or place words (the company's city
 * included), keeping at least one word.
 */
export function registeredNameCandidate(displayName: string, city?: string): string {
  let name = String(displayName ?? "").split(/\s[-–—|]\s|\s?\(|\s?\|/)[0].trim();
  const cityWord = String(city ?? "").trim().toLowerCase();
  const words = name.split(/\s+/);
  while (words.length > 1) {
    const last = words[words.length - 1].toLowerCase().replace(/[^a-zàâäçéèêëîïôöùûüÿœæ&0-9]/g, "");
    // "Paris 3e" is a place; "Tattoo 13" is a name: only an ordinal goes.
    if (TRADE_SUFFIX_WORDS.has(last) || (cityWord && last === cityWord) || /^\d{1,2}(e|ème|eme)$/.test(last)) words.pop();
    else break;
  }
  name = words.join(" ").trim();
  return name;
}

async function fetchRegistry(params: URLSearchParams): Promise<{ status: number; results: RechercheEntrepriseResult[] }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${REGISTRY_URL}?${params.toString()}`, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) });
    if (response.status === 429 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      continue;
    }
    if (!response.ok) return { status: response.status, results: [] };
    const payload = (await response.json()) as { results?: RechercheEntrepriseResult[] };
    return { status: response.status, results: payload.results ?? [] };
  }
  return { status: 429, results: [] };
}

/** A result is this business only when one of its establishments is at the same postcode. */
function atPostcode(result: RechercheEntrepriseResult, postalCode: string): boolean {
  const codes = [result.siege?.code_postal, ...(result.matching_etablissements ?? []).map((e) => e.code_postal)];
  return codes.some((code) => code === postalCode);
}

const compactName = (text: unknown) =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * …and only when it carries the name searched for: as its legal name, its
 * trade name or one of its signs ("PIERRE ROMIEU", sign "LA BETE HUMAINE").
 * A full-text hit on an address or a director's name is not this business.
 */
function carriesName(result: RechercheEntrepriseResult, candidate: string): boolean {
  const wanted = compactName(candidate);
  const names = [
    result.nom_complet,
    result.nom_raison_sociale,
    result.siege?.nom_commercial,
    ...(result.siege?.liste_enseignes ?? []),
    ...(result.matching_etablissements ?? []).flatMap((e) => [e.nom_commercial, ...(e.liste_enseignes ?? [])])
  ].map(compactName);
  return names.some((name) => name.includes(wanted));
}

function parseEmployeeRange(value?: string): number | undefined {
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

export class RegistrySignalProvider implements SignalProvider {
  readonly id = "company_registry";
  readonly name = "Universal Company Registry";
  readonly description = "Extracts authoritative legal identity, SIREN/SIRET, official NAF code, employee bracket, address, and administrative status from public French registry (INSEE / Recherche d'Entreprises).";
  readonly capabilities = [
    "legal_name",
    "siren",
    "siret",
    "naf_code",
    "naf_label",
    "employee_bracket",
    "employee_count",
    "headquarters_address",
    "city",
    "postal_code",
    "administrative_status",
    "establishment_count"
  ];
  readonly costPerExecutionUsd = 0.00;

  supports(context: SignalContext): boolean {
    return Boolean(
      context.company.siren ||
      context.company.siret ||
      context.company.name
    );
  }

  async collect(context: SignalContext): Promise<SignalResult> {
    const startTime = Date.now();
    const evidence: Array<Omit<EvidenceItem, "id" | "workspaceId" | "businessId" | "companyId">> = [];

    try {
      let rawData: RechercheEntrepriseResult | null = null;

      // 1. Check if rawProviderData on company already contains a valid Recherche d'Entreprises record
      if (
        context.company.rawProviderData &&
        typeof context.company.rawProviderData === "object" &&
        ("siren" in (context.company.rawProviderData as object) || "nom_complet" in (context.company.rawProviderData as object))
      ) {
        rawData = context.company.rawProviderData as RechercheEntrepriseResult;
      }

      // 2. If not, query the official API
      if (!rawData) {
        const queryTerm = context.company.siren || context.company.siret || context.company.name;
        if (!queryTerm) {
          return {
            providerId: this.id,
            evidence: [],
            costEstimateUsd: this.costPerExecutionUsd,
            durationMs: Date.now() - startTime,
            error: "No SIREN, SIRET or company name available for registry lookup."
          };
        }

        const params = new URLSearchParams({
          q: queryTerm,
          per_page: "1"
        });
        // Only send code_postal when we actually have one. Guarding on `city`
        // meant a company with a city but no postcode sent `code_postal=`,
        // which the API rejects with 400 - so every Google Places company
        // failed registry lookup and never got its SIREN, NAF or headcount.
        if (context.company.postalCode?.trim()) {
          params.set("code_postal", context.company.postalCode.trim());
        }

        const first = await fetchRegistry(params);
        if (first.status !== 200) {
          return {
            providerId: this.id,
            evidence: [],
            costEstimateUsd: this.costPerExecutionUsd,
            durationMs: Date.now() - startTime,
            error: `Recherche d'Entreprises API returned status ${first.status}`
          };
        }
        rawData = first.results[0] ?? null;

        // A listing's display name ("… - Tatouage Paris") rarely matches the
        // registered one: none of 37 Google Places companies matched on
        // 2026-11-10. Retry with the registered-name candidate, active
        // businesses of the département only, and accept a result only when
        // one of its establishments is at the same postcode — a same-name
        // business elsewhere is a wrong SIREN, worse than none.
        const postalCode = context.company.postalCode?.trim();
        if (!rawData && !context.company.siren && !context.company.siret && postalCode && /^\d{5}$/.test(postalCode)) {
          const candidate = registeredNameCandidate(context.company.name ?? "", context.company.city);
          // Too short to tell apart ("By O'"): no lookup rather than a guess.
          if (compactName(candidate).length >= 4) {
            const retry = new URLSearchParams({
              q: candidate,
              departement: postalCode.slice(0, 2),
              etat_administratif: "A",
              per_page: "10"
            });
            const second = await fetchRegistry(retry);
            rawData = second.results.find((result) => atPostcode(result, postalCode) && carriesName(result, candidate)) ?? null;
          }
        }
      }

      if (!rawData) {
        return {
          providerId: this.id,
          evidence: [],
          costEstimateUsd: this.costPerExecutionUsd,
          durationMs: Date.now() - startTime,
          error: "No matching company found in public registry."
        };
      }

      const establishment = rawData.matching_etablissements?.[0] ?? rawData.siege;
      const siren = rawData.siren ?? context.company.siren;
      const siret = establishment?.siret ?? rawData.siege?.siret ?? context.company.siret;
      const legalName = rawData.nom_raison_sociale ?? rawData.nom_complet ?? context.company.name;
      const nafCode = establishment?.activite_principale ?? rawData.activite_principale;
      const nafLabel = establishment?.libelle_activite_principale ?? rawData.libelle_activite_principale;
      const employeeBracket = establishment?.tranche_effectif_salarie ?? rawData.siege?.tranche_effectif_salarie ?? rawData.tranche_effectif_salarie;
      const employeeCount = parseEmployeeRange(employeeBracket);
      const address = establishment?.adresse ?? rawData.siege?.adresse;
      const postalCode = establishment?.code_postal ?? rawData.siege?.code_postal;
      const city = establishment?.libelle_commune ?? establishment?.commune ?? rawData.siege?.libelle_commune;
      const adminStatus = establishment?.etat_administratif ?? rawData.etat_administratif;
      const establishmentCount = rawData.nombre_etablissements ?? rawData.matching_etablissements?.length;

      const sourceUrl = siren
        ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`
        : "https://recherche-entreprises.api.gouv.fr";

      const now = new Date();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days TTL

      if (legalName) {
        evidence.push({
          signalProvider: this.id,
          key: "legal_name",
          value: legalName,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 95,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      if (siren) {
        evidence.push({
          signalProvider: this.id,
          key: "siren",
          value: siren,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 100,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      if (siret) {
        evidence.push({
          signalProvider: this.id,
          key: "siret",
          value: siret,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 95,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      if (nafCode) {
        evidence.push({
          signalProvider: this.id,
          key: "naf_code",
          value: nafCode,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 95,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      if (nafLabel) {
        evidence.push({
          signalProvider: this.id,
          key: "naf_label",
          value: nafLabel,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      if (employeeBracket) {
        evidence.push({
          signalProvider: this.id,
          key: "employee_bracket",
          value: employeeBracket,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 85,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      if (employeeCount !== undefined) {
        evidence.push({
          signalProvider: this.id,
          key: "employee_count",
          value: employeeCount,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 85,
          nature: "derived_metric",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      if (address) {
        evidence.push({
          signalProvider: this.id,
          key: "headquarters_address",
          value: address,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      if (city) {
        evidence.push({
          signalProvider: this.id,
          key: "city",
          value: city,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      if (postalCode) {
        evidence.push({
          signalProvider: this.id,
          key: "postal_code",
          value: postalCode,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      if (adminStatus) {
        evidence.push({
          signalProvider: this.id,
          key: "administrative_status",
          value: adminStatus,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 95,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      if (establishmentCount !== undefined) {
        evidence.push({
          signalProvider: this.id,
          key: "establishment_count",
          value: establishmentCount,
          sourceType: "official_registry",
          sourceUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      return {
        providerId: this.id,
        evidence,
        costEstimateUsd: this.costPerExecutionUsd,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        providerId: this.id,
        evidence: [],
        costEstimateUsd: this.costPerExecutionUsd,
        durationMs: Date.now() - startTime,
        error: errorMsg
      };
    }
  }
}
