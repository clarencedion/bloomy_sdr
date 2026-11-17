import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import { updateCompanyLeadReadiness } from "./lead-readiness.js";
import { isThirdPartyEmail } from "./third-party-domains.js";

type CrawledPage = {
  url: string;
  title?: string;
  description?: string;
  text: string;
  html: string;
};

const MAX_PAGES = 5;
const MAX_TEXT_CHARS = 14000;
const KEYWORDS = [
  "formation",
  "recrutement",
  "commercial",
  "commerciaux",
  "vente",
  "terrain",
  "flotte",
  "securite",
  "sécurité",
  "qhse",
  "prevention",
  "prévention",
  "maintenance",
  "livraison",
  "technicien",
  "techniciens",
  "contact",
  "rh"
];

const PAGE_HINTS = [
  "contact",
  "contacts",
  "nous-contacter",
  "a-propos",
  "qui-sommes-nous",
  "equipe",
  "team",
  "recrutement",
  "carrieres",
  "carriere",
  "careers",
  "mentions-legales"
];

function cleanText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#64;/g, "@")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase().replace(/^mailto:/, "");
}

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

function emailKind(email: string) {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (["contact", "info", "hello", "bonjour", "accueil"].includes(local)) return "generic_contact";
  if (["commercial", "sales", "vente", "devis"].includes(local)) return "commercial";
  if (["rh", "recrutement", "jobs", "carriere", "carrieres"].includes(local)) return "hr_training";
  if (["direction", "dirigeant", "dg"].includes(local)) return "direction";
  return "professional";
}

function roleFromEmail(email: string) {
  const kind = emailKind(email);
  if (kind === "commercial") return "Contact commercial";
  if (kind === "hr_training") return "Contact RH / formation";
  if (kind === "direction") return "Direction";
  if (kind === "generic_contact") return "Contact general";
  return "Contact professionnel";
}

function extractEmails(text: string, html: string) {
  // Decode escaped markup first: JSON-embedded HTML leaves sequences like
  // \u003e (">") glued to the address, producing "u003econtact@salon.fr",
  // which looks valid to the regex and would be emailed as-is.
  const decode = (value: string) =>
    value
      .replace(/\\u003[ce]/gi, " ")
      .replace(/\\u0026/gi, "&")
      .replace(/&(?:gt|lt|amp|quot|#39|nbsp);/gi, " ")
      .replace(/\\[rnt]/g, " ");

  const source = `${decode(text)} ${decode(html)
    .replace(/\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(at\)\s*/gi, "@")}`;

  const matches = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

  return [...new Set(matches.map(normalizeEmail))]
    .filter((email) => !email.endsWith(".png") && !email.endsWith(".jpg") && !email.includes("example."))
    // Reject leftovers of an escape sequence that survived decoding.
    .filter((email) => !/^u00[0-9a-f]{2}/i.test(email))
    // Never keep a booking platform's or directory's own address: scraping a
    // salon's Booksy page yields help.fr@booksy.com, which is not the prospect.
    .filter((email) => !isThirdPartyEmail(email))
    .slice(0, 12);
}

const FRENCH_GENERIC_PROVIDERS = [
  "gmail.com",
  "yahoo.fr",
  "yahoo.com",
  "orange.fr",
  "wanadoo.fr",
  "sfr.fr",
  "free.fr",
  "laposte.net",
  "outlook.fr",
  "outlook.com",
  "hotmail.fr",
  "hotmail.com",
  "live.fr",
  "live.com",
  "icloud.com"
];

const EXCLUDED_TECH_DOMAINS = [
  "wordpress.org",
  "wordpress.com",
  "wix.com",
  "shopify.com",
  "prestashop.com",
  "joomla.org",
  "drupal.org",
  "squarespace.com",
  "google.com",
  "facebook.com",
  "twitter.com",
  "instagram.com",
  "linkedin.com",
  "github.com",
  "canva.com",
  "adobe.com"
];

export function isEmailDomainAllowed(email: string, companyDomain?: string): boolean {
  const emailDomain = email.split("@")[1]?.toLowerCase().trim();
  if (!emailDomain) return false;

  if (EXCLUDED_TECH_DOMAINS.includes(emailDomain)) return false;

  if (companyDomain) {
    const normalizedCompanyDomain = companyDomain.toLowerCase().trim().replace(/^www\./, "");
    if (emailDomain === normalizedCompanyDomain || emailDomain.endsWith(`.${normalizedCompanyDomain}`)) {
      return true;
    }
  }

  if (FRENCH_GENERIC_PROVIDERS.includes(emailDomain)) {
    return true;
  }

  if (!companyDomain) return true;

  return false;
}


function extractPhones(text: string) {
  const matches = text.match(/(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g) ?? [];
  return [...new Set(matches.map(normalizePhone))].slice(0, 8);
}

function extractLinks(pageUrl: URL, html: string) {
  const links = [...html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter(Boolean)
    .map((href) => {
      try {
        return new URL(href, pageUrl).toString();
      } catch {
        return undefined;
      }
    })
    .filter((url): url is string => Boolean(url));
  const matching = [...new Set(links)].filter((link) => {
    const url = new URL(link);
    if (url.hostname.replace(/^www\./, "") !== pageUrl.hostname.replace(/^www\./, "")) return false;
    const normalized = `${url.pathname} ${url.search}`.toLowerCase();
    return PAGE_HINTS.some((hint) => normalized.includes(hint));
  });

  // Only a handful of pages are fetched, so order matters. In France the LCEN
  // obliges every commercial site to publish contact details in its mentions
  // légales - it is the single most reliable page for an address, and it sits
  // in the footer, so in DOM order it was being crawled last or not at all.
  const priority = (link: string): number => {
    const path = link.toLowerCase();
    if (path.includes("mentions-legales") || path.includes("mentions_legales")) return 0;
    if (path.includes("contact")) return 1;
    if (path.includes("equipe") || path.includes("team") || path.includes("qui-sommes")) return 2;
    return 3;
  };

  return matching.sort((a, b) => priority(a) - priority(b));
}

function pageKind(url: string) {
  const lower = url.toLowerCase();
  if (lower.includes("recrut") || lower.includes("carriere") || lower.includes("career") || lower.includes("jobs")) return "careers";
  if (lower.includes("contact")) return "contact";
  if (lower.includes("mention")) return "legal";
  return "context";
}

async function fetchPage(url: URL): Promise<CrawledPage | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "DevcommSalesOS/0.1 LeadEnrichment (+https://devcomm-os.firebaseapp.com)" }
    });
    if (!response.ok) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return undefined;
    const html = await response.text();
    const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim();
    const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]?.trim();
    return { url: url.toString(), title, description, text: cleanText(html), html };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function websiteUrl(website?: unknown, domain?: unknown) {
  const raw = typeof website === "string" && website ? website : typeof domain === "string" && domain ? domain : undefined;
  if (!raw) return undefined;
  try {
    return new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return undefined;
  }
}

