/**
 * Domains that host a business's listing rather than being the business itself:
 * booking platforms, directories and social networks.
 *
 * Two consequences, both important:
 *  - A prospect whose only web presence is one of these has no site of their
 *    own, which is a strong need signal.
 *  - Anything scraped from such a page belongs to the PLATFORM, not the
 *    prospect. Harvesting emails there yields addresses like help@booksy.com
 *    or jobs@fresha.com, so outreach would be sent to the platform's support
 *    desk instead of the salon.
 */
export const THIRD_PARTY_PRESENCE_DOMAINS = [
  "planity.com",
  "treatwell.fr",
  "treatwell.com",
  "fresha.com",
  "booksy.com",
  "wavy.pro",
  "balinea.com",
  "kiute.fr",
  "flexy.fr",
  "lsrdv.com",
  "doctolib.fr",
  "pagesjaunes.fr",
  // Directories and editorial sites that Places sometimes returns as "website".
  "jetrouveici.fr",
  "commeuncamion.com",
  "petitfute.com",
  "justacote.com",
  "118712.fr",
  "cylex-france.fr",
  "kelest.fr",
  "linternaute.com",
  "mappy.com",
  // Found as a prospect's "website" by the live run of 2026-11-11.
  "wanderboat.ai",
  "ivof.com",
  "waze.com",
  "google.com",
  "sites.google.com",
  "business.site",
  "wixsite.com",
  "facebook.com",
  "instagram.com",
  "linktr.ee",
  "linkedin.com",
  "tiktok.com",
  "yelp.com",
  "tripadvisor.fr",
  "tripadvisor.com",
  // Public registers and accessibility directories. Measured on a live run:
  // Places returned an acceslibre.beta.gouv.fr listing as a tattoo studio's
  // "website", so an outreach form submission would have gone to a French
  // government service instead of the prospect.
  "acceslibre.beta.gouv.fr",
  "beta.gouv.fr",
  "service-public.fr",
  "societe.com",
  "infogreffe.fr",
  "verif.com",
  "annuaire-entreprises.data.gouv.fr",
  // Blogging platforms. A article *about* a business is not that business's
  // site; one live company had a 2015 WordPress portrait stored as its website.
  "wordpress.com",
  "blogspot.com",
  "blogspot.fr",
  "over-blog.com",
  "medium.com",
  "tumblr.com",
  "substack.com",
  "blogger.com",
  // Directories, guides and media seen as a prospect's "website" in the live
  // runs of 2026-11-10 (their links and emails are the site's, not the
  // prospect's — see profile-trust.ts for the same list on social accounts).
  "the-tatoueur.com",
  "kipik.ink",
  "tattoocityguide.com",
  "inkin.fr",
  "book-ink.co",
  "mypresquile.com",
  "findglocal.com",
  "sortiraparis.com",
  "starofservice.com",
  "villepratique.fr",
  "salon-beaute-france.fr",
  "lagazettefrance.fr",
  "maketattoo.eu",
  "tattoome.com",
  "montatoueur.fr",
  "gillespudlowski.com",
  "flickr.com",
  "yelp.fr",
  "thefork.fr",
  "lafourchette.com",
  "ubereats.com",
  "deliveroo.fr",
  "just-eat.fr",
  "justeat.fr",
  "leboncoin.fr",
  "routard.com",
  "guide.michelin.com",
  "timeout.fr",
  "timeout.com",
  "mariages.net",
  "zankyou.fr",
  "houzz.fr",
  "habitissimo.fr",
  "pappers.fr",
  "manageo.fr",
  "hoodspot.fr",
  "annuaire.laposte.fr",
  "fr.kompass.com",
  "uniquefrance.com"
];

/** True when the host is a listing platform rather than the prospect's own site. */
export function isThirdPartyPresence(hostOrUrl: string | undefined | null): boolean {
  if (!hostOrUrl) return false;
  let host = String(hostOrUrl).trim().toLowerCase();
  try {
    if (host.includes("://")) host = new URL(host).hostname;
  } catch {
    return false;
  }
  host = host.replace(/^www\./, "");
  return THIRD_PARTY_PRESENCE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** True when an email address belongs to a listing platform, not the prospect. */
export function isThirdPartyEmail(email: string | undefined | null): boolean {
  if (!email || !email.includes("@")) return false;
  return isThirdPartyPresence(email.split("@").pop());
}


/**
 * Whether a URL may be treated as the prospect's own website.
 *
 * `company.website` feeds three things that all assume it is the business's own
 * site: the technical audit that produces "your site is slow" evidence, the
 * page scrape that looks for an email, and the contact form the SDR may submit.
 * Nothing validated it, and Google Places returns whatever link the listing
 * carries. Measured on a live workspace of 78 companies with a website, four
 * held a Waze live-map link, a government accessibility listing, a 2015 blog
 * post and a `google.com/search?q=mailto:...` URL.
 *
 * The consequences were not cosmetic: the audit scored the wrong domain, and a
 * contact-form send would have posted a commercial message to a government
 * service. This is the gate that makes that impossible.
 */
export function isUsableCompanyWebsite(url: string | undefined | null): boolean {
  if (!url) return false;

  const raw = String(url).trim();
  if (!raw) return false;

  // Reject a non-http scheme before normalising, not after. Gluing "https://"
  // onto "mailto:contact@example.fr" produces a URL that parses cleanly with
  // "mailto" as the username and example.fr as the host, so the check that
  // followed would have passed it.
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return false;

  let parsed: URL;
  try {
    parsed = new URL(scheme ? raw : `https://${raw}`);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  // A search results page is never a business's site, whoever hosts it.
  if (/^\/(search|maps|url)\b/.test(parsed.pathname) || parsed.searchParams.has("q")) return false;

  // A bare hostname with no dot (localhost, an intranet name) is not reachable.
  if (!parsed.hostname.includes(".")) return false;

  return !isThirdPartyPresence(parsed.hostname);
}

/**
 * Explains why a URL was rejected, for the discovery log.
 * Returns null when the website is usable.
 */
export function describeUnusableWebsite(url: string | undefined | null): string | null {
  if (isUsableCompanyWebsite(url)) return null;
  if (!url) return "no website";
  if (isThirdPartyPresence(url)) return "a directory or platform listing, not their own site";
  return "not a usable website URL";
}
