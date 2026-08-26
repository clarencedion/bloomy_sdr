import { describe, it, expect } from "vitest";
import type { Contact } from "@/types/firestore";

describe("Contacts & Decision Maker Data Contracts (REQ-043 to REQ-048)", () => {
  it("supports matched persona, priority ranking, and primary decision maker flags", () => {
    const primaryContact: Contact = {
      id: "contact-1",
      companyId: "company-1",
      fullName: "Pierre Dubois",
      role: "Gérant Propriétaire",
      email: "pierre.dubois@fleurs-nantes.fr",
      emailVerified: true,
      emailQualification: "verified",
      personaMatched: "Dirigeant / Propriétaire",
      personaPriority: 1,
      personaMatchScore: 100,
      isPrimaryDecisionMaker: true,
      requiresVerification: false,
      status: "verified",
      sourceType: "website",
      sourceConfidence: 0.9,
      qualityScore: 90,
      dataQualityWarnings: [],
      createdAt: {} as any,
      updatedAt: {} as any
    };

    expect(primaryContact.isPrimaryDecisionMaker).toBe(true);
    expect(primaryContact.personaPriority).toBe(1);
    expect(primaryContact.personaMatched).toBe("Dirigeant / Propriétaire");
    expect(primaryContact.emailQualification).toBe("verified");
    expect(primaryContact.emailVerified).toBe(true);
    expect(primaryContact.requiresVerification).toBe(false);
  });

  it("handles unverified/guessed email qualifications requiring verification", () => {
    const unverifiedContact: Contact = {
      id: "contact-2",
      companyId: "company-1",
      fullName: "Sophie Laurent",
      role: "Responsable Marketing",
      email: "sophie.laurent@fleurs-nantes.fr",
      emailVerified: false,
      emailQualification: "guessed",
      personaMatched: "Responsable Marketing",
      personaPriority: 2,
      personaMatchScore: 85,
      isPrimaryDecisionMaker: false,
      requiresVerification: true,
      status: "new",
      sourceType: "website",
      sourceConfidence: 0.7,
      qualityScore: 65,
      dataQualityWarnings: ["unverified_email"],
      createdAt: {} as any,
      updatedAt: {} as any
    };

    expect(unverifiedContact.emailVerified).toBe(false);
    expect(unverifiedContact.emailQualification).toBe("guessed");
    expect(unverifiedContact.requiresVerification).toBe(true);
    expect(unverifiedContact.status).toBe("new");
    expect(unverifiedContact.dataQualityWarnings).toContain("unverified_email");
  });
});
