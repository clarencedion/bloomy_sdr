import { adminDb } from "../../config/firebase.js";
import type { SocialNetwork, SocialProfileRef } from "../../types/domain.js";
import { carriesWholeName, socialProfileTrust } from "./profile-trust.js";

/**
 * Turns whatever social link research found into a profile we can open a
 * conversation with — or refuses it.
 *
 * Why strict: the links come from scraped pages, and the first Instagram or
 * Facebook URL on a page is often not the business. It is the Facebook pixel
 * (`facebook.com/tr?id=…`), a share button (`sharer.php`), an embedded post
 * (`instagram.com/p/…`), a link shim (`l.instagram.com/?u=…`) or a Linktree.
 * A DM typed into the wrong profile reaches a stranger, so anything that is
 * not unambiguously a profile is rejected; missing a prospect is the cheaper
 * mistake.
 *
 * The handle is the identity used for suppression and the inbox sweep, so the
 * same profile must always produce the same handle whatever URL form it was
 * found under.
 */

export type ParsedSocialProfile = SocialProfileRef & { network: SocialNetwork };

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am"]);

/**
 * Facebook serves the same profile on several hosts. Link shims (l., lm.),
 * business.facebook.com and developers.facebook.com are deliberately absent.
 */
const FACEBOOK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "mbasic.facebook.com",
  "web.facebook.com",
  "touch.facebook.com",
  "mobile.facebook.com",
  "fb.com",
  "www.fb.com"
]);
/** Locale hosts such as fr-fr.facebook.com serve the same pages. */
const FACEBOOK_LOCALE_HOST = /^[a-z]{2}-[a-z]{2}\.facebook\.com$/;

/** First path segments that are Instagram features, never a username. */
const INSTAGRAM_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "embed",
  "embed.js",
  "about",
  "legal",
  "developer",
  "developers",
  "web",
  "challenge",
  "oauth",
  "ar",
  "s",
  "privacy",
  "terms",
  "emails",
  "session",
  "help",
  "press",
  "api",
  "graphql",
  "static",
  "create",
  "nametag",
  "qr",
  "locations",
  "location",
  "tags",
  "topics",
  "popular",
  "call"
]);

/** First path segments that are Facebook features, never a page or profile. */
const FACEBOOK_RESERVED = new Set([
  "tr",
  "sharer",
  "share",
  "plugins",
  "dialog",
  "groups",
  "events",
  "watch",
  "photo",
  "photos",
  "login",
  "logout",
  "2008",
  "marketplace",
  "gaming",
  "games",
  "help",
  "policies",
  "privacy",
  "legal",
  "terms",
  "business",
  "ads",
  "hashtag",
  "search",
  "notes",
  "media",
  "reel",
  "reels",
  "stories",
  "story",
  "messages",
  "messenger",
  "settings",
  "bookmarks",
  "videos",
  "video",
  "fundraisers",
  "places",
  "public",
  "friends",
  "notifications",
  "recover",
  "checkpoint",
  "ajax",
  "common",
  "connect",
  "x",
  "live",
  "careers",
  "about",
  "lite",
  "mobile",
  "find-friends",
  "home",
  "pagesmanager",
  "permalink",
  "l"
]);

/** Instagram usernames: letters, digits, "." and "_", no leading/trailing or doubled ".". */
const INSTAGRAM_HANDLE = /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/;
/** Facebook vanity names (pages and profiles). */
const FACEBOOK_SLUG = /^[a-z0-9][a-z0-9._-]{1,79}$/;
/** Numeric Facebook ids are long; short numbers are paths such as /2008/fbml. */
const FACEBOOK_ID = /^\d{6,}$/;
/** Pages without a vanity name are published as "Name-1234567890". */
const FACEBOOK_TRAILING_ID = /-(\d{6,})$/;

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function toUrl(raw: string): URL | null {
  // Scraped links carry trailing punctuation from the sentence around them.
  const trimmed = raw.trim().replace(/[.,;)\]]+$/, "");
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/\//, "")}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
}

