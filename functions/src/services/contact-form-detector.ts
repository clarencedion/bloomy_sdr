/**
 * Finds a business's contact form and decides whether it may be submitted.
 *
 * A contact form is an explicit invitation to be contacted - that is its entire
 * purpose - and a message sent through it reaches the inbox the business chose,
 * bypassing spam filtering entirely. For a small business with no published
 * email that is often the only real channel.
 *
 * Two hard limits are encoded here rather than left to the caller:
 *
 *  - **A CAPTCHA is a refusal.** If the page carries reCAPTCHA, hCaptcha or
 *    Turnstile, the owner has explicitly asked for a human. We never solve,
 *    outsource, or work around it - the form is marked assisted-only.
 *  - **Honeypot fields stay empty.** Hidden inputs exist to catch bots that
 *    fill everything. Filling one identifies us as a bot and can blacklist the
 *    sending domain, so they are detected and skipped.
 */

import { describeUnusableWebsite, isUsableCompanyWebsite } from "./third-party-domains.js";

export type FormChannel =
  /** Plain HTML form, no CAPTCHA - may be submitted programmatically. */
  | "submittable"
  /** A form exists but a human must send it (CAPTCHA or third-party widget). */
  | "assisted"
  /** No contact form found. */
  | "none";

export interface ContactFormField {
  name: string;
  type: string;
  /** Our best guess at what the field is for. */
  role: "name" | "email" | "phone" | "subject" | "message" | "consent" | "hidden" | "other";
  required: boolean;
  value?: string;
}

export interface DetectedContactForm {
  channel: FormChannel;
  /** Page the form lives on. */
  pageUrl?: string;
  /** Where the submission would be POSTed. */
  action?: string;
  method?: string;
  fields?: ContactFormField[];
  /** Why a human is needed, when channel is "assisted". */
  reason?: string;
}

const CONTACT_PATHS = ["/contact", "/contactez-nous", "/nous-contacter", "/contact-us", "/devis"];

const CAPTCHA_MARKERS = [
  "recaptcha",
  "g-recaptcha",
  "hcaptcha",
  "cf-turnstile",
  "turnstile",
  "friendlycaptcha"
];

/** Embedded third-party forms render client-side; there is no HTML form to post. */
const THIRD_PARTY_FORM_MARKERS = [
  "typeform",
  "hsforms",
  "hubspot",
  "jotform",
  "wufoo",
  "formstack",
  "tally.so",
  "getform",
  "formspree"
];

/** Field names that exist only to trap bots. Never fill these. */
const HONEYPOT_NAMES = ["honeypot", "honey_pot", "hp", "bot-field", "botfield", "url", "website_confirm", "_gotcha"];

function classifyField(name: string, type: string, isHidden: boolean): ContactFormField["role"] {
  const n = name.toLowerCase();
  if (isHidden || type === "hidden") return "hidden";
  if (type === "email" || /e-?mail|courriel/.test(n)) return "email";
  if (type === "tel" || /phone|tel|telephone/.test(n)) return "phone";
  if (/message|comment|content|body|question|demande|texte/.test(n)) return "message";
  if (/subject|objet|sujet/.test(n)) return "subject";
  if (/name|nom|prenom|firstname|lastname|société|societe|company/.test(n)) return "name";
  if (type === "checkbox" && /consent|rgpd|gdpr|accept|politique|privacy/.test(n)) return "consent";
  return "other";
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(9000),
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SDR-Research/1.0)",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/** Extracts the first form that plausibly accepts a message. */
export function parseForm(html: string, pageUrl: string): DetectedContactForm | null {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];

  for (const match of forms) {
    const attrs = match[1];
    const body = match[2];

    const hasMessageField = /<textarea/i.test(body) || /name=["'][^"']*(message|demande|comment)/i.test(body);
    const hasEmailField = /type=["']email["']|name=["'][^"']*e-?mail/i.test(body);
    if (!hasMessageField && !hasEmailField) continue;

    const actionMatch = attrs.match(/action=["']([^"']*)["']/i);
    const methodMatch = attrs.match(/method=["']([^"']*)["']/i);

    let action = pageUrl;
    if (actionMatch?.[1]) {
      try {
        action = new URL(actionMatch[1], pageUrl).toString();
      } catch {
        action = pageUrl;
      }
    }

    const fields: ContactFormField[] = [];
    const inputs = [
      ...body.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)
    ];

    for (const input of inputs) {
      const tag = input[1].toLowerCase();
      const attrText = input[2];
      const name = attrText.match(/name=["']([^"']+)["']/i)?.[1];
      if (!name) continue;

      const type = tag === "textarea" ? "textarea" : (attrText.match(/type=["']([^"']+)["']/i)?.[1] ?? "text").toLowerCase();
      // A field hidden by attribute or inline style is a trap, not a control.
      const isHidden =
        type === "hidden" ||
        /style=["'][^"']*display\s*:\s*none/i.test(attrText) ||
        /hidden\b/i.test(attrText) ||
        HONEYPOT_NAMES.includes(name.toLowerCase());

      fields.push({
        name,
        type,
        role: classifyField(name, type, isHidden),
        required: /\brequired\b/i.test(attrText),
        value: attrText.match(/value=["']([^"']*)["']/i)?.[1]
      });
    }

    if (!fields.some((f) => f.role === "message") && !fields.some((f) => f.role === "email")) continue;

    return {
      channel: "submittable",
      pageUrl,
      action,
      method: (methodMatch?.[1] ?? "POST").toUpperCase(),
      fields
    };
  }

  return null;
}

export async function detectContactForm(website: string | undefined): Promise<DetectedContactForm> {
  if (!website) return { channel: "none", reason: "No website." };

  // Last line of defence, independent of what discovery stored. A company's
  // "website" has been observed holding a Waze map, a government accessibility
  // listing and a blog post about the owner; submitting a form on any of those
  // sends a commercial message to a stranger. Checked here as well as at
  // discovery so existing bad data cannot reach a send.
  if (!isUsableCompanyWebsite(website)) {
    return {
      channel: "none",
      reason: `Their listed address is ${describeUnusableWebsite(website)} — no form was contacted.`
    };
  }

  let origin: string;
  try {
    origin = new URL(website).origin;
  } catch {
    return { channel: "none", reason: "Unusable website URL." };
  }

  // Contact pages first - that is where the form almost always lives.
  const candidates = [...CONTACT_PATHS.map((path) => `${origin}${path}`), website];

  for (const url of candidates) {
    const html = await fetchPage(url);
    if (!html) continue;

    const lower = html.toLowerCase();

    if (CAPTCHA_MARKERS.some((marker) => lower.includes(marker))) {
      // The owner asked for a human. That request is respected, not solved.
      return {
        channel: "assisted",
        pageUrl: url,
        reason: "The form is protected by a CAPTCHA — a person must send it."
      };
    }

    if (THIRD_PARTY_FORM_MARKERS.some((marker) => lower.includes(marker))) {
      return {
        channel: "assisted",
        pageUrl: url,
        reason: "The form is a third-party widget rendered in the browser."
      };
    }

    const parsed = parseForm(html, url);
    if (parsed) return parsed;
  }

  return { channel: "none", reason: "No contact form found." };
}
