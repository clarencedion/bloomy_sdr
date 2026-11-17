/**
 * Whether a social profile research found is really the prospect's account.
 *
 * Why: the profiles come from the links on the page discovery recorded as the
 * company's "website". That page is often not the company's: a booking page
 * (Fresha, Planity…), a directory, a magazine, a map. Its links are then the
 * PLATFORM's accounts. Measured on the first 139 live DM drafts: 10 went to
 * facebook.com/teamfresha, 5 to instagram.com/fresha, others to a map, a
 * photo site, a theatre, a food critic. A DM typed there reaches a stranger.
 *
 * The rule, from the strongest evidence down:
 *   1. a known platform or directory account is never the prospect's;
 *   2. a handle that matches the company's NAME is trusted;
 *   3. a profile found on a directory or platform page is rejected;
 *   4. a profile found on the company's OWN site — a site whose address
 *      matches the company's name — is trusted when its handle matches that
 *      address, or is a numeric id (a name too generic to tell vouches for
 *      no site);
 *   5. anything else is uncertain, and not used: missing a prospect is the
 *      cheaper mistake.
 * A profile the company record itself names (its listing points straight at
 * the profile) is trusted unless it is a platform account.
 *
 * Pure. Nothing here knows what a business sells (Invariant 1): the word
 * lists are about how French business names and the web are written.
 */

import { registeredNameCandidate } from "../../providers/signals/registry-signal-provider.js";

export type ProfileTrust = { trust: "trusted" | "uncertain" | "rejected"; reason: string };

/** Accounts of platforms, directories, builders and media — compared without dots, dashes or underscores. */
const PLATFORM_HANDLES = new Set(
  [
    "fresha", "teamfresha", "planity", "planityfr", "treatwell", "treatwellfr", "booksy", "booksyfr", "bookinkco", "bookink",
    "wix", "wixfrancais", "wixfr", "squarespace", "shopify", "wordpress", "webflow", "jimdo", "godaddy", "ovh", "hostinger",
    "mappy", "mappyofficiel", "flickr", "google", "googlemaps", "facebook", "instagram", "meta", "whatsapp",
    "pagesjaunes", "solocal", "tripadvisor", "tripadvisorfr", "yelp", "yelpfrance", "linktree", "linktr",
    "kipikink", "inkinmag", "starofservice", "sortiraparis", "sortirapariscom", "sortiraparisofficiel", "villepratique",
    "lagazettefrance", "doctolib", "calendly", "thefork", "lafourchette", "ubereats", "ubereatsfr", "deliveroo", "deliveroofr",
    "justeat", "airbnb", "booking", "bookingcom", "youtube", "tiktok", "twitter", "pinterest", "linkedin", "leboncoin",
    "petitfute", "routard", "michelin", "gaultmillau", "timeout", "timeoutparis", "mariagesnet", "zankyou", "houzz", "habitissimo"
  ].map((handle) => handle.replace(/[^a-z0-9]/g, ""))
);

/** Sites whose pages list many businesses: links found there are the site's own. */
const DIRECTORY_DOMAINS = new Set([
  "fresha.com", "planity.com", "treatwell.fr", "booksy.com", "book-ink.co", "kipik.ink", "mappy.com", "flickr.com",
  "tattoocityguide.com", "inkin.fr", "mypresquile.com", "findglocal.com", "sortiraparis.com", "starofservice.com",
  "villepratique.fr", "salon-beaute-france.fr", "lagazettefrance.fr", "pagesjaunes.fr", "the-tatoueur.com", "maketattoo.eu",
  "tattoome.com", "montatoueur.fr", "gillespudlowski.com", "tripadvisor.fr", "tripadvisor.com", "yelp.fr", "yelp.com",
  "google.com", "google.fr", "facebook.com", "instagram.com", "doctolib.fr", "calendly.com", "thefork.fr",
  "lafourchette.com", "ubereats.com", "deliveroo.fr", "justeat.fr", "leboncoin.fr", "petitfute.com", "routard.com",
  "guide.michelin.com", "timeout.fr", "timeout.com", "mariages.net", "zankyou.fr", "houzz.fr", "habitissimo.fr",
  "societe.com", "pappers.fr", "infogreffe.fr", "manageo.fr", "verif.com", "annuaire-entreprises.data.gouv.fr",
  "wanderboat.ai", "ivof.com"
]);

/** Link-in-bio pages belong to the business: the first path segment is its name ("linktr.ee/studio_a"). */
const LINK_IN_BIO_HOSTS = new Set(["linktr.ee", "beacons.ai", "lnk.bio", "linkin.bio", "taplink.cc", "campsite.bio", "bio.link", "solo.to", "allmylinks.com"]);