function pathSegments(url: URL): string[] {
  return url.pathname
    .split("/")
    .map((segment) => safeDecode(segment).trim())
    .filter(Boolean);
}

function instagramProfile(url: URL): ParsedSocialProfile | null {
  const segments = pathSegments(url);
  // instagram.com/_u/<handle> is the app deep link to a profile.
  const raw = segments[0] === "_u" ? segments[1] : segments[0];
  if (!raw) return null;
  const handle = raw.toLowerCase().replace(/^@/, "");
  if (INSTAGRAM_RESERVED.has(handle) || !INSTAGRAM_HANDLE.test(handle)) return null;
  return { network: "instagram", handle, url: `https://www.instagram.com/${handle}/` };
}

/** Every numeric id gets one handle, so profile.php, people/ and pages/ forms agree. */
function facebookById(id: string): ParsedSocialProfile {
  return { network: "facebook", handle: `id:${id}`, url: `https://www.facebook.com/profile.php?id=${id}` };
}

function facebookFromSlug(rawSlug: string | undefined): ParsedSocialProfile | null {
  if (!rawSlug) return null;
  const slug = rawSlug.toLowerCase();
  if (FACEBOOK_ID.test(slug)) return facebookById(slug);
  const trailing = slug.match(FACEBOOK_TRAILING_ID);
  if (trailing) return facebookById(trailing[1]);
  // Script endpoints (home.php, l.php, photo.php…) are never a profile.
  if (slug.endsWith(".php") || FACEBOOK_RESERVED.has(slug) || !FACEBOOK_SLUG.test(slug)) return null;
  return { network: "facebook", handle: slug, url: `https://www.facebook.com/${slug}` };
}

/** The numeric id carried by one of the path segments, if any. */
function facebookIdIn(segments: string[]): string | null {
  for (const segment of segments) {
    if (FACEBOOK_ID.test(segment)) return segment;
    const trailing = segment.toLowerCase().match(FACEBOOK_TRAILING_ID);
    if (trailing) return trailing[1];
  }
  return null;
}

function facebookProfile(url: URL): ParsedSocialProfile | null {
  const segments = pathSegments(url);
  const first = segments[0]?.toLowerCase();
  if (!first) return null;

  // The query IS the identity here; every other query string is tracking.
  if (first === "profile.php") {
    const id = url.searchParams.get("id")?.trim() ?? "";
    return FACEBOOK_ID.test(id) ? facebookById(id) : null;
  }

  // pages/<Name>/<ID>, pages/category/<Category>/<Name-ID>, people/<Name>/<ID>
  // and p/<Name-ID>: only the numeric id identifies these; without one the
  // name alone could be anyone's, so the link is refused.
  if (first === "pages" || first === "people" || first === "p") {
    const id = facebookIdIn(segments.slice(1));
    return id ? facebookById(id) : null;
  }

  // pg/<slug>/… is the older page form.
  if (first === "pg") return facebookFromSlug(segments[1]);

  return facebookFromSlug(segments[0]);
}

/**
 * Parses an Instagram or Facebook profile link into its network, canonical
 * URL and handle. Returns null for anything that is not unambiguously a
 * profile: posts, reels, stories, share and pixel endpoints, link shims,
 * link-in-bio pages and every other host.
 */
export function parseSocialProfileUrl(url: string): ParsedSocialProfile | null {
  if (typeof url !== "string") return null;
  const parsed = toUrl(url);
  if (!parsed) return null;

  // Exact host match: "instagram.com.example.net" must not pass for Instagram.
  const host = parsed.hostname.toLowerCase();
  if (INSTAGRAM_HOSTS.has(host)) return instagramProfile(parsed);
  if (FACEBOOK_HOSTS.has(host) || FACEBOOK_LOCALE_HOST.test(host)) return facebookProfile(parsed);
  // Link-in-bio pages (linktr.ee, beacons.ai…), link shims and any other site
  // land here: none of them can receive a direct message.
  return null;
}

export type CompanySocialProfiles = { instagram?: SocialProfileRef; facebook?: SocialProfileRef };

