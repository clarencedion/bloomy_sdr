import type { SignalContext, SignalProvider, SignalResult } from "./signal-provider.js";
import type { EvidenceItem } from "../../types/domain.js";
import { isThirdPartyEmail } from "../../services/third-party-domains.js";

/**
 * Reads the contact details a small business publishes on its public social and
 * link-in-bio pages.
 *
 * Why this exists: for trades like tattoo studios, salons and barbers, the
 * Instagram bio IS the business. Many have no website, no LinkedIn and no entry
 * in any B2B database - measured here, roughly half of qualified prospects had
 * no reachable contact at all. What they do have is a "Contact" button and a
 * Linktree, both of which they publish deliberately so customers can reach them.
 *
 * Scope is deliberately narrow and public-only:
 *  - It reads pages that are public by design; it never logs in, and it never
 *    sends anything. Automated cold DMs would breach every platform's terms and
 *    risk the operator's own account, so that is explicitly out of scope.
 *  - Link-in-bio pages (Linktree and friends) are plain HTML and by far the
 *    richest source. Instagram itself is heavily gated, so we treat a miss there
 *    as normal rather than an error.
 */

/** Link-in-bio hosts, which are plain HTML and the most reliable source. */
const LINK_IN_BIO_HOSTS = [
  "linktr.ee",
  "beacons.ai",
  "bio.link",
  "linkr.bio",
  "campsite.bio",
  "milkshake.app",
  "taplink.cc",
  "solo.to",
  "carrd.co",
  "later.com"
];

const SOCIAL_HOSTS = ["instagram.com", "facebook.com", "fb.com", "tiktok.com"];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_FR_RE = /(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isLinkInBio(url: string): boolean {
  const host = hostOf(url);
  return LINK_IN_BIO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function isSocial(url: string): boolean {
  const host = hostOf(url);
  return SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Decodes the escaped markup that JSON-embedded HTML leaves around addresses. */
function decode(value: string): string {
  return value
    .replace(/\\u003[ce]/gi, " ")
    .replace(/\\u0026/gi, "&")
    .replace(/&(?:gt|lt|amp|quot|#39|nbsp);/gi, " ")
    .replace(/\\[rnt]/g, " ");
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SDR-Research/1.0)",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    if (!response.ok) return null;
    return decode(await response.text());
  } catch {
    return null;
  }
}

/** Social and link-in-bio URLs the company links to from its own site. */
function extractSocialLinks(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
    const url = match[0].replace(/[.,)]+$/, "");
    if (isSocial(url) || isLinkInBio(url)) found.add(url);
  }
  return [...found].slice(0, 8);
}

export class SocialProfileProvider implements SignalProvider {
  readonly id = "social_profile";
  readonly name = "Public Social & Link-in-Bio Contact Details";
  readonly description =
    "Reads the email, phone and booking links a business publishes on its public social profile or link-in-bio page. Read-only; never messages anyone.";
  readonly capabilities = [
    "instagram_url",
    "facebook_url",
    "link_in_bio_url",
    "social_email",
    "social_phone",
    "social_booking_url",
    "has_social_presence"
  ];
  readonly costPerExecutionUsd = 0;
  readonly timeoutMs = 25000;

  supports(context: SignalContext): boolean {
    return Boolean(context.company?.website || context.company?.domain);
  }

  async collect(context: SignalContext): Promise<SignalResult> {
    const startTime = Date.now();
    const now = new Date();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const evidence: Array<Omit<EvidenceItem, "id" | "workspaceId" | "businessId" | "companyId">> = [];

    const site = context.company?.website || `https://${context.company?.domain}`;
    let origin: string;
    try {
      origin = new URL(site).toString();
    } catch {
      return {
        providerId: this.id,
        evidence: [],
        costEstimateUsd: 0,
        durationMs: Date.now() - startTime,
        error: "No usable URL for social discovery."
      };
    }

    // 1. The company's own page usually links to its socials and link-in-bio.
    const siteHtml = await fetchText(origin);
    let links = siteHtml ? extractSocialLinks(siteHtml) : [];

    // The "website" itself is often already the social page for this segment.
    if (isSocial(origin) || isLinkInBio(origin)) links = [origin, ...links];

    const instagram = links.find((l) => hostOf(l).includes("instagram.com"));
    const facebook = links.find((l) => hostOf(l).includes("facebook.com") || hostOf(l).includes("fb.com"));
    const linkInBio = links.find((l) => isLinkInBio(l));

    // 2. Read the pages that are actually readable. Link-in-bio first: it is
    //    plain HTML and exists precisely to publish contact routes. Instagram
    //    is heavily gated, so a miss there is expected, not an error.
    const emails = new Set<string>();
    const phones = new Set<string>();
    const bookingLinks = new Set<string>();

    for (const target of [linkInBio, facebook, instagram].filter(Boolean) as string[]) {
      const html = await fetchText(target, 7000);
      if (!html) continue;

      for (const match of html.match(EMAIL_RE) ?? []) {
        const email = match.toLowerCase();
        if (isThirdPartyEmail(email)) continue; // the platform's own address
        if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email)) continue;
        if (/^u00[0-9a-f]{2}/i.test(email)) continue;
        emails.add(email);
      }
      for (const match of html.match(PHONE_FR_RE) ?? []) {
        phones.add(match.replace(/[\s.-]/g, ""));
      }
      for (const match of html.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
        const url = match[0].replace(/[.,)]+$/, "");
        if (/planity|treatwell|fresha|booksy|calendly|cal\.com|doctolib/i.test(url)) bookingLinks.add(url);
      }
    }

    const push = (key: string, value: unknown, nature: EvidenceItem["nature"], confidence: number, sourceUrl: string) => {
      evidence.push({
        signalProvider: this.id,
        key,
        value: value as EvidenceItem["value"],
        sourceType: "website",
        sourceUrl,
        confidence,
        nature,
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });
    };

    if (instagram) push("instagram_url", instagram, "fact", 90, instagram);
    if (facebook) push("facebook_url", facebook, "fact", 90, facebook);
    if (linkInBio) push("link_in_bio_url", linkInBio, "fact", 90, linkInBio);
    push("has_social_presence", Boolean(instagram || facebook || linkInBio), "fact", 85, origin);

    if (emails.size) push("social_email", [...emails].slice(0, 5), "fact", 80, linkInBio ?? facebook ?? instagram ?? origin);
    if (phones.size) push("social_phone", [...phones].slice(0, 3), "fact", 75, linkInBio ?? facebook ?? instagram ?? origin);
    if (bookingLinks.size) push("social_booking_url", [...bookingLinks].slice(0, 3), "fact", 80, linkInBio ?? origin);

    return {
      providerId: this.id,
      evidence,
      costEstimateUsd: 0,
      durationMs: Date.now() - startTime
    };
  }
}
