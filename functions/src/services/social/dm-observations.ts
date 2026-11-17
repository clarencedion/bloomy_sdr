import { isUsableCompanyWebsite } from "../third-party-domains.js";

/**
 * What a first direct message says about the prospect's website — written by
 * code from verified evidence, never by the model.
 *
 * Why: the strongest opening for a business that sells online presence is the
 * gap ("your site takes 16 seconds on a phone", "you have no site of your
 * own"), and it is also the sentence that must not be wrong. On the first
 * conversation-style drafts (2026-11-11) the model wrote "vous n'avez pas de
 * site" to businesses about which no website fact was on record — about one
 * draft in seven. Two versions of a check that read the model's text for such
 * claims (by phrase, then by topic and polarity) were each broken by an
 * adversarial review within minutes: 49 of 59, then 57 of 66 ordinary
 * rewordings passed ("ils méritent un vrai site", "votre site pourrait être
 * plus rapide"), while a third of harmless sentences were held.
 *
 * Same conclusion as for commercial terms (ADR-019, ADR-021): what must be
 * true is stated by code, and the model's text is held to a closed vocabulary
 * that keeps it off the subject altogether.
 *   1. `pickObservation` writes at most one sentence, from a fixed set, only
 *      when verified evidence says it with no sign to the contrary. Which
 *      observations a business wants stated is its own data
 *      (`socialDmOpening.observations`), so nothing here knows what is sold.
 *   2. `presenceWordIn` finds any word of the subject in the model's parts —
 *      their site, page, online presence, booking, display on a phone, and the
 *      words that speak of a site without naming it (speed, redesign, update).
 *
 * Evidence-provenance logic (Invariant 5), like claim-validator.ts. Pure.
 * French only, like every prompt in this engine.
 */

type Evidence = { key?: unknown; value?: unknown; confidence?: number; nature?: unknown; sourceUrl?: unknown };

