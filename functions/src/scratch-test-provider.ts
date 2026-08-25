import { RechercheEntreprisesProvider } from "./providers/discovery/recherche-entreprises-provider.js";

async function main() {
  const provider = new RechercheEntreprisesProvider();
  
  const nafCodes = [
    "25.11Z", "25.12Z", "25.61Z", "25.62A", "25.62B", "25.73A", "25.73B", "25.99B", "26.11Z", "26.12Z", "26.20Z", "26.30Z",
    "26.51A", "26.51B", "26.60Z", "27.11Z", "27.12Z", "27.20Z", "27.33Z", "27.40Z", "27.90Z", "28.12Z", "28.13Z", "28.22Z",
    "28.25Z", "28.29A", "28.29B", "28.30Z", "28.41Z", "28.49Z", "28.92Z", "28.93Z", "28.96Z", "28.99B", "29.10Z", "29.31Z",
    "29.32Z", "30.11Z", "30.12Z", "30.20Z", "30.30Z", "30.99Z", "32.50A", "32.50B", "33.12Z", "33.13Z", "33.14Z", "33.20B",
    "33.20C", "33.20D", "41.10A", "41.10B", "41.10C", "41.20A", "41.20B", "42.22Z", "43.21A", "43.22B", "43.29B", "43.32C",
    "43.99C", "43.99D", "45.11Z", "45.19Z", "45.31Z", "45.32Z", "46.14Z", "46.18Z", "46.19B", "46.51Z", "46.52Z", "46.61Z",
    "46.62Z", "46.63Z", "46.64Z", "46.65Z", "46.66Z", "46.69A", "46.69B", "46.69C", "46.73A", "46.73B", "46.74A", "46.74B",
    "46.75Z", "46.76Z", "46.90Z", "47.11D", "47.11F", "47.19A", "47.19B", "47.52A", "47.52B", "47.54Z", "47.59A", "47.91A",
    "47.91B", "58.29A", "58.29B", "58.29C", "61.10Z", "61.20Z", "61.30Z", "61.90Z", "62.01Z", "62.02A", "62.02B", "62.03Z",
    "62.09Z", "63.11Z", "63.12Z", "63.99Z", "64.19Z", "64.92Z", "65.12Z", "66.19B", "66.22Z", "66.29Z", "68.10Z", "68.31Z",
    "70.21Z", "70.22Z", "71.12B", "71.20B", "73.11Z", "73.20Z", "74.90B", "77.31Z", "77.32Z", "77.33Z", "77.39Z", "78.10Z",
    "78.20Z", "78.30Z", "82.20Z", "82.99Z", "85.59A", "85.59B"
  ];

  const campaign = {
    id: "test",
    name: "Test Campaign",
    segment: "commercial_performance",
    cities: ["Nantes"], // let's test with Nantes
    departments: [],
    regions: [],
    keywords: [
      "force de vente", "commerciaux", "technico-commercial"
    ],
    nafCodes,
    maxCompaniesPerRun: 15,
    minEmployeeCount: 20,
    requireWebsite: false,
    providerPriority: ["recherche_entreprises"]
  } as any;

  console.log("Searching companies...");
  const results = await provider.searchCompanies({
    keywords: campaign.keywords,
    cities: campaign.cities,
    departments: campaign.departments,
    regions: campaign.regions,
    nafCodes: campaign.nafCodes,
    maxResults: campaign.maxCompaniesPerRun,
    startPage: 1,
    candidateLimit: 15,
    minEmployeeCount: campaign.minEmployeeCount
  });

  console.log(`Search completed. Found ${results.length} companies.`);
  for (const comp of results.slice(0, 5)) {
    console.log(`- ${comp.name} (${comp.nafCode}) in ${comp.city}, employees: ${comp.employeeCount}`);
  }
}

main().catch(console.error);
