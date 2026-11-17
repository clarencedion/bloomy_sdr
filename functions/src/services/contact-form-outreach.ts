import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import { detectContactForm, type DetectedContactForm } from "./contact-form-detector.js";
import { resolveSender } from "./sender-resolver.js";
import { isSuppressed } from "./can-contact.js";
import { getGlobalSettings } from "../utils/settings.js";

/**
 * Sends a prospect a message through the contact form they published.
 *
 * The form is an invitation to be contacted, and a message sent through it
 * lands in the inbox the business itself configured - so it bypasses spam
 * filtering entirely. For a small business with no findable email this is
 * frequently the only channel that exists.
 *
 * The restraint that makes this defensible rather than spam:
 *  - one message per company, ever
 *  - a CAPTCHA is never solved or worked around - it becomes an assisted send
 *  - honeypot fields are left empty
 *  - a real reply address is supplied, so the prospect can answer or refuse
 *  - safe mode blocks it outright, since a form has no address to allowlist
 *  - the suppression list is checked by domain and SIREN before posting
 */

export interface ContactFormSendResult {
  status: "sent" | "assisted" | "skipped";
  channel: DetectedContactForm["channel"];
  pageUrl?: string;
  reason?: string;
}

/** Builds the payload, leaving traps untouched. */
export function buildPayload(
  form: DetectedContactForm,
  message: { name: string; email: string; subject: string; body: string }
): URLSearchParams {
  const payload = new URLSearchParams();

  for (const field of form.fields ?? []) {
    switch (field.role) {
      case "name":
        payload.set(field.name, message.name);
        break;
      case "email":
        payload.set(field.name, message.email);
        break;
      case "subject":
        payload.set(field.name, message.subject);
        break;
      case "message":
        payload.set(field.name, message.body);
        break;
      case "consent":
        // A consent checkbox is the prospect's own GDPR notice; ticking it is
        // how the form expects to be submitted at all.
        payload.set(field.name, field.value ?? "1");
        break;
      case "hidden":
        // Two kinds live here: framework tokens that carry a real value and
        // must be echoed, and honeypots that must stay empty. A hidden field
        // with a value is the former; one without is the latter.
        if (field.value) payload.set(field.name, field.value);
        break;
      case "phone":
      case "other":
      default:
        if (field.required && field.value) payload.set(field.name, field.value);
        break;
    }
  }

  return payload;
}

export async function sendViaContactForm(input: {
  companyId: string;
  outreachId: string;
  subject: string;
  body: string;
}): Promise<ContactFormSendResult> {
  const companySnap = await adminDb.collection("companies").doc(input.companyId).get();
  if (!companySnap.exists) return { status: "skipped", channel: "none", reason: "Company not found." };

  const company = companySnap.data() ?? {};
  const workspaceId = (company.workspaceId as string) || "ws_default";
  const businessId = company.businessId as string | undefined;

  // One message per company, ever. A second submission through a contact form
  // is indistinguishable from spam, whatever the content says.
  if (company.contactFormSentAt) {
    return { status: "skipped", channel: "none", reason: "A message was already sent through this form." };
  }

  // This is the one channel that posts to a prospect without an email address,
  // so the two gates email relies on have to be applied here explicitly.
  const settings = await getGlobalSettings();
  if (settings.testModeEnabled) {
    // Safe mode contains outbound email by allowlist; a form submission has no
    // address to check against it, so the only honest containment is refusal.
    return {
      status: "assisted",
      channel: "assisted",
      reason: "Safe mode is on — nothing was sent. Turn it off in Settings to submit forms automatically."
    };
  }

  const domain = (company.website as string | undefined) ?? (company.domain as string | undefined);
  const suppression = await isSuppressed({ domain, siren: company.siren as string | undefined, businessId });
  if (suppression.suppressed) {
    await writeLog({
      type: "outreach.suppressed",
      level: "info",
      message: "Contact form submission skipped — the company is suppressed.",
      workspaceId,
      businessId,
      metadata: { companyId: input.companyId, outreachId: input.outreachId, rule: suppression.rule }
    });
    return { status: "skipped", channel: "none", reason: suppression.reason ?? "This company asked not to be contacted." };
  }

  const form = await detectContactForm(company.website as string | undefined);

  if (form.channel === "none") {
    return { status: "skipped", channel: "none", reason: form.reason };
  }

  if (form.channel === "assisted") {
    await adminDb.collection("outreach").doc(input.outreachId).set(
      { contactFormUrl: form.pageUrl, contactFormReason: form.reason, contactFormSubmittable: false, updatedAt: Timestamp.now() },
      { merge: true }
    );
    return { status: "assisted", channel: "assisted", pageUrl: form.pageUrl, reason: form.reason };
  }

  const sender = await resolveSender({ workspaceId, businessId });
  if (!sender?.email) {
    // Without a real reply address the prospect could not answer or object,
    // which is exactly what separates outreach from spam.
    return { status: "skipped", channel: form.channel, reason: "No sending address configured for this business." };
  }

  const payload = buildPayload(form, {
    name: sender.name ?? "Bonjour",
    email: sender.email,
    subject: input.subject,
    body: input.body
  });

  try {
    const response = await fetch(String(form.action), {
      method: form.method === "GET" ? "GET" : "POST",
      signal: AbortSignal.timeout(12000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (compatible; SDR-Outreach/1.0)",
        Referer: String(form.pageUrl ?? form.action)
      },
      body: payload.toString()
    });

    // Many forms redirect to a thank-you page on success; 2xx and 3xx both count.
    const accepted = response.status >= 200 && response.status < 400;

    if (!accepted) {
      await adminDb.collection("outreach").doc(input.outreachId).set(
        {
          contactFormUrl: form.pageUrl,
          contactFormReason: `Their form rejected the message (${response.status}) — send it by hand.`,
          contactFormSubmittable: false,
          updatedAt: Timestamp.now()
        },
        { merge: true }
      );
      return { status: "assisted", channel: "assisted", pageUrl: form.pageUrl, reason: `The form returned ${response.status} — send it by hand.` };
    }

    const now = Timestamp.now();
    await companySnap.ref.set({ contactFormSentAt: now, status: "contacted", lastActivityAt: now, updatedAt: now }, { merge: true });
    await adminDb.collection("outreach").doc(input.outreachId).set(
      { status: "sent", sentAt: now, contactFormUrl: form.pageUrl, updatedAt: now },
      { merge: true }
    );

    await writeLog({
      type: "outreach.contact_form.sent",
      level: "info",
      message: `Message sent through the contact form of ${company.name}.`,
      workspaceId,
      businessId,
      metadata: { companyId: input.companyId, outreachId: input.outreachId, pageUrl: form.pageUrl }
    });

    return { status: "sent", channel: "submittable", pageUrl: form.pageUrl };
  } catch (error) {
    return {
      status: "assisted",
      channel: "assisted",
      pageUrl: form.pageUrl,
      reason: error instanceof Error ? error.message : "The form could not be submitted."
    };
  }
}
