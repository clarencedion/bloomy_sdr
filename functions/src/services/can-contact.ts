import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getGlobalSettings } from "../utils/settings.js";

export type CanContactOptions = {
  checkDailyLimit?: boolean;
  ignoreCampaignId?: boolean;
  checkActiveConversation?: boolean;
  enforceAllowlist?: boolean;
};

export type CanContactResult = {
  allowed: boolean;
  reason?: string;
  details?: {
    email?: string;
    domain?: string;
    siren?: string;
    suppressionRule?: string;
  };
};

/** "social_handle" values read "instagram:<handle>" / "facebook:<handle>" (Phase 23). */
export type SuppressionTargetType = "email" | "domain" | "siren" | "social_handle";

export type SuppressionEntry = {
  id?: string;
  targetType: SuppressionTargetType;
  targetValue: string;
  reason: string;
  businessId?: string;
  workspaceId?: string;
  createdAt: Timestamp;
  createdBy?: string;
};

const BLACKLISTED_DOMAINS = [
  "gouv.fr",
  "gov.fr",
  "service-public.fr",
  "impots.gouv.fr",
  "interieur.gouv.fr",
  "justice.fr",
  "mailinator.com",
  "tempmail.com",
  "guerrillamail.com",
  "10minutemail.com",
  "example.com",
  "test.com",
  "localhost"
];

function isBlacklistedDomain(domain?: string): boolean {
  if (!domain) return false;
  const normalized = domain.toLowerCase().trim().replace(/^www\./, "");
  return BLACKLISTED_DOMAINS.some(
    (blocked) => normalized === blocked || normalized.endsWith(`.${blocked}`)
  );
}

function normalizeEmail(email?: string): string | undefined {
  if (!email) return undefined;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes("@") || trimmed.length < 5) return undefined;
  return trimmed;
}

function extractDomain(emailOrUrl?: string): string | undefined {
  if (!emailOrUrl) return undefined;
  const trimmed = emailOrUrl.trim().toLowerCase();
  if (trimmed.includes("@")) {
    const parts = trimmed.split("@");
    return parts[parts.length - 1].replace(/^www\./, "");
  }
  try {
    const withProto = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    return new URL(withProto).hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "").split("/")[0];
  }
}

/**
 * Checks whether an email, domain, or SIREN is suppressed in the suppressionList collection.
 */
export async function isSuppressed(input: {
  email?: string;
  domain?: string;
  siren?: string;
  businessId?: string;
}): Promise<{ suppressed: boolean; reason?: string; rule?: string }> {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedDomain = extractDomain(input.domain || input.email);
  const normalizedSiren = input.siren?.trim();

  // 1. Check email suppression
  if (normalizedEmail) {
    const emailSnap = await adminDb
      .collection("suppressionList")
      .where("targetType", "==", "email")
      .where("targetValue", "==", normalizedEmail)
      .limit(1)
      .get();

    if (!emailSnap.empty) {
      const entry = emailSnap.docs[0].data() as SuppressionEntry;
      return {
        suppressed: true,
        reason: entry.reason || "Email in suppression list",
        rule: `email:${normalizedEmail}`
      };
    }
  }

  // 2. Check domain suppression (including parent/root domains)
  if (normalizedDomain) {
    const domainParts = normalizedDomain.split(".");
    const domainsToCheck: string[] = [];
    for (let i = 0; i <= domainParts.length - 2; i++) {
      domainsToCheck.push(domainParts.slice(i).join("."));
    }

    const domainSnap = await adminDb
      .collection("suppressionList")
      .where("targetType", "==", "domain")
      .where("targetValue", "in", domainsToCheck.slice(0, 10))
      .limit(1)
      .get();

    if (!domainSnap.empty) {
      const entry = domainSnap.docs[0].data() as SuppressionEntry;
      return {
        suppressed: true,
        reason: entry.reason || "Domain in suppression list",
        rule: `domain:${entry.targetValue}`
      };
    }
  }

  // 3. Check SIREN suppression
  if (normalizedSiren) {
    const sirenSnap = await adminDb
      .collection("suppressionList")
      .where("targetType", "==", "siren")
      .where("targetValue", "==", normalizedSiren)
      .limit(1)
      .get();

    if (!sirenSnap.empty) {
      const entry = sirenSnap.docs[0].data() as SuppressionEntry;
      return {
        suppressed: true,
        reason: entry.reason || "SIREN in suppression list",
        rule: `siren:${normalizedSiren}`
      };
    }
  }

  return { suppressed: false };
}

