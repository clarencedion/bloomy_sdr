import type { DiscoveredCompany } from "@/types/firestore";
import type { DiscoverySearchInput, LeadDiscoveryProvider } from "@/lib/discovery/provider";

const segmentExamples = {
  commercial_performance: [
    { activity: "Solutions Commerciales", nafCode: "6201Z", nafLabel: "Programmation informatique", keyword: "commercial" },
    { activity: "Performance Vente", nafCode: "7022Z", nafLabel: "Conseil pour les affaires", keyword: "sales" },
    { activity: "Réseau Services B2B", nafCode: "8299Z", nafLabel: "Autres activités de soutien aux entreprises", keyword: "agences" },
    { activity: "Industrie Distribution Pro", nafCode: "4669B", nafLabel: "Commerce de gros de fournitures industrielles", keyword: "commercial" }
  ],
  training_hr: [
    { activity: "Talents & Formation", nafCode: "7830Z", nafLabel: "Autre mise à disposition de ressources humaines", keyword: "formation" },
    { activity: "RH Développement", nafCode: "7022Z", nafLabel: "Conseil pour les affaires", keyword: "recrutement" },
    { activity: "Académie Métiers Pro", nafCode: "8559A", nafLabel: "Formation continue d'adultes", keyword: "formation" },
    { activity: "Groupe Compétences Ouest", nafCode: "7022Z", nafLabel: "Conseil pour les affaires", keyword: "skills" }
  ],
  road_safety: [
    { activity: "Maintenance Flotte", nafCode: "4520A", nafLabel: "Entretien et réparation de véhicules automobiles légers", keyword: "flotte" },
    { activity: "Logistique Terrain", nafCode: "4941B", nafLabel: "Transports routiers de fret de proximité", keyword: "livraison" },
    { activity: "Services Techniciens Mobiles", nafCode: "3312Z", nafLabel: "Réparation de machines et équipements mécaniques", keyword: "techniciens" },
    { activity: "Prévention QHSE Transport", nafCode: "5229B", nafLabel: "Affrètement et organisation des transports", keyword: "prévention" }
  ],
  custom: [
    { activity: "Services Entreprises", nafCode: "8299Z", nafLabel: "Autres activités de soutien aux entreprises", keyword: "entreprise" },
    { activity: "Opérations Régionales", nafCode: "7022Z", nafLabel: "Conseil pour les affaires", keyword: "operations" },
    { activity: "Solutions Proximité", nafCode: "8211Z", nafLabel: "Services administratifs combinés de bureau", keyword: "services" },
    { activity: "Groupe Développement Local", nafCode: "7022Z", nafLabel: "Conseil pour les affaires", keyword: "développement" }
  ]
};

const namePrefixes = ["Atlantique", "Ouest", "Nova", "Horizon", "Cap", "Synergie", "Hexa", "Mobi", "Axial", "Arkea"];

export class ManualDiscoveryProvider implements LeadDiscoveryProvider {
  name = "manual";

  async searchCompanies({ campaign }: DiscoverySearchInput): Promise<DiscoveredCompany[]> {
    const cities = campaign.cities.length ? campaign.cities : ["Nantes"];
    const examples = segmentExamples[campaign.segment] ?? segmentExamples.custom;
    const limit = Math.max(1, Math.min(campaign.maxCompaniesPerRun, 12));
    const companies: DiscoveredCompany[] = [];

    while (companies.length < limit) {
      for (const city of cities) {
        for (const example of examples) {
          if (companies.length >= limit) return companies;
          const index = companies.length + 1;
          const prefix = namePrefixes[(index - 1) % namePrefixes.length];
          const companyName = `${prefix} ${example.activity} ${city}`;
          const slug = `${companyName}-${index}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          companies.push({
            name: companyName,
            website: campaign.requireWebsite ? `https://${slug}.example.fr` : index % 2 === 0 ? undefined : `https://${slug}.example.fr`,
            domain: campaign.requireWebsite || index % 2 === 1 ? `${slug}.example.fr` : undefined,
            city,
            country: "France",
            industry: example.activity,
            nafCode: example.nafCode,
            nafLabel: example.nafLabel,
            employeeCount: 25 + index * 8,
            description: `Test discovery record for ${example.keyword}, generated from campaign ${campaign.name}.`,
            source: "Manual test discovery provider",
            sourceUrl: `manual://discovery/${campaign.id}/${index}`,
            sourceProvider: "manual",
            sourceId: `manual:${campaign.id}:${index}`,
            sourceType: "manual",
            sourceConfidence: 0.72,
            rawProviderData: { campaignId: campaign.id, segment: campaign.segment, keyword: example.keyword, city }
          });
          if (companies.length >= limit) return companies;
        }
      }
    }

    return companies;
  }
}