export interface SetAsideProfile {
  network: SocialNetwork;
  handle: string;
  url: string;
  trust: "uncertain" | "rejected";
  reason: string;
}

/**
 * The company's Instagram and Facebook profiles, from the most to the least
 * reliable source, kept only when they are the company's own account
 * (profile-trust.ts). The research evidence is read off the page discovery
 * recorded as the company's website, which is often a booking page or a
 * directory: its links are then the platform's, so they must match the
 * company's name, or its own site — and so must the profile lead readiness
 * recorded, which it derived from those same links. The directory listing
 * discovery kept (a business whose only web presence is a social profile)
 * and a website that is itself a profile name the profile directly; only a
 * platform account is refused there.
 *
 * `setAside` lists what was found but not trusted, so an operator can check it.
 */
export async function resolveCompanySocialProfilesDetailed(
  companyId: string
): Promise<{ profiles: CompanySocialProfiles; setAside: SetAsideProfile[] }> {
  if (!companyId) return { profiles: {}, setAside: [] };
  const companyRef = adminDb.collection("companies").doc(companyId);
  // Fixed ids: signal storage overwrites these keys on every refresh.
  const [companySnap, instagramEvidence, facebookEvidence] = await Promise.all([
    companyRef.get(),
    companyRef.collection("evidence").doc("social_profile_instagram_url").get().catch(() => null),
    companyRef.collection("evidence").doc("social_profile_facebook_url").get().catch(() => null)
  ]);
  if (!companySnap.exists) return { profiles: {}, setAside: [] };
  const company = companySnap.data() ?? {};
  const identity = { name: typeof company.name === "string" ? company.name : "", website: typeof company.website === "string" ? company.website : "" };

  // A phone number or a postcode in the search result ties the account to
  // this business; a city alone does not, so the handle must then be the
  // business's whole name (same rule as when the search accepted it).
  const searchTiedToPlace = company.searchedInstagramConfirmedBy === "phone" || company.searchedInstagramConfirmedBy === "postcode";
  const city = typeof company.city === "string" ? company.city : undefined;

  const candidates: Array<{ value: unknown; source: "scraped" | "listing"; searched?: boolean }> = [
    { value: instagramEvidence?.exists ? instagramEvidence.data()?.value : undefined, source: "scraped" },
    { value: facebookEvidence?.exists ? facebookEvidence.data()?.value : undefined, source: "scraped" },
    { value: company.directoryUrl, source: "listing" },
    // Derived by lead readiness from the same scraped links: not a listing.
    { value: company.socialProfileUrl, source: "scraped" },
    // Found by a name search and confirmed by place (profile-search.ts); the
    // handle must still match the name here, like any profile we did not read
    // on the company's own listing.
    { value: company.searchedInstagramUrl, source: "scraped", searched: true },
    { value: company.website, source: "listing" }
  ];

  const profiles: CompanySocialProfiles = {};
  const setAside: SetAsideProfile[] = [];
  for (const candidate of candidates) {
    if (typeof candidate.value !== "string") continue;
    const profile = parseSocialProfileUrl(candidate.value);
    if (!profile || profiles[profile.network]) continue;
    let verdict = socialProfileTrust(profile, identity, candidate.source);
    if (verdict.trust === "trusted" && candidate.searched && !searchTiedToPlace && !carriesWholeName(profile.handle, identity.name, city)) {
      verdict = { trust: "uncertain", reason: "search_match_too_loose" };
    }
    if (verdict.trust !== "trusted") {
      setAside.push({ network: profile.network, handle: profile.handle, url: profile.url, trust: verdict.trust, reason: verdict.reason });
      continue;
    }
    profiles[profile.network] = { url: profile.url, handle: profile.handle };
  }
  return { profiles, setAside };
}

export async function resolveCompanySocialProfiles(companyId: string): Promise<CompanySocialProfiles> {
  return (await resolveCompanySocialProfilesDetailed(companyId)).profiles;
}

/** Lowercase, no "@", no surrounding spaces: the form handles are stored in. */
export function normaliseSocialHandle(handle: string): string {
  return String(handle ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}