export const OBSERVATION_KINDS = ["no_site", "slow_site", "not_mobile_site", "outdated_site", "no_online_booking"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export interface Observation {
  kind: ObservationKind;
  /** The sentence code puts in the message, word for word. */
  line: string;
}

interface Facts {
  /** Every value recorded for each key, from evidence the outreach rules accept (confidence ≥ 70, not a model's reading). */
  values: Map<string, unknown[]>;
  /** For the same items, the address each was read or measured on. */
  sources: Map<string, unknown[]>;
}

function factsOf(evidenceItems: Evidence[]): Facts {
  const values = new Map<string, unknown[]>();
  const sources = new Map<string, unknown[]>();
  for (const item of evidenceItems) {
    if (typeof item.confidence !== "number" || item.confidence < 70) continue;
    if (item.nature === "ai_interpretation") continue;
    if (typeof item.key !== "string") continue;
    values.set(item.key, [...(values.get(item.key) ?? []), item.value]);
    sources.set(item.key, [...(sources.get(item.key) ?? []), item.sourceUrl]);
  }
  return { values, sources };
}

/**
 * Kinds an automatic session may send unread. The others rest on heuristics
 * of our own page reader that were built to feed a score, and state false
 * things on ordinary pages (third review, 2026-11-12, on the real provider:
 * "plus mis à jour" from an icon library's "Copyright 2023" in a page whose
 * footer said 2026; "pas adapté au téléphone" from a viewport tag written
 * without quotes; "pas de prise de rendez-vous" next to a "Réserver" link to
 * a platform the detector does not list). They are written for a person to
 * check, never sent on their own, until each detector is corroborated.
 */
const UNREAD_KINDS = new Set<ObservationKind>(["no_site", "slow_site"]);

export function observationMayLeaveUnread(kind: unknown): boolean {
  return typeof kind === "string" && UNREAD_KINDS.has(kind as ObservationKind);
}

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
const hostOf = (address: string): string | undefined => {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(address) ? address : `https://${address}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
};

/** The label a host was registered under: the one before its last part. */
const registeredLabel = (host: string): string => host.split(".").slice(-2, -1)[0] ?? "";

/**
 * The same host, or the same registered name — under another ending
 * ("lonestar-tattoo.com" that forwards to "lonestar-tattoo.fr") or a
 * subdomain of it ("boutique.salon-alpha.fr"): one business, one site.
 * Anything else is somewhere our crawler was sent. (The host it is compared
 * with is one `ownAddress` accepted, so its registered label is a name, never
 * the "co" of a two-part ending.)
 */
const sameSite = (a: string, b: string): boolean => a === b || (registeredLabel(a) !== "" && registeredLabel(a) === registeredLabel(b));

/** Parameters a listing adds to a link, which say nothing of whose page it is. */
const TRACKING_PARAMETER = /^(?:utm_[a-z_]+|gclid|fbclid|y_source|ref)$/i;
/** Words of a name that name nobody. */
const NAME_FILLER = /^(?:les|des|the|and|chez|aux|pour|par|sur|une?)$/;

/**
 * The host of the business's own site, when the address on record is
 * positively theirs; undefined otherwise. "Not on a list of platforms" is no
 * such sign: a page on a platform no list knows (a chat link, a link-in-bio
 * service, a marketplace shop, a directory) would be "votre site". Theirs is:
 *  - the root of a registered domain (not a subdomain a platform hands out),
 *    with at most a listing's tracking parameters; or
 *  - a page of a host registered under their name — two of its words, or its
 *    only word exactly: one shared word is usually their trade ("tattoo" in
 *    tattoodo.com, "salon" in salonkee.fr);
 * and, if our crawler followed the address, it stayed on that site.
 */
function ownAddress(company: Record<string, unknown>, finalUrls: unknown[]): string | undefined {
  const website = typeof company.website === "string" ? company.website.trim() : "";
  if (!website || !isUsableCompanyWebsite(website)) return undefined;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(website) ? website : `https://${website}`);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  for (const final of finalUrls) {
    const landed = typeof final === "string" ? hostOf(final) : undefined;
    if (!landed || !sameSite(landed, host)) return undefined;
  }
  const atRoot = url.pathname === "/" || url.pathname === "";
  const onlyTracking = [...url.searchParams.keys()].every((key) => TRACKING_PARAMETER.test(key));
  if (atRoot && onlyTracking && host.split(".").length === 2) return host;
  // The name the host was registered under ("salon-alpha" in www.salon-alpha.fr,
  // "ivof" in nail.beauty.ivof.com): a subdomain is the platform's to hand out.
  const label = fold(registeredLabel(host)).replace(/[^a-z0-9]/g, "");
  const nameWords = [
    ...new Set(
      fold(typeof company.name === "string" ? company.name : "")
        .split(/[^a-z0-9]+/)
        .filter((part) => part.length >= 3 && !NAME_FILLER.test(part))
    )
  ];
  const carried = nameWords.filter((part) => label.includes(part)).length;
  return carried >= 2 || (nameWords.length === 1 && label === nameWords[0]) ? host : undefined;
}

/**
 * The sentence for one kind of observation, or undefined when the evidence
 * does not say it plainly. A key recorded twice with different values says
 * nothing; a measurement taken on a page that is not their own site (their
 * Instagram, a booking platform, a marketplace shop) says nothing about
 * "their site".
 */
