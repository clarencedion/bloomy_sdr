import { isUsableCompanyWebsite } from "./third-party-domains.js";

// Exhaustive list of French annuaire/directory/social/news domains to exclude
const EXCLUDED_DOMAINS = [
  // Annuaires entreprises
  "societe.com", "pappers.fr", "infogreffe.fr", "verif.com", "kompass.fr",
  "manageo.fr", "corporama.com", "score3.fr", "bilan-comptable.com",
  "firmex.fr", "societe-juridique.fr", "infolegale.fr", "ellisphere.com",
  "nomination.fr", "viadeo.com", "decideurs-magazine.com", "zebusiness.fr",
  "bizzbee.fr", "salaire-brut-net.fr", "eterritoire.fr", "siretinfo.com",
  "naf.fr", "entreprises.lefigaro.fr", "societeinfo.com", "datainfogreffe.fr",
  "bodacc.fr", "journal-officiel.gouv.fr",
  // Annuaires généralistes
  "pages-jaunes.fr", "pagesjaunes.fr", "annuaire.fr", "annuairedesfournisseurs.fr",
  "118000.fr", "118218.fr", "118712.fr", "hoodspot.fr", "yelp.fr",
  "lesannonces.fr", "lesclesdelemballage.com",
  // Portails gouvernementaux
  "data.gouv.fr", "annuaire-entreprises.data.gouv.fr", "recherche-entreprises.api.gouv.fr",
  "annuaire-mairie.fr", "service-public.fr", "entreprises.gouv.fr",
  "bpifrance.fr", "cma-france.fr", "cci.fr", "cnews.fr",
  // Réseaux sociaux
  "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
  "youtube.com", "tiktok.com", "pinterest.fr", "snapchat.com",
  // Presse / médias
  "lefigaro.fr", "lesechos.fr", "bfmtv.com", "leparisien.fr", "lemonde.fr",
  "capital.fr", "challenges.fr", "latribune.fr", "lexpansion.fr",
  "usinenouvelle.com", "industrie-mag.com", "lsa-conso.fr",
  // Emploi
  "indeed.fr", "indeed.com", "welcometothejungle.com", "jobijoba.com",
  "monster.fr", "cadremploi.fr", "cadresonline.com", "apec.fr",
  "pole-emploi.fr", "francetravail.fr", "glassdoor.fr", "jobrapido.fr",
  "rekrute.com", "hellowork.com",
  // Avis / notation
  "trustpilot.com", "tripadvisor.fr", "google.com", "maps.google",
  // Marchés publics / appels d'offres
  "marches-publics.info", "boamp.fr", "achatpublic.com", "klekoon.com",
  // Divers
  "wikipedia.org", "wikidata.org", "malt.fr", "freelance.com",
  "amazon.fr", "ebay.fr", "leboncoin.fr", "rakuten.fr",
  "github.com", "gitlab.com", "npmjs.com", "pypi.org"
];

function isExcluded(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return EXCLUDED_DOMAINS.some((ex) => hostname === ex || hostname.endsWith(`.${ex}`));
  } catch {
    return true;
  }
}

async function lookupPappersWebsite(siren: string, apiKey: string): Promise<string | undefined> {
  try {
    const url = `https://api.pappers.fr/v2/entreprise?api_token=${apiKey}&siren=${encodeURIComponent(siren)}&champs=site_internet`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return undefined;
    const data = (await resp.json()) as { site_internet?: string };
    return data.site_internet || undefined;
  } catch {
    return undefined;
  }
}