/**
 * The tenant a company belongs to, stamped on every contact created for it
 * (Invariant 8). Contacts found on a prospect's site used to be written
 * without it: on 2026-11-11 the ten addresses found by the live run were
 * invisible to every workspace-scoped read (analytics, the app's lists).
 */
export function tenantOf(company: Record<string, unknown>): { workspaceId: string; businessId?: string } {
  return {
    workspaceId: typeof company.workspaceId === "string" && company.workspaceId ? company.workspaceId : "ws_default",
    ...(typeof company.businessId === "string" && company.businessId ? { businessId: company.businessId } : {})
  };
}

async function upsertContact(
  companyId: string,
  tenant: { workspaceId: string; businessId?: string },
  email: string,
  sourceUrl: string,
  phones: string[]
) {
  const existing = await adminDb.collection("contacts").where("companyId", "==", companyId).where("normalizedEmail", "==", email).limit(1).get();
  if (!existing.empty) return false;
  const now = Timestamp.now();
  await adminDb.collection("contacts").add({
    companyId,
    ...tenant,
    fullName: roleFromEmail(email),
    role: roleFromEmail(email),
    email,
    normalizedEmail: email,
    phone: phones[0],
    normalizedPhone: phones[0],
    status: "new",
    emailVerified: false,
    doNotContact: false,
    source: "Company website",
    sourceType: "website",
    sourceProvider: "website",
    sourceUrl,
    sourceConfidence: emailKind(email) === "professional" ? 0.75 : 0.7,
    qualityScore: emailKind(email) === "professional" ? 80 : 72,
    dataQualityWarnings: [],
    rawProviderData: { emailKind: emailKind(email), extractedBy: "website_enrichment" },
    createdAt: now,
    updatedAt: now
  });
  return true;
}


/**
 * Creates contacts from details a business published on its public social or
 * link-in-bio page.
 *
 * For trades with no website and no database record, this is often the ONLY
 * reachable address - and it is published by the business precisely so people
 * can contact it. Read-only: nothing is ever sent through a social platform.
 */
export async function createContactsFromSocialEvidence(companyId: string): Promise<number> {
  const evidence = await adminDb.collection("companies").doc(companyId).collection("evidence").get();

  const byKey = new Map<string, unknown>();
  evidence.forEach((doc) => {
    const data = doc.data();
    if (data.signalProvider === "social_profile") byKey.set(data.key, data.value);
  });

  const emails = byKey.get("social_email");
  const phones = byKey.get("social_phone");
  const sourceUrl =
    (byKey.get("link_in_bio_url") as string) ||
    (byKey.get("instagram_url") as string) ||
    (byKey.get("facebook_url") as string) ||
    "";

  if (!Array.isArray(emails) || !emails.length) return 0;

  const phoneList = Array.isArray(phones) ? (phones as string[]) : [];
  const tenant = tenantOf((await adminDb.collection("companies").doc(companyId).get()).data() ?? {});
  let created = 0;
  for (const email of emails as string[]) {
    if (await upsertContact(companyId, tenant, String(email).toLowerCase(), sourceUrl || "social", phoneList)) {
      created += 1;
    }
  }

  if (created) {
    await adminDb.collection("companies").doc(companyId).set(
      { extractedEmailCount: FieldValue.increment(created), updatedAt: Timestamp.now() },
      { merge: true }
    );
    await writeLog({
      type: "enrichment.social.contacts_created",
      level: "info",
      message: `Found ${created} published contact ${created === 1 ? "address" : "addresses"} on social profiles.`,
      metadata: { companyId, sourceUrl, created }
    });
  }

  return created;
}

