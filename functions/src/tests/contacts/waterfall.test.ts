import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDocData: Record<string, any> = {};
const mockCreatedContacts: any[] = [];

vi.mock("../../config/firebase.js", () => ({
  adminDb: {
    collection: (collName: string) => ({
      doc: (docId: string) => ({
        id: docId,
        get: vi.fn().mockImplementation(async () => ({
          exists: Boolean(mockDocData[`${collName}/${docId}`]),
          id: docId,
          data: () => mockDocData[`${collName}/${docId}`],
          ref: {
            set: vi.fn().mockResolvedValue(undefined)
          }
        })),
        set: vi.fn().mockImplementation(async (data: any) => {
          mockDocData[`${collName}/${docId}`] = {
            ...mockDocData[`${collName}/${docId}`],
            ...data
          };
        })
      }),
      add: vi.fn().mockImplementation(async (data: any) => {
        const id = `contact_${mockCreatedContacts.length + 1}`;
        mockCreatedContacts.push({ id, ...data });
        return { id };
      }),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockImplementation(async () => {
        if (collName === "contacts") {
          // Return any existing mock contacts for this company
          const contacts = Object.entries(mockDocData)
            .filter(([key]) => key.startsWith("contacts/"))
            .map(([_, val]) => ({
              id: val.id ?? "existing_c1",
              data: () => val
            }));
          return { docs: contacts, empty: contacts.length === 0, size: contacts.length };
        }
        return { docs: [], empty: true, size: 0 };
      })
    })
  }
}));

const mockDropcontactFind = vi.fn();
vi.mock("../../providers/enrichment/dropcontact-provider.js", () => ({
  DropcontactProvider: class {
    findContactsForCompany = mockDropcontactFind;
  }
}));

vi.mock("../../utils/settings.js", () => ({
  getIntegrationSecrets: vi.fn().mockResolvedValue({
    dropcontactApiKey: "test-key"
  })
}));

vi.mock("../../utils/logger.js", () => ({
  writeLog: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../services/lead-readiness.js", () => ({
  updateCompanyLeadReadiness: vi.fn().mockResolvedValue({
    leadReadyForOutreach: true,
    contactCount: 1
  })
}));

import { runContactWaterfall } from "../../services/contact-waterfall.js";
import { SecondaryEnrichmentProvider } from "../../providers/enrichment/secondary-provider.js";
import type { OfferDoc } from "../../types/domain.js";