/** Hosts where each customer site is a subdomain: the subdomain is the site's name. */
const SITE_BUILDER_DOMAINS = new Set([
  "wixsite.com", "wordpress.com", "webnode.fr", "webnode.page", "jimdofree.com", "jimdosite.com", "business.site",
  "blogspot.com", "squarespace.com", "e-monsite.com", "site-solocal.com", "godaddysites.com", "mystrikingly.com", "weebly.com"
]);

/**
 * Words that say what kind of place it is, where, or its legal form — not
 * which one. "Studio 54 Nantes" is told apart by "54", not by "studio" or
 * "nantes".
 */
const GENERIC_WORDS = new Set([
  // Articles and small words.
  "le", "la", "les", "l", "de", "du", "des", "d", "et", "a", "au", "aux", "en", "chez", "by", "the", "and", "of", "my", "mon", "ma",
  "un", "une", "sur", "pour", "par", "art", "arts",
  // Legal forms.
  "sas", "sasu", "sarl", "eurl", "sa", "sci", "ei", "eirl", "sc", "scop", "ltd", "inc", "co", "cie", "group", "groupe",
  // Kinds of place and trade.
  "studio", "salon", "atelier", "shop", "store", "boutique", "maison", "institut", "centre", "center", "espace", "agence",
  "cabinet", "officiel", "official", "france", "paris", "tattoo", "tattoos", "tatouage", "tatoueur", "tatoueuse", "piercing",
  "ink", "fleurs", "fleur", "fleuriste", "florist", "boulangerie", "patisserie", "boulanger", "restaurant", "resto", "cafe",
  "bar", "bistrot", "brasserie", "garage", "coiffure", "coiffeur", "barber", "barbier", "beaute", "beauty", "spa", "nails",
  "ongles", "esthetique", "massage", "bien", "etre", "hotel", "traiteur", "epicerie", "cave", "vins", "fine", "line", "club",
  "family", "parlor", "parlour", "house", "home", "design", "concept", "creation", "creations", "services", "service", "pro",
  // Cities and regions a name often carries.
  "lyon", "marseille", "toulouse", "nice", "nantes", "strasbourg", "montpellier", "bordeaux", "lille", "rennes", "reims",
  "grenoble", "dijon", "angers", "nimes", "tours", "limoges", "metz", "nancy", "rouen", "caen", "brest", "avignon", "aix",
  "provence", "cannes", "antibes", "toulon", "perpignan", "orleans", "clermont", "ferrand", "amiens", "annecy", "biarritz",
  "bayonne", "pau", "poitiers", "nord", "sud", "est", "ouest", "ville", "centre"
]);

const PLATFORM_SOCIAL_HOSTS = /(^|\.)(facebook|instagram|fb)\.com$/;

function fold(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const compact = (text: string) => fold(text).replace(/[^a-z0-9]/g, "");
const tokens = (text: string) => fold(text).split(/[^a-z0-9]+/).filter(Boolean);

/** Tokens that tell this business apart (3+ characters, not generic). */
function distinctiveTokens(name: string): string[] {
  return tokens(name).filter((token) => token.length >= 3 && !GENERIC_WORDS.has(token));
}

/** Longest common substring of two compact strings. */
function longestCommon(a: string, b: string): string {
  let best = "";
  const previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : 0;
      if (previous[j] > best.length) best = a.slice(i - previous[j], i);
      diagonal = above;
    }
  }
  return best;
}

/**
 * How many characters of a compact string no generic word (or extra word,
 * e.g. the city) accounts for, under the best split: "tattooshop" → 0
 * ("tattoo" + "shop"), "tashoes" → 7. A greedy removal gets "tattooshop"
 * wrong ("tattoos" first leaves "hop").
 */
export function uncoveredByGeneric(text: string, extraWords: string[] = []): number {
  const words = [...GENERIC_WORDS, ...extraWords].filter((word) => word.length >= 3);
  const best = new Array<number>(text.length + 1).fill(0);
  for (let i = text.length - 1; i >= 0; i -= 1) {
    best[i] = 1 + best[i + 1];
    for (const word of words) {
      if (text.startsWith(word, i)) best[i] = Math.min(best[i], best[i + word.length]);
    }
  }
  return best[0];
}

const compactKey = (text: unknown) =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * The handle is the business's name and nothing else that matters: it
 * contains the whole registered-name candidate, and what is left around it is
 * only trade words, the city or digits ("sashatattooing" + "paris",
 * "amalgame" + "tattooshop") — not another word ("kustom" + "tashoes").
 *
 * Asked of a profile found by a name search and confirmed by the city alone
 * (profile-search.ts): one shared word and a big city is how a namesake gets
 * a prospect's DM.
 */