/**
 * Evaluates contactability for explicit email and company details.
 */
export async function canContactDetails(
  details: {
    email: string;
    domain?: string;
    siren?: string;
    contactId?: string;
    companyId?: string;
    businessId?: string;
    workspaceId?: string;
    doNotContact?: boolean;
    unsubscribed?: boolean;
    bounced?: boolean;
  },
  options: CanContactOptions = {}
): Promise<CanContactResult> {
  const normalizedEmail = normalizeEmail(details.email);
  if (!normalizedEmail) {
    return { allowed: false, reason: "invalid_or_missing_email" };
  }

  if (details.doNotContact === true) {
    return { allowed: false, reason: "contact_marked_do_not_contact" };
  }
  if (details.unsubscribed === true) {
    return { allowed: false, reason: "contact_unsubscribed" };
  }
  if (details.bounced === true) {
    return { allowed: false, reason: "contact_bounced" };
  }

  const domain = extractDomain(details.domain || normalizedEmail);
  if (isBlacklistedDomain(domain)) {
    return { allowed: false, reason: `domain_blacklisted: ${domain}` };
  }

  // 0. Safety Invariant: Test Mode Email Allowlist Containment
  const settings = await getGlobalSettings();
  if (options.enforceAllowlist || settings.testModeEnabled) {
    const rawAllowlist = settings.testEmailAllowlist || [];
    const allowlist = rawAllowlist
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    if (allowlist.length > 0) {
      const isEmailAllowed = allowlist.some((allowed) => {
        if (allowed.startsWith("@")) {
          return normalizedEmail.endsWith(allowed);
        }
        return normalizedEmail === allowed;
      });

      if (!isEmailAllowed) {
        return {
          allowed: false,
          reason: `test_mode_allowlist_blocked: Contact email ${normalizedEmail} is not authorized in test mode allowlist`,
          details: {
            email: normalizedEmail,
            domain,
            siren: details.siren
          }
        };
      }
    }
  }

  // 1. Check suppression list (email, domain, SIREN)
  const suppressionCheck = await isSuppressed({
    email: normalizedEmail,
    domain,
    siren: details.siren,
    businessId: details.businessId
  });

  if (suppressionCheck.suppressed) {
    return {
      allowed: false,
      reason: `suppressed: ${suppressionCheck.reason}`,
      details: {
        email: normalizedEmail,
        domain,
        siren: details.siren,
        suppressionRule: suppressionCheck.rule
      }
    };
  }

  if (options.checkActiveConversation) {
    const activeConvSnap = await adminDb
      .collection("conversations")
      .where("prospectEmail", "==", normalizedEmail)
      .where("status", "in", ["active", "waiting_reply", "draft_ready", "booking_offered", "meeting_booked"])
      .limit(1)
      .get();

    if (!activeConvSnap.empty) {
      const conv = activeConvSnap.docs[0].data();
      return {
        allowed: false,
        reason: `active_conversation_locked (status: ${conv.status})`
      };
    }
  }

  if (options.checkDailyLimit) {
    const settings = await getGlobalSettings();
    const limit = settings.dailyOutreachSendLimit ?? 20;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const sentTodaySnap = await adminDb
      .collection("outreach")
      .where("status", "==", "sent")
      .where("sentAt", ">=", Timestamp.fromDate(startOfDay))
      .count()
      .get();

    const sentToday = sentTodaySnap.data().count;
    if (sentToday >= limit) {
      return {
        allowed: false,
        reason: `daily_outreach_send_limit_reached (${sentToday}/${limit})`
      };
    }
  }

  return {
    allowed: true,
    details: {
      email: normalizedEmail,
      domain,
      siren: details.siren
    }
  };
}

/**
 * Canonical gatekeeper enforcing Invariant 3 (Contactability & Suppression Invariant).
 * Evaluates contact flags, company flags, suppression list entries, domain blacklists, and daily rate limits.
 */
