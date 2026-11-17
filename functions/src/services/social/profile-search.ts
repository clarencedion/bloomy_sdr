import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../../config/firebase.js";
import { getIntegrationSecrets } from "../../utils/settings.js";
import { writeLog } from "../../utils/logger.js";
import { registeredNameCandidate } from "../../providers/signals/registry-signal-provider.js";
import { carriesWholeName, socialProfileTrust } from "./profile-trust.js";
import { parseSocialProfileUrl, resolveCompanySocialProfiles } from "./social-profile.js";

/**
 * Finds a prospect's Instagram account by searching for it, when its website
 * does not link one.
 *
 * Why: in the live run of 2026-11-11, 22 of 60 qualified prospects had "no
 * channel" — no email, no profile on their site — while most of them post on
 * Instagram every week. A Google search for `site:instagram.com "<name>"
 * <city>` returns their profile first in practice.
 *
 * The same search also returns the same name in another town
 * ("@barber_avenue_73 · Aix-les-Bains" for a Paris barber), so a result is
 * accepted only when BOTH hold:
 *   1. its handle matches the company's name (profile-trust.ts), and
 *   2. the result itself confirms the place: the company's city, postcode or
 *      phone number appears in its title or snippet.
 * A city is a weak confirmation — "Kustom Tattoo" in Paris matched
 * "@kustomtashoes", a Paris sneaker customiser, on one shared word — so with
 * the city alone the handle must contain the business's whole name
 * (`carriesWholeName`); a matching phone or postcode needs no more. The
 * resolver applies the same rule when it reads the stored profile back
 * (social-profile.ts), so a profile recorded under an older, looser rule is
 * not used either.
 * Anything else is not used: a DM to a namesake is worse than no DM.
 *
 * Search results are untrusted text: they are only matched against the
 * company's own facts, never passed to a model here.
 */

export interface SearchResult {
  link?: string;
  title?: string;
  snippet?: string;
}

export interface FoundProfile {
  url: string;
  handle: string;
  confirmedBy: "city" | "postcode" | "phone";
}

const fold = (text: unknown) =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
const digits = (text: unknown) => String(text ?? "").replace(/\D/g, "");

export { carriesWholeName };

/** French numbers as written (03 20 86 95 44, +33 3 20 86 95 44): compared on their last nine digits. */
function phoneKeys(values: unknown[]): string[] {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => digits(value))
    .filter((value) => value.length >= 9)
    .map((value) => value.slice(-9));
}

/**
 * The first search result that is provably this company's Instagram profile.
 * Pure: `results` are the search engine's organic results, in its order.
 */
export function pickInstagramFromSearch(
  results: SearchResult[],
  company: { name?: string; website?: string; city?: string; postalCode?: string; phones?: unknown[] }
): FoundProfile | undefined {
  const city = fold(company.city).trim();
  const postcode = /^\d{5}$/.test(String(company.postalCode ?? "").trim()) ? String(company.postalCode).trim() : "";
  const phones = phoneKeys(company.phones ?? []);

  for (const result of results) {
    const profile = typeof result.link === "string" ? parseSocialProfileUrl(result.link) : null;
    if (!profile || profile.network !== "instagram") continue;
    const verdict = socialProfileTrust(profile, { name: company.name, website: company.website }, "scraped");
    if (verdict.trust !== "trusted" || verdict.reason !== "matches_name") continue;

    const text = `${result.title ?? ""} ${result.snippet ?? ""}`;
    const folded = fold(text);
    const textDigits = digits(text);
    const confirmedBy = phones.some((phone) => textDigits.includes(phone))
      ? "phone"
      : postcode && new RegExp(`(?<!\\d)${postcode}(?!\\d)`).test(text)
        ? "postcode"
        : city.length >= 3 && new RegExp(`(?<![a-z])${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`).test(folded)
          ? "city"
          : undefined;
    if (!confirmedBy) continue;
    if (confirmedBy === "city" && !carriesWholeName(profile.handle, company.name ?? "", company.city)) continue;
    return { url: profile.url, handle: profile.handle, confirmedBy };
  }
  return undefined;
}

const SERPER_URL = "https://google.serper.dev/search";
const SERPER_TIMEOUT_MS = 8_000;

/** One search, retried once after a 429; undefined on any failure (the prospect simply stays without a profile). */
async function searchInstagram(query: string, apiKey: string): Promise<SearchResult[] | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(SERPER_URL, {
        method: "POST",
        signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, gl: "fr", hl: "fr", num: 5 })
      });
      if (response.status === 429 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        continue;
      }
      if (!response.ok) return undefined;
      const data = (await response.json()) as { organic?: SearchResult[] };
      return data.organic ?? [];
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** A company searched this recently is not searched again (a paid call that found nothing last time). */
const SEARCH_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Searches for the company's Instagram profile when it has none we trust,
 * and records it on the company (`searchedInstagramUrl`), where
 * `resolveCompanySocialProfiles` reads it under the same trust rule as any
 * scraped profile. Returns the profile found, or undefined.
 */
export async function findInstagramBySearch(companyId: string): Promise<FoundProfile | undefined> {
  const companyRef = adminDb.collection("companies").doc(companyId);
  const snapshot = await companyRef.get();
  if (!snapshot.exists) return undefined;
  const company = snapshot.data() ?? {};

  if ((await resolveCompanySocialProfiles(companyId)).instagram) return undefined;
  const searchedAt = company.instagramSearchedAt instanceof Timestamp ? company.instagramSearchedAt.toMillis() : 0;
  if (Date.now() - searchedAt < SEARCH_RETRY_MS) return undefined;

  const { serperApiKey } = await getIntegrationSecrets();
  const name = typeof company.name === "string" ? company.name : "";
  const city = typeof company.city === "string" ? company.city : "";
  if (!serperApiKey || !name.trim() || !city.trim()) return undefined;

  const candidate = registeredNameCandidate(name, city) || name;
  const results = await searchInstagram(`site:instagram.com "${candidate.replace(/"/g, "")}" ${city}`, serperApiKey);
  if (!results) return undefined;

  const phoneEvidence = await companyRef
    .collection("evidence")
    .get()
    .then((docs) => docs.docs.filter((doc) => /phone/.test(doc.id)).map((doc) => doc.data().value))
    .catch(() => []);
  const found = pickInstagramFromSearch(results, {
    name,
    website: typeof company.website === "string" ? company.website : undefined,
    city,
    postalCode: typeof company.postalCode === "string" ? company.postalCode : undefined,
    phones: [company.phone, company.phoneNumber, ...phoneEvidence]
  });

  const now = Timestamp.now();
  await companyRef
    .set(
      { instagramSearchedAt: now, ...(found ? { searchedInstagramUrl: found.url, searchedInstagramConfirmedBy: found.confirmedBy } : {}), updatedAt: now },
      { merge: true }
    )
    .catch(() => undefined);
  await writeLog({
    type: found ? "research.social_profile_found" : "research.social_profile_not_found",
    level: "info",
    message: found
      ? `Instagram found by search for ${name}: @${found.handle} (confirmed by ${found.confirmedBy}).`
      : `No Instagram profile could be confirmed by search for ${name}.`,
    workspaceId: (company.workspaceId as string) || "ws_default",
    businessId: company.businessId as string | undefined,
    metadata: { companyId, ...(found ? { handle: found.handle, confirmedBy: found.confirmedBy } : {}) }
  }).catch(() => undefined);
  return found;
}
