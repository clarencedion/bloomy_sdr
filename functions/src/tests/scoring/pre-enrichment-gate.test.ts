import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock firebase-admin/firestore
const mockDocData: Record<string, any> = {};

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
            set: vi.fn().mockResolvedValue(undefined),
            update: vi.fn().mockResolvedValue(undefined)
          }
        })),
        set: vi.fn(),
        update: vi.fn()
      }),
      add: vi.fn().mockResolvedValue({ id: "mock_doc_id" }),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: [], empty: true })
    })
  }
}));

// Mock DropcontactProvider
const mockFindContacts = vi.fn();
vi.mock("../../providers/enrichment/dropcontact-provider.js", () => ({
  DropcontactProvider: class {
    findContactsForCompany = mockFindContacts;
  }
}));

// Mock settings
vi.mock("../../utils/settings.js", () => ({
  getIntegrationSecrets: vi.fn().mockResolvedValue({
    dropcontactApiKey: "test-dropcontact-key"
  })
}));

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  writeLog: vi.fn().mockResolvedValue(undefined)
}));

import { findContactsForCompany } from "../../services/contact-discovery.js";

describe("Cost-Saving Pre-Enrichment Gate (REQ-040)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips Dropcontact API call when company is marked DISQUALIFIED", async () => {
    const disqualifiedCompanyId = "comp_disqualified_123";
    mockDocData[`companies/${disqualifiedCompanyId}`] = {
      name: "Entreprise Non Qualifiee",
      domain: "nonqualifiee.fr",
      siren: "111222333",
      status: "rejected",
      qualificationState: "DISQUALIFIED",
      opportunityScore: {
        overallScore: 25,
        qualificationState: "DISQUALIFIED"
      }
    };

    const result = await findContactsForCompany(disqualifiedCompanyId);

    expect(result.skipped).toBe(1);
    expect(result.found).toBe(0);
    expect(result.created).toBe(0);
    expect(result.error).toContain("DISQUALIFIED");
    expect(mockFindContacts).not.toHaveBeenCalled();
  });

  it("proceeds to contact enrichment when company is QUALIFIED or HIGH_PRIORITY", async () => {
    const qualifiedCompanyId = "comp_qualified_456";
    mockDocData[`companies/${qualifiedCompanyId}`] = {
      name: "Atelier Floral Nantes",
      domain: "atelier-floral.fr",
      siren: "890123456",
      status: "qualified",
      qualificationState: "HIGH_PRIORITY",
      opportunityScore: {
        overallScore: 88,
        qualificationState: "HIGH_PRIORITY"
      }
    };

    mockFindContacts.mockResolvedValueOnce([
      {
        fullName: "Marie Dupont",
        jobTitle: "Gérante",
        email: "marie@atelier-floral.fr"
      }
    ]);

    const result = await findContactsForCompany(qualifiedCompanyId);

    expect(mockFindContacts).toHaveBeenCalledWith({
      companyName: "Atelier Floral Nantes",
      domain: "atelier-floral.fr",
      siren: "890123456",
      siret: undefined
    });
    expect(result.error).toBeUndefined();
  });
});
