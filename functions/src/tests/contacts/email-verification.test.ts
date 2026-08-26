import { describe, it, expect } from "vitest";
import { verifyContactEmail, isContactEligibleForOutreach } from "../../services/contact-verifier.js";

describe("Strict Email Verification Gate (REQ-048)", () => {
  it("marks Dropcontact verified emails as deliverable and eligible for automated outreach", () => {
    const verification = verifyContactEmail({
      email: "pierre.dubois@fleurs-nantes.fr",
      emailQualification: "verified",
      source: "dropcontact"
    });

    expect(verification.isValidSyntax).toBe(true);
    expect(verification.emailQualification).toBe("verified");
    expect(verification.emailVerified).toBe(true);
    expect(verification.requiresVerification).toBe(false);

    const eligibility = isContactEligibleForOutreach({
      email: "pierre.dubois@fleurs-nantes.fr",
      emailVerified: true,
      emailQualification: "verified",
      doNotContact: false
    });

    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reason).toBeUndefined();
  });

  it("flags guessed emails as requiring verification and blocks automated outreach", () => {
    const verification = verifyContactEmail({
      email: "sophie.laurent@fleurs-nantes.fr",
      emailQualification: "guessed",
      source: "dropcontact"
    });

    expect(verification.isValidSyntax).toBe(true);
    expect(verification.emailQualification).toBe("guessed");
    expect(verification.emailVerified).toBe(false);
    expect(verification.requiresVerification).toBe(true);

    const eligibility = isContactEligibleForOutreach({
      email: "sophie.laurent@fleurs-nantes.fr",
      emailVerified: false,
      emailQualification: "guessed",
      doNotContact: false
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toContain("Email is not verified (qualification: guessed)");
  });

  it("flags scraped unverified emails as uncertain and blocks automated outreach", () => {
    const verification = verifyContactEmail({
      email: "contact@fleurs-nantes.fr",
      source: "website"
    });

    expect(verification.isValidSyntax).toBe(true);
    expect(verification.emailQualification).toBe("uncertain");
    expect(verification.emailVerified).toBe(false);
    expect(verification.requiresVerification).toBe(true);

    const eligibility = isContactEligibleForOutreach({
      email: "contact@fleurs-nantes.fr",
      emailVerified: false,
      emailQualification: "uncertain",
      doNotContact: false
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toContain("Email is not verified (qualification: uncertain)");
  });

  it("strictly blocks contacts flagged with doNotContact or invalid status", () => {
    const eligibilityDoNotContact = isContactEligibleForOutreach({
      email: "pierre@fleurs-nantes.fr",
      emailVerified: true,
      emailQualification: "verified",
      doNotContact: true
    });
    expect(eligibilityDoNotContact.eligible).toBe(false);
    expect(eligibilityDoNotContact.reason).toBe("Contact is marked doNotContact.");

    const eligibilityInvalidStatus = isContactEligibleForOutreach({
      email: "pierre@fleurs-nantes.fr",
      emailVerified: true,
      emailQualification: "verified",
      status: "do_not_contact"
    });
    expect(eligibilityInvalidStatus.eligible).toBe(false);
    expect(eligibilityInvalidStatus.reason).toBe("Contact status is do_not_contact.");
  });

  it("rejects invalid email syntax and automated mailboxes", () => {
    const invalidSyntax = verifyContactEmail({ email: "not-an-email" });
    expect(invalidSyntax.isValidSyntax).toBe(false);

    const noReply = verifyContactEmail({ email: "noreply@company.com" });
    expect(noReply.requiresVerification).toBe(true);
    expect(noReply.emailVerified).toBe(false);
  });
});