function lineFor(kind: ObservationKind, facts: Facts, company: Record<string, unknown>): string | undefined {
  const all = (key: string) => facts.values.get(key) ?? [];
  const every = (key: string, value: unknown) => all(key).length > 0 && all(key).every((item) => item === value);
  const never = (key: string, value: unknown) => all(key).every((item) => item !== value);
  const numbers = (key: string) => all(key).filter((item): item is number => typeof item === "number" && Number.isFinite(item));

  const recorded = [company.website, company.domain].filter((value): value is string => typeof value === "string" && value.trim() !== "");
  const ownAddressOnRecord = recorded.some((value) => isUsableCompanyWebsite(value));
  const theirHost = ownAddress(company, all("final_website_url"));
  // Only a page on someone else's platform — unless the record names an address that is positively theirs.
  const platformOnly = (every("third_party_presence_only", true) || every("is_redirected_to_social", true)) && !theirHost;
  // A site of their own: said by the evidence, denied by none of it, at an address that is positively theirs.
  const ownSite = Boolean(theirHost) && every("has_website", true) && never("third_party_presence_only", true) && never("is_redirected_to_social", true);

  switch (kind) {
    case "no_site": {
      if (platformOnly) return "Sauf erreur de ma part, vous n'avez pas de site à votre nom.";
      // "No address on record" is the weakest of facts: any sign of a site contradicts it.
      const measured =
        numbers("lcp_seconds").length > 0 ||
        numbers("pagespeed_lcp").length > 0 ||
        numbers("mobile_pagespeed_score").length > 0 ||
        all("website_reachable").some((item) => item === true) ||
        all("final_website_url").length > 0;
      return every("has_website", false) && !ownAddressOnRecord && !measured
        ? "Sauf erreur de ma part, vous n'avez pas de site à votre nom."
        : undefined;
    }
    case "slow_site": {
      // One measurement, beyond the 4 s past which Google's own band calls a
      // page's main content slow — as quoted, to one decimal — and taken on
      // their site: a figure on file from another address (the record was
      // corrected since, evidence lives 30 days) is not theirs.
      const lcp = [...new Set([...numbers("lcp_seconds"), ...numbers("pagespeed_lcp")])];
      if (!ownSite || !theirHost || lcp.length !== 1 || Number(lcp[0].toFixed(1)) <= 4) return undefined;
      const measuredOn = [...(facts.sources.get("lcp_seconds") ?? []), ...(facts.sources.get("pagespeed_lcp") ?? [])];
      const onTheirSite = measuredOn.every((source) => {
        const host = typeof source === "string" ? hostOf(source) : undefined;
        return Boolean(host) && sameSite(host as string, theirHost);
      });
      if (!onTheirSite) return undefined;
      return `D'après le test PageSpeed de Google, votre site met ${lcp[0].toFixed(1).replace(".", ",")} secondes à s'afficher sur téléphone.`;
    }
    case "not_mobile_site":
      return ownSite && every("mobile_friendly", false) ? "Votre site ne semble pas adapté à l'affichage sur téléphone." : undefined;
    case "outdated_site":
      return ownSite && every("is_copyright_outdated", true) ? "Votre site ne semble plus mis à jour." : undefined;
    case "no_online_booking":
      return ownSite && every("has_booking_widget", false) ? "Je n'ai pas vu de prise de rendez-vous en ligne sur votre site." : undefined;
  }
}

/**
 * Evidence about a web page: everything measured or read on one. The model
 * does not speak of the prospect's online presence in the conversation style
 * — this module does — so it is not handed what it must not use: with these
 * facts in hand it wrote "vous n'avez pas de site" one time in seven.
 */
const ONLINE_PRESENCE_FACT =
  /website|(?:^|_)(?:site|web|page|lcp|fcp|cls|pagespeed|mobile|ssl|cms|tech|technical|copyright|booking|ecommerce|cart|ordering|viewport|layout|social|redirected|third|platform|reachable|unreachable|outdated)(?:_|$)/i;

export function isOnlinePresenceFact(key: string): boolean {
  return ONLINE_PRESENCE_FACT.test(key);
}

/** The kinds a business asked for, in its order, unknown names dropped. */
export function observationKinds(configured: unknown): ObservationKind[] {
  if (!Array.isArray(configured)) return [];
  const known = new Set<string>(OBSERVATION_KINDS);
  return [...new Set(configured.filter((kind): kind is ObservationKind => typeof kind === "string" && known.has(kind)))];
}