export async function enrichCompanyWebsite(companyId: string) {
  const startedAt = Date.now();
  const companyRef = adminDb.collection("companies").doc(companyId);
  const snapshot = await companyRef.get();
  if (!snapshot.exists) throw new HttpsError("not-found", `Company not found: ${companyId}`);
  const company = snapshot.data() ?? {};
  const startUrl = websiteUrl(company.website, company.domain);
  const previousStatus = typeof company.status === "string" ? company.status : "imported";

  await companyRef.set({ status: "enriching", websiteEnrichmentStatus: "running", updatedAt: Timestamp.now() }, { merge: true });

  if (!startUrl) {
    await companyRef.set(
      {
        status: previousStatus === "imported" || previousStatus === "discovered" ? "enrichment_pending" : previousStatus,
        websiteEnrichmentStatus: "missing_website",
        leadReadyForOutreach: false,
        leadReadinessReasons: ["No website/domain available for enrichment."],
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );
    await writeLog({ type: "enrichment.website.missing", level: "warning", message: "Company has no website/domain for enrichment.", metadata: { companyId } });
    return { status: "missing_website", emailsCreated: 0, pagesFetched: 0 };
  }

  try {
    const pages: CrawledPage[] = [];
    const homepage = await fetchPage(startUrl);
    if (homepage) pages.push(homepage);
    const candidates = homepage ? extractLinks(startUrl, homepage.html).slice(0, MAX_PAGES - 1) : [];
    for (const link of candidates) {
      if (pages.length >= MAX_PAGES) break;
      const page = await fetchPage(new URL(link));
      if (page) pages.push(page);
    }

    const emailsByUrl = new Map<string, string[]>();
    const phones = [...new Set(pages.flatMap((page) => extractPhones(page.text)))];
    for (const page of pages) {
      emailsByUrl.set(page.url, extractEmails(page.text, page.html));
    }

    let emailsCreated = 0;
    const companyDomain = company.domain ?? startUrl.hostname.replace(/^www\./, "");
    for (const [url, emails] of emailsByUrl.entries()) {
      for (const email of emails) {
        if (!isEmailDomainAllowed(email, companyDomain)) {
          continue;
        }
        const created = await upsertContact(companyId, tenantOf(company), email, url, phones);
        if (created) emailsCreated += 1;
      }
    }

    const allText = pages.map((page) => page.text).join(" ").toLowerCase();
    const websiteKeywords = KEYWORDS.filter((keyword) => allText.includes(keyword));
    const contactPageUrl = pages.find((page) => pageKind(page.url) === "contact")?.url;
    const careersPageUrl = pages.find((page) => pageKind(page.url) === "careers")?.url;
    const homepagePage = pages[0];
    const readiness = await updateCompanyLeadReadiness(companyId);
    const nextStatus = readiness.leadReadyForOutreach ? "outreach_ready" : previousStatus === "imported" || previousStatus === "discovered" || previousStatus === "enrichment_pending" ? "enriched" : previousStatus;

    await companyRef.set(
      {
        status: nextStatus,
        website: company.website ?? startUrl.toString(),
        domain: company.domain ?? startUrl.hostname.replace(/^www\./, ""),
        websiteEnrichmentStatus: "completed",
        ...(homepagePage?.title ? { websiteTitle: homepagePage.title } : {}),
        ...(homepagePage?.description ? { websiteDescription: homepagePage.description } : {}),
        ...(contactPageUrl ? { contactPageUrl } : {}),
        ...(careersPageUrl ? { careersPageUrl } : {}),
        lastWebsiteEnrichedAt: Timestamp.now(),
        websiteKeywords,
        extractedEmailCount: [...emailsByUrl.values()].flat().length,
        extractedPhoneCount: phones.length,
        ...readiness,
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );

    await writeLog({
      type: "enrichment.website.completed",
      level: "info",
      message: "Website/contact enrichment completed.",
      metadata: { companyId, pagesFetched: pages.length, emailsCreated, durationMs: Date.now() - startedAt }
    });
    return { status: "completed", emailsCreated, pagesFetched: pages.length, leadReadyForOutreach: readiness.leadReadyForOutreach };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website enrichment failed.";
    await companyRef.set(
      {
        status: previousStatus,
        websiteEnrichmentStatus: "failed",
        leadReadyForOutreach: false,
        leadReadinessReasons: [message],
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );
    await writeLog({ type: "enrichment.website.failed", level: "error", message, metadata: { companyId, durationMs: Date.now() - startedAt } });
    return { status: "failed", error: message, emailsCreated: 0, pagesFetched: 0 };
  }
}
