import type { EmailQualification } from "../types/domain.js";

export type ContactEmailVerification = {
  isValidSyntax: boolean;
  emailQualification: EmailQualification;
  emailVerified: boolean;
  requiresVerification: boolean;
  normalizedEmail?: string;
  reasons: string[];
};

const EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

const DISALLOWED_LOCAL_PARTS = new Set([
  "noreply",
  "no-reply",
  "ne-pas-repondre",
  "mailer-daemon",
  "postmaster",
  "root"
]);

/**
 * REQ-048: Strict Email Verification Gate
 * Validates email format, checks deliverability qualification, and enforces strict verification gating.
 */
export function verifyContactEmail(input: {
  email?: string;
  emailQualification?: string;
  source?: string;
  sourceType?: string;
}): ContactEmailVerification {
  const reasons: string[] = [];

  if (!input.email || typeof input.email !== "string") {
    return {
      isValidSyntax: false,
      emailQualification: "uncertain",
      emailVerified: false,
      requiresVerification: true,
      reasons: ["No email address provided."]
    };
  }

  const normalizedEmail = input.email.trim().toLowerCase().replace(/^mailto:/, "");

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return {
      isValidSyntax: false,
      emailQualification: "uncertain",
      emailVerified: false,
      requiresVerification: true,
      normalizedEmail,
      reasons: ["Invalid email syntax."]
    };
  }

  const localPart = normalizedEmail.split("@")[0] ?? "";
  if (DISALLOWED_LOCAL_PARTS.has(localPart)) {
    return {
      isValidSyntax: true,
      emailQualification: "uncertain",
      emailVerified: false,
      requiresVerification: true,
      normalizedEmail,
      reasons: [`Automated or unmonitored mailbox (${localPart}@).`]
    };
  }

  const rawQual = (input.emailQualification ?? "").toLowerCase().trim();

  if (rawQual === "verified") {
    return {
      isValidSyntax: true,
      emailQualification: "verified",
      emailVerified: true,
      requiresVerification: false,
      normalizedEmail,
      reasons: ["Verified deliverable email address from enrichment provider."]
    };
  }

  if (rawQual === "guessed") {
    reasons.push("Email is a pattern-based guess; SMTP deliverability not confirmed.");
    return {
      isValidSyntax: true,
      emailQualification: "guessed",
      emailVerified: false,
      requiresVerification: true,
      normalizedEmail,
      reasons
    };
  }

  // Default / uncertain (e.g. scraped from website or unknown source)
  reasons.push("Email deliverability is unconfirmed or derived from website scraping.");
  return {
    isValidSyntax: true,
    emailQualification: "uncertain",
    emailVerified: false,
    requiresVerification: true,
    normalizedEmail,
    reasons
  };
}

/**
 * REQ-048 Gatekeeper: Asserts if a contact is strictly eligible for automated cold outreach.
 */
export function isContactEligibleForOutreach(contact: {
  email?: string;
  emailVerified?: boolean;
  emailQualification?: string;
  doNotContact?: boolean;
  status?: string;
}): { eligible: boolean; reason?: string } {
  if (contact.doNotContact === true) {
    return { eligible: false, reason: "Contact is marked doNotContact." };
  }

  if (contact.status === "do_not_contact" || contact.status === "invalid") {
    return { eligible: false, reason: `Contact status is ${contact.status}.` };
  }

  if (!contact.email) {
    return { eligible: false, reason: "Contact has no email address." };
  }

  const verification = verifyContactEmail({
    email: contact.email,
    emailQualification: contact.emailQualification
  });

  if (!verification.isValidSyntax) {
    return { eligible: false, reason: "Invalid email syntax." };
  }

  // Strict verification requirement
  if (!contact.emailVerified && verification.emailQualification !== "verified") {
    return {
      eligible: false,
      reason: `Email is not verified (qualification: ${verification.emailQualification}). Manual verification required before automated outreach.`
    };
  }

  return { eligible: true };
}
