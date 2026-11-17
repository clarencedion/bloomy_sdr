import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getIntegrationSecrets } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { recordApiSpend } from "./cost-guardrail-service.js";
import {
  BouncerEmailVerifier,
  DnsEmailVerifier,
  type EmailVerificationProvider,
  type EmailVerificationResult
} from "../providers/enrichment/email-verification-provider.js";

/**
 * Verifies a contact's address before anything is sent to it, and remembers the
 * verdict on the contact.
 *
 * Sending to scraped addresses without checking is the fastest way to damage a
 * sending domain: hard bounces above ~5% degrade delivery for every subsequent
 * message. The free DNS tier removes dead domains at no cost; the paid tier is
 * used when a key is configured.
 *
 * Results are cached on the contact for 30 days - re-verifying the same address
 * on every send would multiply cost for no new information.
 */

const VERIFICATION_TTL_DAYS = 30;

export interface VerifiedContact {
  verdict: EmailVerificationResult["verdict"];
  verified: boolean;
  reason?: string;
  provider: string;
  /** True when the address must not be sent to. */
  blocked: boolean;
  cached: boolean;
}

function isFresh(verifiedAt: unknown): boolean {
  if (!verifiedAt) return false;
  const millis =
    typeof (verifiedAt as { toMillis?: () => number }).toMillis === "function"
      ? (verifiedAt as { toMillis: () => number }).toMillis()
      : new Date(verifiedAt as string).getTime();
  if (Number.isNaN(millis)) return false;
  return Date.now() - millis < VERIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

async function resolveProvider(): Promise<EmailVerificationProvider> {
  const secrets = await getIntegrationSecrets().catch(() => ({}) as Record<string, string>);
  const key = (secrets as Record<string, string>).emailVerifierApiKey;

  const paid = new BouncerEmailVerifier(key);
  // The free DNS check is the floor, not a fallback: it costs nothing and
  // catches the failure mode that scraped lists actually suffer from.
  return paid.isConfigured() ? paid : new DnsEmailVerifier();
}

export async function verifyContactBeforeSend(input: {
  contactId: string;
  workspaceId?: string;
  businessId?: string;
}): Promise<VerifiedContact> {
  const ref = adminDb.collection("contacts").doc(input.contactId);
  const snap = await ref.get();

  if (!snap.exists) {
    return { verdict: "undeliverable", verified: false, provider: "none", blocked: true, cached: false, reason: "Contact not found." };
  }

  const contact = snap.data() ?? {};
  const email = String(contact.email ?? "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return { verdict: "undeliverable", verified: false, provider: "none", blocked: true, cached: false, reason: "Contact has no email address." };
  }

  // Reuse a recent verdict rather than paying for the same answer twice.
  if (contact.emailVerificationVerdict && isFresh(contact.emailVerifiedAt)) {
    const verdict = contact.emailVerificationVerdict as EmailVerificationResult["verdict"];
    return {
      verdict,
      verified: contact.emailVerified === true,
      provider: String(contact.emailVerificationProvider ?? "cache"),
      reason: contact.emailVerificationReason as string | undefined,
      blocked: verdict === "undeliverable",
      cached: true
    };
  }

  const provider = await resolveProvider();
  const result = await provider.verify(email);

  const now = Timestamp.now();
  await ref.set(
    {
      emailVerified: result.verified,
      emailVerificationVerdict: result.verdict,
      emailVerificationProvider: result.provider,
      emailVerificationReason: result.reason ?? null,
      emailVerifiedAt: now,
      // An address that cannot receive mail must never be attempted again.
      ...(result.verdict === "undeliverable" ? { status: "invalid", doNotContact: true } : {}),
      updatedAt: now
    },
    { merge: true }
  );

  if (result.costUsd > 0) {
    await recordApiSpend({
      workspaceId: input.workspaceId ?? "ws_default",
      businessId: input.businessId ?? "",
      provider: result.provider,
      costUsd: result.costUsd,
      operation: "email_verification",
      companyId: contact.companyId as string | undefined
    }).catch(() => undefined);
  }

  if (result.verdict === "undeliverable") {
    await writeLog({
      type: "contact.email_undeliverable",
      level: "warning",
      message: `${email} cannot receive mail — blocked before sending. ${result.reason ?? ""}`.trim(),
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      metadata: { contactId: input.contactId, email, provider: result.provider, reason: result.reason }
    });
  }

  return {
    verdict: result.verdict,
    verified: result.verified,
    provider: result.provider,
    reason: result.reason,
    blocked: result.verdict === "undeliverable",
    cached: false
  };
}