/**
 * The one observation to state: the first of the business's kinds, in its
 * order, that the prospect's verified evidence says plainly. Undefined when
 * the business asked for none or the evidence says none.
 */
export function pickObservation(
  configured: unknown,
  evidenceItems: Evidence[],
  company: Record<string, unknown> = {}
): Observation | undefined {
  const facts = factsOf(evidenceItems);
  for (const kind of observationKinds(configured)) {
    const line = lineFor(kind, facts, company);
    if (line) return { kind, line };
  }
  return undefined;
}

const L = "a-zàâäçéèêëîïôöùûüÿœæ";
const STEM = `[${L}]*`;

/**
 * Words the model's parts of a conversation DM must not contain at all: the
 * subject is the code's. Each entry pairs what the PROMPT forbids with the
 * pattern the check looks for, and the prompt's list is built from this table
 * (SOCIAL_DM_CONVERSATION_SYSTEM_PROMPT), as for commercial words
 * (social-dm-terms.ts): a match means the model used a word it was told not
 * to use. Stems, not inflections.
 */
const PRESENCE_TABLE: Array<[word: string, pattern: string]> = [
  ["site", "sites?"],
  ["page", "pages?"],
  ["web, internet", "web|internet"],
  ["en ligne", "en ligne|online"],
  ["présence", "présences?"],
  ["numérique, digital", `numériques?|digita${STEM}`],
  ["Instagram, Facebook, réseaux, profil, fiche", "instagram|insta|facebook|tiktok|linktree|réseaux|réseau|profils?|fiches?"],
  ["réserver, réservation", `réserv${STEM}`],
  ["rendez-vous, créneau, appeler", `rendez-vous|rdv|créneaux?|appel${STEM}`],
  ["téléphone, mobile, smartphone", "téléphones?|mobiles?|smartphones?|portables?|écrans?"],
  // "Votre salon affiche une note de 5/5" is how a rating is said: only what a screen does is the subject.
  ["affichage, s'afficher", `affichages?|s'affich${STEM}|afficher`],
  ["charger, chargement", `charg${STEM}|télécharg${STEM}`],
  // The adjective and the noun, not "rapidement": an adverb says how THEY work.
  ["vitesse, rapide, rapidité, lent", `vitesses?|rapides?|rapidité|lent${STEM}|fluid${STEM}`],
  ["refonte, refaire, coup de neuf", `refon${STEM}|refai${STEM}|refait${STEM}|coup de (?:neuf|jeune)`],
  // "Une réputation bien méritée" is a compliment; "ils méritent mieux" is the innuendo.
  ["mériter mieux, mériter plus", `mérit${STEM}\\s+(?:bien\\s+)?(?:mieux|plus|d'être|d'avoir|une?)`],
  ["mettre à jour, actualiser", `à jour|actualis${STEM}|rafraîch${STEM}`],
  ["interface, navigation", `interfaces?|navig${STEM}|ergonom${STEM}`],
  ["référencement, recherche", `référenc${STEM}|seo|moteurs? de recherche|recherches?`],
  ["visible, visibilité, introuvable", "visibles?|invisibles?|visibilité|introuvables?"],
  ["url", "url"],
  ["cliquer, visiteur, internaute", `cli(?:c|qu)${STEM}|visiteurs?|internautes?`]
];

/** The words the prompt forbids, in the table's order. */
export const PRESENCE_WORDS: readonly string[] = PRESENCE_TABLE.map(([word]) => word);

const PRESENCE = new RegExp(`(?<![${L}])(?:${PRESENCE_TABLE.map(([, pattern]) => pattern).join("|")})(?![${L}])`, "i");

/**
 * The first word of the closed subject vocabulary `text` uses, as written,
 * or undefined. `text` is what the MODEL wrote: the code's own sentences are
 * removed by the caller.
 */
export function presenceWordIn(text: string): string | undefined {
  const source = String(text ?? "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
  return source.match(PRESENCE)?.[0].trim();
}
