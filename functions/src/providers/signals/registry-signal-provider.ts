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
        if (context.company.city) {
          params.set("code_postal", context.company.postalCode || "");
        }

        const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`);
        if (!response.ok) {
          return {
            providerId: this.id,
            evidence: [],
            costEstimateUsd: this.costPerExecutionUsd,
            durationMs: Date.now() - startTime,
            error: `Recherche d'Entreprises API returned status ${response.status}`
          };
        }

        const payload = (await response.json()) as { results?: RechercheEntrepriseResult[] };
        rawData = payload.results?.[0] ?? null;
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