export async function canContact(
  contactId: string,
  businessId?: string,
  options: CanContactOptions = {}
): Promise<CanContactResult> {
  if (!contactId) {
    return { allowed: false, reason: "contact_id_missing" };
  }

  const contactSnap = await adminDb.collection("contacts").doc(contactId).get();
  if (!contactSnap.exists) {
    return { allowed: false, reason: "contact_not_found" };
  }

  const contact = contactSnap.data() as {
    email?: string;
    normalizedEmail?: string;
    companyId?: string;
    doNotContact?: boolean;
    unsubscribed?: boolean;
    bounced?: boolean;
    status?: string;
  };

  const rawEmail = contact.normalizedEmail || contact.email;
  const email = normalizeEmail(rawEmail);
  if (!email) {
    return { allowed: false, reason: "contact_missing_valid_email" };
  }

  if (contact.doNotContact === true) {
    return { allowed: false, reason: "contact_marked_do_not_contact" };
  }
  if (contact.unsubscribed === true) {
    return { allowed: false, reason: "contact_unsubscribed" };
  }
  if (contact.bounced === true) {
    return { allowed: false, reason: "contact_bounced" };
  }
  if (contact.status === "suppressed" || contact.status === "opted_out") {
    return { allowed: false, reason: "contact_status_suppressed" };
  }

  let companyDomain: string | undefined;
  let companySiren: string | undefined;

  if (contact.companyId) {
    const companySnap = await adminDb.collection("companies").doc(contact.companyId).get();
    if (companySnap.exists) {
      const company = companySnap.data() as {
        domain?: string;
        siren?: string;
        doNotContact?: boolean;
        status?: string;
      };

      if (company.doNotContact === true) {
        return { allowed: false, reason: "company_marked_do_not_contact" };
      }
      if (company.status === "disqualified") {
        return { allowed: false, reason: "company_disqualified" };
      }

      companyDomain = company.domain;
      companySiren = company.siren;
    }
  }

  return canContactDetails(
    {
      email,
      domain: companyDomain,
      siren: companySiren,
      contactId,
      companyId: contact.companyId,
      businessId,
      doNotContact: contact.doNotContact,
      unsubscribed: contact.unsubscribed,
      bounced: contact.bounced
    },
    options
  );
}

/**
 * Adds an entry to the suppressionList collection.
 */
export async function addToSuppressionList(entry: {
  targetType: SuppressionTargetType;
  targetValue: string;
  reason: string;
  businessId?: string;
  workspaceId?: string;
  createdBy?: string;
}): Promise<string> {
  const normalizedValue =
    entry.targetType === "email"
      ? normalizeEmail(entry.targetValue) || entry.targetValue.trim().toLowerCase()
      : entry.targetType === "domain"
      ? extractDomain(entry.targetValue) || entry.targetValue.trim().toLowerCase()
      : entry.targetType === "social_handle"
      ? // Handles are stored lowercase without "@", like the gate reads them.
        entry.targetValue.trim().toLowerCase().replace(/:@/, ":")
      : entry.targetValue.trim();

  // Check if entry already exists to avoid duplicates
  const existingSnap = await adminDb
    .collection("suppressionList")
    .where("targetType", "==", entry.targetType)
    .where("targetValue", "==", normalizedValue)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    return existingSnap.docs[0].id;
  }

  const docRef = await adminDb.collection("suppressionList").add({
    targetType: entry.targetType,
    targetValue: normalizedValue,
    reason: entry.reason,
    businessId: entry.businessId ?? null,
    workspaceId: entry.workspaceId ?? null,
    createdBy: entry.createdBy ?? "system",
    createdAt: Timestamp.now()
  });

  return docRef.id;
}

/**
 * Removes an entry from the suppressionList collection.
 */
export async function removeFromSuppressionList(
  targetValue: string,
  targetType?: SuppressionTargetType
): Promise<number> {
  const normalized = targetValue.trim().toLowerCase();
  let queryRef = adminDb.collection("suppressionList").where("targetValue", "==", normalized);

  if (targetType) {
    queryRef = queryRef.where("targetType", "==", targetType);
  }

  const snap = await queryRef.get();
  if (snap.empty) return 0;

  const batch = adminDb.batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
  return snap.size;
}