export function carriesWholeName(handle: string, name: string, city?: string): boolean {
  const wanted = compactKey(registeredNameCandidate(name, city));
  const whole = compactKey(handle);
  if (wanted.length < 4 || !whole.includes(wanted)) return false;
  const rest = whole.split(wanted).join("").replace(/\d/g, "");
  return uncoveredByGeneric(rest, [compactKey(city)]) <= 2;
}

/** What is left of a common run once generic words are taken out: "studio54" → "54". */
function withoutGeneric(run: string): string {
  let rest = run;
  for (const word of [...GENERIC_WORDS].sort((x, y) => y.length - x.length)) {
    if (word.length >= 3) rest = rest.split(word).join("");
  }
  return rest;
}

/**
 * Whether a compact string (a handle, a site name) is about this company
 * name: the whole name inside it (or it inside the name), one of the name's
 * distinctive words in it, or a long common run that is not just generic
 * words.
 */
function relatesToName(candidate: string, name: string): boolean {
  const target = compact(candidate);
  const full = compact(name);
  if (target.length < 3 || full.length < 3) return false;
  if (full.length >= 6 && (target.includes(full) || (full.includes(target) && target.length >= 6))) return true;
  if (distinctiveTokens(name).some((token) => (token.length >= 4 || /\d/.test(token) ? target.includes(token) : target.includes(token) && target.length <= 12))) {
    return true;
  }
  const run = longestCommon(target, full);
  return run.length >= 5 && withoutGeneric(run).length >= 2;
}

/** Two compact names that are about each other (a handle and a site name). */
function relatesToSite(handle: string, siteName: string): boolean {
  const a = compact(handle);
  const b = compact(siteName);
  if (a.length < 4 || b.length < 4) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const run = longestCommon(a, b);
  return run.length >= 5 && withoutGeneric(run).length >= 2;
}

/** The site's registrable domain and the name it is known by ("laiguille-tattoo.com" → "laiguille-tattoo"). */
export function siteIdentity(website: string | undefined): { domain: string; name: string } | undefined {
  if (!website) return undefined;
  let host: string;
  let firstSegment = "";
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    host = url.hostname.toLowerCase().replace(/^www\./, "");
    firstSegment = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
  } catch {
    return undefined;
  }
  if (LINK_IN_BIO_HOSTS.has(host)) return firstSegment ? { domain: host, name: firstSegment } : undefined;
  const parts = host.split(".");
  if (parts.length < 2) return undefined;
  const registrable = parts.slice(-2).join(".");
  if (SITE_BUILDER_DOMAINS.has(registrable)) {
    return parts.length >= 3 ? { domain: host, name: parts[parts.length - 3] } : undefined;
  }
  // "guide.michelin.com" is listed whole; most directories by registrable domain.
  const domain = DIRECTORY_DOMAINS.has(host) ? host : registrable;
  return { domain, name: parts[parts.length - 2] };
}

export function isPlatformHandle(handle: string): boolean {
  return PLATFORM_HANDLES.has(compact(handle));
}

/**
 * @param profile   the parsed profile (handle "id:123…" for a numeric Facebook profile)
 * @param company   the company's name and recorded website
 * @param source    "scraped" when read off the website's page; "listing" when the company record names the profile itself
 */
export function socialProfileTrust(
  profile: { handle: string },
  company: { name?: string; website?: string },
  source: "scraped" | "listing"
): ProfileTrust {
  const handle = String(profile.handle ?? "");
  const numeric = /^id:\d+$/.test(handle);
  if (!numeric && isPlatformHandle(handle)) return { trust: "rejected", reason: "platform_account" };
  if (source === "listing") return { trust: "trusted", reason: "named_by_listing" };

  const name = company.name ?? "";
  if (!numeric && relatesToName(handle, name)) return { trust: "trusted", reason: "matches_name" };

  const site = siteIdentity(company.website);
  if (!site) return { trust: "uncertain", reason: "no_site" };
  if (DIRECTORY_DOMAINS.has(site.domain) || PLATFORM_SOCIAL_HOSTS.test(site.domain)) {
    return { trust: "rejected", reason: "found_on_a_directory" };
  }
  // A name too generic to tell ("Studio Art Tattoo", "Salon de Tatouage")
  // cannot vouch for any site: one such listing pointed at a design blog.
  // A link-in-bio page is one the business made for itself: its links are its own.
  const ownSite = relatesToName(site.name, name) || LINK_IN_BIO_HOSTS.has(site.domain);
  if (ownSite && (numeric || relatesToSite(handle, site.name))) return { trust: "trusted", reason: "found_on_own_site" };
  return { trust: "uncertain", reason: ownSite ? "not_the_site_account" : "site_not_the_company" };
}