async function searchSerper(name: string, city: string | undefined, apiKey: string): Promise<string | undefined> {
  try {
    const query = `"${name}"${city ? ` ${city}` : ""} site officiel`;
    const resp = await fetch("https://google.serper.dev/search", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "fr", hl: "fr", num: 5 })
    });
    if (!resp.ok) return undefined;
    const data = (await resp.json()) as { organic?: Array<{ link?: string }> };
    for (const item of data.organic ?? []) {
      if (item.link && !isExcluded(item.link)) return item.link;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export type WebsiteResolveResult = {
  website: string;
  domain: string;
  resolvedBy: "pappers" | "google_search";
} | { website: undefined; domain: undefined; resolvedBy: "none" };

export async function resolveCompanyWebsite(company: {
  name?: string;
  city?: string;
  siren?: string;
}, secrets: { pappersApiKey?: string; serperApiKey?: string }): Promise<WebsiteResolveResult> {
  let found: string | undefined;
  let resolvedBy: "pappers" | "google_search" | "none" = "none";

  // 1. Pappers by SIREN — authoritative when available
  if (company.siren && secrets.pappersApiKey) {
    found = await lookupPappersWebsite(company.siren, secrets.pappersApiKey);
    if (found) resolvedBy = "pappers";
  }

  // 2. Google search via Serper.dev — finds the real website with annuaire exclusion
  if (!found && company.name && secrets.serperApiKey) {
    found = await searchSerper(company.name, company.city, secrets.serperApiKey);
    if (found) resolvedBy = "google_search";
  }

  if (!found || resolvedBy === "none") return { website: undefined, domain: undefined, resolvedBy: "none" };
  // A search can still land on a map, a directory or a booking page
  // (fr.mappy.com/poi/… in the live run of 2026-11-10): that is not their
  // site, and what it lists (emails, links) belongs to others.
  if (!isUsableCompanyWebsite(found)) return { website: undefined, domain: undefined, resolvedBy: "none" };

  let domain: string;
  try {
    const normalized = found.startsWith("http") ? found : `https://${found}`;
    domain = new URL(normalized).hostname.replace(/^www\./, "");
    found = normalized;
  } catch {
    return { website: undefined, domain: undefined, resolvedBy: "none" };
  }

  return { website: found, domain, resolvedBy };
}

export const EXCLUDED_DOMAINS_LIST = EXCLUDED_DOMAINS;

export function isExcludedDomain(urlOrHostname: string): boolean {
  return isExcluded(urlOrHostname);
}

export interface WebsiteResolutionEvidence {
  signalProvider: "website_presence" | "website_technical";
  key: string;
  value: unknown;
  sourceType: "official_registry" | "provider" | "website";
  sourceUrl?: string;
  confidence: number;
  nature: "fact";
  collectedAt: Date;
  expiresAt?: Date;
  costUsd?: number;
}

export function createWebsiteResolutionEvidence(result: WebsiteResolveResult): WebsiteResolutionEvidence[] {
  if (result.resolvedBy === "none" || !result.website || !result.domain) {
    return [
      {
        signalProvider: "website_presence",
        key: "has_website",
        value: false,
        sourceType: "provider",
        confidence: 90,
        nature: "fact",
        collectedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    ];
  }

  const now = new Date();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const confidence = result.resolvedBy === "pappers" ? 95 : 85;
  const sourceType = result.resolvedBy === "pappers" ? "official_registry" : "provider";

  return [
    {
      signalProvider: "website_presence",
      key: "has_website",
      value: true,
      sourceType,
      sourceUrl: result.website,
      confidence,
      nature: "fact",
      collectedAt: now,
      expiresAt
    },
    {
      signalProvider: "website_presence",
      key: "resolved_website",
      value: result.website,
      sourceType,
      sourceUrl: result.website,
      confidence,
      nature: "fact",
      collectedAt: now,
      expiresAt
    },
    {
      signalProvider: "website_presence",
      key: "resolved_domain",
      value: result.domain,
      sourceType,
      sourceUrl: result.website,
      confidence,
      nature: "fact",
      collectedAt: now,
      expiresAt
    },
    {
      signalProvider: "website_presence",
      key: "website_resolve_source",
      value: result.resolvedBy,
      sourceType,
      sourceUrl: result.website,
      confidence: 90,
      nature: "fact",
      collectedAt: now,
      expiresAt
    }
  ];
}

