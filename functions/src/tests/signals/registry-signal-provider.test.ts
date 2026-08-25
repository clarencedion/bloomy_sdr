import { describe, it, expect } from "vitest";
import { RegistrySignalProvider } from "../../providers/signals/registry-signal-provider.js";
import type { SignalContext } from "../../providers/signals/signal-provider.js";

describe("Universal Registry Signal Provider (REQ-026)", () => {
  const provider = new RegistrySignalProvider();

  it("extracts facts and derived metrics from raw Recherche d'Entreprises data", async () => {
    const rawData = {
      nom_raison_sociale: "Transport Express Atlantique",
      siren: "901234567",
      activite_principale: "49.41A",
      libelle_activite_principale: "Transports routiers de fret interurbains",
      tranche_effectif_salarie: "21", // 50-99 employees
      nombre_etablissements: 4,
      etat_administratif: "A",
      siege: {
        siret: "90123456700018",
        adresse: "14 Rue de l'Aviation",
        code_postal: "44000",
        commune: "44109",
        libelle_commune: "Nantes"
      }
    };

    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_test",
      company: {
        id: "comp_reg_1",
        name: "Transport Express Atlantique",
        siren: "901234567",
        rawProviderData: rawData
      }
    };

    expect(provider.supports(context)).toBe(true);

    const result = await provider.collect(context);
    expect(result.error).toBeUndefined();
    expect(result.providerId).toBe("company_registry");
    expect(result.evidence.length).toBeGreaterThanOrEqual(8);

    const evidenceMap = new Map(result.evidence.map((e) => [e.key, e]));

    // Fact checks
    expect(evidenceMap.get("legal_name")?.value).toBe("Transport Express Atlantique");
    expect(evidenceMap.get("legal_name")?.nature).toBe("fact");
    expect(evidenceMap.get("legal_name")?.confidence).toBe(95);

    expect(evidenceMap.get("siren")?.value).toBe("901234567");
    expect(evidenceMap.get("siren")?.nature).toBe("fact");
    expect(evidenceMap.get("siren")?.confidence).toBe(100);

    expect(evidenceMap.get("naf_code")?.value).toBe("49.41A");
    expect(evidenceMap.get("naf_code")?.nature).toBe("fact");

    expect(evidenceMap.get("headquarters_address")?.value).toBe("14 Rue de l'Aviation");
    expect(evidenceMap.get("headquarters_address")?.nature).toBe("fact");

    expect(evidenceMap.get("establishment_count")?.value).toBe(4);
    expect(evidenceMap.get("establishment_count")?.nature).toBe("fact");

    // Derived metric check
    expect(evidenceMap.get("employee_count")?.value).toBe(99); // Tranche 21 max
    expect(evidenceMap.get("employee_count")?.nature).toBe("derived_metric");

    // Source URL should point to Annuaire Entreprises
    expect(evidenceMap.get("siren")?.sourceUrl).toBe("https://annuaire-entreprises.data.gouv.fr/entreprise/901234567");
  });
});