describe("Multi-Provider Contact Waterfall (REQ-047, REQ-045, REQ-046)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatedContacts.length = 0;
    for (const key of Object.keys(mockDocData)) {
      delete mockDocData[key];
    }
  });

  const testOffer: OfferDoc = {
    id: "offer-smb",
    workspaceId: "ws-1",
    businessId: "biz-1",
    name: "Web Modernization",
    description: "SMB Offer",
    targetPersonas: [
      {
        title: "Dirigeant / Fondateur",
        priority: 1,
        keywords: ["gérant", "fondateur", "artisan", "patron", "president", "ceo"]
      },
      {
        title: "Direction Commerciale",
        priority: 2,
        keywords: ["commercial", "ventes", "sales"]
      }
    ],
    valuePropositions: [],
    proofPoints: [],
    prohibitedPromises: [],
    createdAt: {} as any,
    updatedAt: {} as any
  };

  it("orchestrates waterfall, filters irrelevant roles, ranks against offer personas, and persists verified contacts", async () => {
    const companyId = "company-nantes-1";
    mockDocData[`companies/${companyId}`] = {
      id: companyId,
      name: "Boulangerie Tradition Nantes",
      domain: "boulangerie-nantes.fr",
      siren: "123456789",
      status: "qualified",
      qualificationState: "QUALIFIED",
      opportunityScore: { overallScore: 78, qualificationState: "QUALIFIED" }
    };

    mockDocData[`offers/offer-smb`] = testOffer;

    // Dropcontact returns 3 contacts: 1 owner (verified), 1 accountant (irrelevant), 1 sales (guessed)
    mockDropcontactFind.mockResolvedValueOnce([
      {
        firstName: "Jean",
        lastName: "Dupont",
        fullName: "Jean Dupont",
        jobTitle: "Gérant Fondateur",
        email: "jean@boulangerie-nantes.fr",
        emailQualification: "verified",
        phone: "+33240123456"
      },
      {
        firstName: "Claire",
        lastName: "Audit",
        fullName: "Claire Audit",
        jobTitle: "Expert-Comptable",
        email: "claire@compta-nantes.fr",
        emailQualification: "verified"
      },
      {
        firstName: "Paul",
        lastName: "Vente",
        fullName: "Paul Vente",
        jobTitle: "Attaché Commercial",
        email: "paul@boulangerie-nantes.fr",
        emailQualification: "guessed"
      }
    ]);

    const result = await runContactWaterfall(companyId, { offer: testOffer });

    // Expert-comptable was filtered out (REQ-044)
    expect(result.found).toBe(2);
    expect(result.created).toBe(2);

    // Primary decision maker should be Jean Dupont (Gérant, Priority 1)
    expect(result.primaryContact).toBeDefined();
    expect(result.primaryContact?.fullName).toBe("Jean Dupont");
    expect(result.primaryContact?.personaPriority).toBe(1);
    expect(result.primaryContact?.personaMatched).toBe("Dirigeant / Fondateur");
    expect(result.primaryContact?.isPrimaryDecisionMaker).toBe(true);

    // Check created contacts in Firestore
    const jeanDoc = mockCreatedContacts.find((c) => c.fullName === "Jean Dupont");
    expect(jeanDoc).toBeDefined();
    expect(jeanDoc.emailVerified).toBe(true);
    expect(jeanDoc.emailQualification).toBe("verified");
    expect(jeanDoc.status).toBe("verified");

    const paulDoc = mockCreatedContacts.find((c) => c.fullName === "Paul Vente");
    expect(paulDoc).toBeDefined();
    expect(paulDoc.emailVerified).toBe(false);
    expect(paulDoc.emailQualification).toBe("guessed");
    expect(paulDoc.requiresVerification).toBe(true);
    expect(paulDoc.status).toBe("new");
  });

  it("cascades to secondary provider adapter if primary provider yields 0 contacts", async () => {
    const companyId = "company-secondary-2";
    mockDocData[`companies/${companyId}`] = {
      id: companyId,
      name: "Société Innovation Tech",
      domain: "innovation-tech.io",
      siren: "987654321",
      status: "qualified",
      qualificationState: "QUALIFIED"
    };

    // Primary provider returns 0 contacts
    mockDropcontactFind.mockResolvedValueOnce([]);

    // Custom secondary provider returns 1 contact
    const mockSecondary = new SecondaryEnrichmentProvider("secondary-key", async () => [
      {
        fullName: "Alice Martin",
        jobTitle: "Chief Executive Officer",
        email: "alice@innovation-tech.io",
        emailQualification: "verified",
        source: "secondary_provider"
      }
    ]);

    const result = await runContactWaterfall(companyId, {
      offer: testOffer,
      secondaryProvider: mockSecondary
    });

    expect(result.found).toBe(1);
    expect(result.created).toBe(1);
    expect(result.stageReached).toBe("completed");
    expect(result.primaryContact?.fullName).toBe("Alice Martin");
    expect(result.primaryContact?.source).toBe("secondary_provider");
  });

  it("deduplicates contacts found across multiple waterfall stages", async () => {
    const companyId = "company-dedup-3";
    mockDocData[`companies/${companyId}`] = {
      id: companyId,
      name: "Cabinet Conseil Atlantique",
      domain: "conseil-atlantique.fr",
      siren: "555666777",
      status: "qualified"
    };

    // Dropcontact returns same email with verified status
    mockDropcontactFind.mockResolvedValueOnce([
      {
        fullName: "Marc Dubois",
        jobTitle: "Directeur Général",
        email: "m.dubois@conseil-atlantique.fr",
        emailQualification: "verified"
      }
    ]);

    const result = await runContactWaterfall(companyId, { offer: testOffer });

    expect(result.found).toBe(1);
    expect(result.created).toBe(1);
  });
});
