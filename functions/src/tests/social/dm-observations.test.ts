import { describe, it, expect, vi } from "vitest";

// Offline only: nothing here reads Firestore; the module that labels facts
// imports the Firestore handle, so it gets the in-memory fake.
vi.mock("../../config/firebase.js", async () => {
  const { fakeDb } = await import("./fixtures/outbound-fake-firestore.js");
  return { adminDb: fakeDb };
});

import {
  OBSERVATION_KINDS,
  observationKinds,
  observationMayLeaveUnread,
  pickObservation,
  presenceWordIn,
  PRESENCE_WORDS
} from "../../services/social/dm-observations.js";
import { conversationFacts } from "../../services/social-dm-conversation.js";
import { extractPersonalizationFacts } from "../../services/evidence-service.js";
import { mentionsCommercialTerms } from "../../services/pricing-guardrail.js";
import { modelCopyIssues } from "../../services/social-dm-terms.js";
import { knownFigures, unverifiedFigures } from "../../services/social/dm-figures.js";

// Read or measured on OWN's address, unless a test says otherwise.
const fact = (key: string, value: unknown, extra: Record<string, unknown> = {}) => ({
  key,
  value,
  confidence: 90,
  nature: "fact",
  sourceUrl: "https://www.salon-alpha.fr/",
  ...extra
});
const ALL = [...OBSERVATION_KINDS];
const NO_SITE = "Sauf erreur de ma part, vous n'avez pas de site à votre nom.";
const OWN_SITE = [fact("has_website", true), fact("third_party_presence_only", false)];
const INSTAGRAM = { website: "https://www.instagram.com/salon_a/" };
// The record's address is positively theirs: the root of a host.
const OWN = { name: "Salon Alpha", website: "https://www.salon-alpha.fr/" };

describe("pickObservation — one sentence about their online presence, written by code from the evidence", () => {
  it("states nothing for a business that asked for nothing, whatever the evidence says", () => {
    const evidence = [fact("has_website", false), fact("third_party_presence_only", true)];
    expect(pickObservation(undefined, evidence)).toBeUndefined();
    expect(pickObservation([], evidence)).toBeUndefined();
    expect(pickObservation("no_site", evidence)).toBeUndefined();
    expect(pickObservation(["nothing_we_know"], evidence)).toBeUndefined();
  });

  it("keeps only the kinds it knows, once each, in the business's order", () => {
    expect(observationKinds(["slow_site", "bogus", "no_site", "slow_site", 3])).toEqual(["slow_site", "no_site"]);
    expect(observationKinds(null)).toEqual([]);
  });

  it("states nothing when the evidence says nothing", () => {
    expect(pickObservation(ALL, [])).toBeUndefined();
    expect(pickObservation(ALL, [fact("google_review_count", 154), fact("google_rating", 4.9)])).toBeUndefined();
  });

  describe("no site of their own", () => {
    it("is said when their only address is a page on someone else's platform", () => {
      expect(pickObservation(ALL, [fact("third_party_presence_only", true), fact("has_website", true)], INSTAGRAM)).toEqual({ kind: "no_site", line: NO_SITE });
      expect(pickObservation(ALL, [fact("is_redirected_to_social", true)], INSTAGRAM)).toEqual({ kind: "no_site", line: NO_SITE });
    });

    it("a platform flag beside an address on record that is positively theirs is a contradiction, and says nothing", () => {
      expect(pickObservation(ALL, [fact("third_party_presence_only", true), fact("has_website", true)], OWN)).toBeUndefined();
      expect(pickObservation(ALL, [fact("is_redirected_to_social", true), fact("has_website", true)], OWN)).toBeUndefined();
    });

    it("is said when no address is on record and nothing contradicts it", () => {
      expect(pickObservation(ALL, [fact("has_website", false)])).toEqual({ kind: "no_site", line: NO_SITE });
      // An address that is a social page is not a site of their own.
      expect(pickObservation(ALL, [fact("has_website", false)], INSTAGRAM)?.kind).toBe("no_site");
    });

    it("'no address on record' is the weakest of facts: any sign of a site contradicts it", () => {
      const noSite = fact("has_website", false);
      expect(pickObservation(ALL, [noSite], { website: "https://www.salon-a.fr" })).toBeUndefined();
      expect(pickObservation(ALL, [noSite], { domain: "salon-a.fr" })).toBeUndefined();
      // The same key recorded twice with different values says nothing, whichever comes first.
      expect(pickObservation(ALL, [noSite, fact("has_website", true)])).toBeUndefined();
      expect(pickObservation(ALL, [fact("has_website", true), noSite])).toBeUndefined();
      // A site was measured, fetched or resolved.
      expect(pickObservation(ALL, [noSite, fact("lcp_seconds", 2.1)])).toBeUndefined();
      expect(pickObservation(ALL, [noSite, fact("mobile_pagespeed_score", 80)])).toBeUndefined();
      expect(pickObservation(ALL, [noSite, fact("website_reachable", true)])).toBeUndefined();
      expect(pickObservation(ALL, [noSite, fact("final_website_url", "https://www.salon-a.fr/")])).toBeUndefined();
      // "Only on a platform" recorded both ways says nothing either.
      expect(pickObservation(ALL, [fact("third_party_presence_only", true), fact("third_party_presence_only", false)], { website: "https://x.fr" })).toBeUndefined();
    });

    it("is not said on evidence nobody trusts, or on a model's reading", () => {
      expect(pickObservation(ALL, [fact("has_website", false, { confidence: 50 })])).toBeUndefined();
      expect(pickObservation(ALL, [fact("has_website", false, { nature: "ai_interpretation" })])).toBeUndefined();
      expect(pickObservation(ALL, [fact("third_party_presence_only", true, { confidence: 69 })])).toBeUndefined();
    });
  });

  describe("a slow site", () => {
    it("is said with the measured figure, to one decimal, when the one measurement is beyond Google's slow band", () => {
      expect(pickObservation(["slow_site"], [...OWN_SITE, fact("lcp_seconds", 16.38)], OWN)).toEqual({
        kind: "slow_site",
        line: "D'après le test PageSpeed de Google, votre site met 16,4 secondes à s'afficher sur téléphone."
      });
      expect(pickObservation(["slow_site"], [...OWN_SITE, fact("pagespeed_lcp", 10.01)], OWN)?.line).toContain("10,0 secondes");
    });

    it("is not said of an ordinary loading time, of one that reads '4,0', of two measurements that differ, or without a site of their own on record", () => {
      expect(pickObservation(["slow_site"], [...OWN_SITE, fact("lcp_seconds", 3.3)], OWN)).toBeUndefined();
      expect(pickObservation(["slow_site"], [...OWN_SITE, fact("lcp_seconds", 4)], OWN)).toBeUndefined();
      expect(pickObservation(["slow_site"], [...OWN_SITE, fact("lcp_seconds", 4.04)], OWN)).toBeUndefined();
      expect(pickObservation(["slow_site"], [...OWN_SITE, fact("lcp_seconds", 4.06)], OWN)?.line).toContain("4,1 secondes");
      expect(pickObservation(["slow_site"], [...OWN_SITE, fact("lcp_seconds", 9), fact("lcp_seconds", 12)], OWN)).toBeUndefined();
      expect(pickObservation(["slow_site"], [fact("lcp_seconds", 16.4)], OWN)).toBeUndefined();
      expect(pickObservation(["slow_site"], [fact("has_website", true), fact("has_website", false), fact("lcp_seconds", 16.4)], OWN)).toBeUndefined();
    });

    it("a measurement taken on their Instagram or a booking platform says nothing about 'their site'", () => {
      const onSocial = [fact("has_website", true), fact("is_redirected_to_social", true), fact("lcp_seconds", 9.1), fact("has_booking_widget", false), fact("mobile_friendly", false)];
      // Asked for everything but "no site": none of the others may speak.
      expect(pickObservation(["slow_site", "not_mobile_site", "outdated_site", "no_online_booking"], onSocial, INSTAGRAM)).toBeUndefined();
      const onPlatform = [fact("has_website", true), fact("third_party_presence_only", true), fact("lcp_seconds", 10.5), fact("mobile_friendly", false)];
      expect(pickObservation(["slow_site", "not_mobile_site"], onPlatform, OWN)).toBeUndefined();
      // A flag recorded both ways is a doubt, and a doubt says nothing.
      const bothWays = [...OWN_SITE, fact("is_redirected_to_social", true), fact("is_redirected_to_social", false), fact("lcp_seconds", 9.1)];
      expect(pickObservation(["slow_site"], bothWays, OWN)).toBeUndefined();
      // With "no site" asked for, that is what is said.
      expect(pickObservation(ALL, onSocial, INSTAGRAM)?.kind).toBe("no_site");
    });

    // A slow measurement taken on `website` itself, for a business called `name`.
    const slowOn = (name: string, website: string, measuredOn = website) =>
      pickObservation(["slow_site", "not_mobile_site", "outdated_site", "no_online_booking"], [...OWN_SITE, fact("lcp_seconds", 9.1, { sourceUrl: measuredOn })], { name, website });

    it("needs a positive sign that the address on record is theirs: 'not on a list of platforms' is not one", () => {
      // A page on a platform no list knows — a chat link, a link-in-bio service, a marketplace shop, a social profile.
      for (const website of [
        "https://wa.me/33612345678",
        "https://beacons.ai/salon_alpha",
        "https://www.tattoodo.com/artists/salon-alpha",
        "https://www.etsy.com/fr/shop/SalonAlpha",
        "https://www.threads.net/@salon_alpha"
      ]) {
        expect(slowOn("Salon Alpha", website), website).toBeUndefined();
      }
      // Recorded as "their website" by discovery on 2026-11-12: two directory pages.
      expect(
        slowOn(
          "Nouvel Hair L'Homme Lille - Coiffeur & Barbier",
          "https://wanderboat.ai/local-businesses/france/lille/nouvel-hair-l'homme-lille---coiffeur-%26-barbier/iP06gIzaTIyQbwQZ2Tf5AQ"
        )
      ).toBeUndefined();
      expect(slowOn("Le Cercle d'Or - Lille", "https://nail.beauty.ivof.com/le-cercle-dor/")).toBeUndefined();
      // No address on record at all, or one that cannot be read.
      expect(pickObservation(["slow_site"], [...OWN_SITE, fact("lcp_seconds", 9.1)], { name: "Salon Alpha" })).toBeUndefined();
      expect(slowOn("Salon Alpha", "not a url at all")).toBeUndefined();
    });

    it("one word shared with a platform's name is usually their trade: two of the name's words, or its only word exactly", () => {
      // Each of these platforms carries one word of the business's name in its own.
      expect(slowOn("Lonestar Tattoo", "https://www.tattoodo.com/artists/lonestar")).toBeUndefined();
      expect(slowOn("Salon Élégance", "https://www.salonkee.fr/salon/elegance-lille")).toBeUndefined();
      expect(slowOn("Tattoo Paris 11", "https://www.parisinfo.com/shopping/123/tattoo-paris-11")).toBeUndefined();
      expect(slowOn("Fleurs de Lys", "https://www.fleuristes-et-fleurs.com/lille/fleurs-de-lys")).toBeUndefined();
      expect(slowOn("Le Salon", "https://www.salonkee.fr/salon/le-salon-lille")).toBeUndefined();
      // A page of a host registered under their name.
      expect(slowOn("Barber Kong - Montpellier", "https://www.barberkong.fr/montpellier")?.kind).toBe("slow_site");
      expect(slowOn("TABAS TATTOO_Studio de tatouages à Marseille", "http://www.tabas.fr/tattoo")).toBeUndefined();
      expect(slowOn("Tabas", "http://www.tabas.fr/tattoo")?.kind).toBe("slow_site");
      expect(slowOn("Salon Alpha", "https://www.autre-chose.fr/salons/alpha")).toBeUndefined();
      // A name in a subdomain is the platform's to hand out: it is the registered name that counts.
      expect(slowOn("Salon Alpha", "https://salonalpha.some-platform.io/booking")).toBeUndefined();
    });

    it("the root of a registered domain is theirs; the root of a subdomain, or of a page told apart by a parameter, is not", () => {
      expect(slowOn("Salon Alpha", "https://www.salon-alpha.fr/")?.kind).toBe("slow_site");
      // What a listing adds to a link says nothing of whose page it is.
      expect(slowOn("Sashatattooing Paris", "https://sashatattooingparis.com/?utm_source=gmb&utm_medium=organic")?.kind).toBe("slow_site");
      expect(slowOn("Inconnu Total", "https://un-domaine-quelconque.fr/?utm_source=gmb")?.kind).toBe("slow_site");
      // A platform hands out subdomains; its own root with a parameter is one of its pages.
      for (const website of [
        "https://salon-a.setmore.com/",
        "https://salon-a.simplybook.it",
        "https://salon-a.resalib.fr/?utm_source=gmb",
        "https://salonalpha.planity.com/",
        "https://www.tattoodo.com/?utm_source=google&studio=42"
      ]) {
        expect(slowOn("Salon A", website), website).toBeUndefined();
      }
    });

    it("the figure must have been measured on their site, and our crawler must have stayed on it", () => {
      // A figure on file from another address — the record was corrected since, and evidence lives a month.
      expect(slowOn("Black Rose", "https://www.blackrose.fr/", "https://wanderboat.ai/local-businesses/france/lille/black-rose")).toBeUndefined();
      // A measurement that does not say where it was taken says nothing.
      expect(pickObservation(["slow_site"], [...OWN_SITE, fact("lcp_seconds", 9.1, { sourceUrl: undefined })], OWN)).toBeUndefined();
      // The same site under www, http or a deeper page: theirs.
      expect(slowOn("Salon Alpha", "https://www.salon-alpha.fr/", "http://salon-alpha.fr/accueil")?.kind).toBe("slow_site");
      // The same registered name under another ending is the same site; another name is not.
      const measured = [...OWN_SITE, fact("lcp_seconds", 9.1)];
      expect(pickObservation(["slow_site"], [...measured, fact("final_website_url", "https://salon-alpha.com/")], OWN)?.kind).toBe("slow_site");
      expect(pickObservation(["slow_site"], [...measured, fact("final_website_url", "https://salon-alpha.fr/accueil")], OWN)?.kind).toBe("slow_site");
      expect(pickObservation(["slow_site"], [...measured, fact("final_website_url", "https://boutique.salon-alpha.fr/")], OWN)?.kind).toBe("slow_site");
      expect(pickObservation(["slow_site"], [...measured, fact("final_website_url", "https://www.etsy.com/fr/shop/SalonAlpha")], OWN)).toBeUndefined();
      expect(pickObservation(["slow_site"], [...measured, fact("final_website_url", "https://salon-alpha.etsy.com/")], OWN)).toBeUndefined();
      expect(pickObservation(["slow_site"], [...measured, fact("final_website_url", "https://salon-alpha.co.uk/")], OWN)).toBeUndefined();
    });
  });

  it.each([
    ["not_mobile_site", "mobile_friendly", false, "Votre site ne semble pas adapté à l'affichage sur téléphone."],
    ["outdated_site", "is_copyright_outdated", true, "Votre site ne semble plus mis à jour."],
    ["no_online_booking", "has_booking_widget", false, "Je n'ai pas vu de prise de rendez-vous en ligne sur votre site."]
  ] as const)("%s: said on its fact, not on the opposite, not on both, not without a site of their own", (kind, key, value, line) => {
    expect(pickObservation([kind], [...OWN_SITE, fact(key, value)], OWN)).toEqual({ kind, line });
    expect(pickObservation([kind], [...OWN_SITE, fact(key, !value)], OWN)).toBeUndefined();
    expect(pickObservation([kind], [...OWN_SITE, fact(key, value), fact(key, !value)], OWN)).toBeUndefined();
    expect(pickObservation([kind], [fact(key, value)], OWN)).toBeUndefined();
    expect(pickObservation([kind], [...OWN_SITE, fact(key, value)], INSTAGRAM)).toBeUndefined();
    expect(pickObservation([kind], [...OWN_SITE, fact(key, value, { confidence: 60 })], OWN)).toBeUndefined();
    // A guess of our own page reader: written for a person to check, never sent unread.
    expect(observationMayLeaveUnread(kind)).toBe(false);
  });

  it("only what is read from a platform flag or measured by Google's test may leave unread", () => {
    expect(OBSERVATION_KINDS.filter((kind) => observationMayLeaveUnread(kind))).toEqual(["no_site", "slow_site"]);
    expect(observationMayLeaveUnread("anything")).toBe(false);
    expect(observationMayLeaveUnread(undefined)).toBe(false);
  });

  it("values of the wrong type say nothing", () => {
    expect(pickObservation(ALL, [fact("has_website", "false")])).toBeUndefined();
    expect(pickObservation(ALL, [fact("third_party_presence_only", "true")])).toBeUndefined();
    expect(pickObservation(ALL, [...OWN_SITE, fact("lcp_seconds", "16.4"), fact("mobile_friendly", null)], OWN)).toBeUndefined();
  });

  it("a year on record is not 'outdated' by itself, and a crawler that could not fetch a page states nothing", () => {
    expect(pickObservation(ALL, [...OWN_SITE, fact("outdated_copyright_year", 2023)], OWN)).toBeUndefined();
    expect(pickObservation(ALL, [...OWN_SITE, fact("website_reachable", false)], OWN)).toBeUndefined();
  });

  it("states the first of the business's kinds that the evidence says, and only one", () => {
    const evidence = [...OWN_SITE, fact("lcp_seconds", 12.3), fact("mobile_friendly", false), fact("is_copyright_outdated", true)];
    expect(pickObservation(["outdated_site", "slow_site"], evidence, OWN)?.kind).toBe("outdated_site");
    expect(pickObservation(["slow_site", "outdated_site"], evidence, OWN)?.kind).toBe("slow_site");
    expect(pickObservation(["no_site", "not_mobile_site"], evidence, OWN)?.kind).toBe("not_mobile_site");
  });

  it("every sentence it can write states no commercial term, and its figure is the evidence's", () => {
    const cases: Array<[string, unknown[]]> = [
      ["no_site", [fact("has_website", false)]],
      ["slow_site", [...OWN_SITE, fact("lcp_seconds", 30.15)]],
      ["not_mobile_site", [...OWN_SITE, fact("mobile_friendly", false)]],
      ["outdated_site", [...OWN_SITE, fact("is_copyright_outdated", true)]],
      ["no_online_booking", [...OWN_SITE, fact("has_booking_widget", false)]]
    ];
    for (const [kind, evidence] of cases) {
      const line = pickObservation([kind], evidence as never, kind === "no_site" ? {} : OWN)?.line ?? "";
      expect(line, kind).not.toBe("");
      expect(mentionsCommercialTerms(line), line).toBe(false);
      expect(modelCopyIssues(line), line).toEqual([]);
      expect(unverifiedFigures(line, knownFigures(evidence as never, {})), line).toEqual([]);
    }
  });
});

describe("presenceWordIn — the model's parts stay off the subject", () => {
  it("finds nothing in an opening about their reputation and a question about an example", () => {
    for (const text of [
      "Bonjour ! 4,9 sur Google avec 154 avis, ça se remarque.\nJe peux vous montrer un exemple ?",
      "Bonjour. Vos 254 avis Google à 4,9/5 sont remarquables pour un tatoueur.\nSeriez-vous curieux de voir un exemple ?",
      "Bonjour, votre salon de tatouage et piercing affiche une note parfaite de 5/5 sur Google.\nPuis-je vous montrer ce que cela donnerait pour votre salon ?",
      "Bonjour. Avec 499 avis et une note de 4,9/5 sur Google, votre réputation de barbier est solide.\nEst-ce quelque chose que vous avez en tête en ce moment ?",
      "Bonjour. Vos clients ne tarissent pas d'éloges, et votre talent est excellent."
    ]) {
      expect(presenceWordIn(text), text).toBeUndefined();
    }
  });

  // Every sentence two adversarial reviews got past a check that read the model's text for claims.
  it.each([
    "mais vous n'avez pas de site propre.",
    "mais je n'ai pas trouvé de site à votre nom.",
    "et pourtant vous n'avez que votre page Instagram.",
    "mais il vous manque un site.",
    "mais votre site date un peu.",
    "mais votre site met longtemps à s'afficher sur téléphone.",
    "mais on ne peut pas réserver en ligne chez vous.",
    "et ils méritent mieux qu'une page Instagram.",
    "et ils méritent un vrai site.",
    "et pourtant vous êtes présent en ligne uniquement sur Instagram.",
    "mais impossible de réserver en ligne chez vous.",
    "mais la réservation se fait encore par téléphone chez vous.",
    "mais votre site pourrait être plus rapide.",
    "mais votre site est difficile à lire sur téléphone.",
    "mais votre site mériterait d'être modernisé.",
    "mais votre site est en maintenance.",
    "mais votre présence en ligne n'inspire pas confiance.",
    "Votre site est lent, illisible et bâclé.",
    // Without the word "site": the words that speak of one anyway.
    "mais tout cela mériterait une refonte.",
    "mais l'affichage est lent chez vous.",
    "mais ce n'est pas à jour.",
    "mais le chargement est interminable.",
    "mais vos visiteurs repartent vite.",
    "mais votre référencement est faible.",
    "Avez-vous prévu de revoir la vitesse d'affichage ?",
    "Une refonte est-elle dans vos projets ?",
    "Avez-vous prévu d'avoir un site internet bientôt ?",
    "Puis-je vous montrer à quoi ressemblerait votre propre site ?",
    "Vous n'avez pas\nde site.",
    // The innuendos a third review got through, each with the word that carries it.
    "Vos 154 avis méritent mieux qu'un simple profil.",
    "Chez vous, il faut encore appeler pour avoir un créneau.",
    "Tout cela mériterait un coup de neuf.",
    "Vos 154 avis méritent mieux que ça.",
    "Votre fiche Google ne mène nulle part."
  ])("finds the subject in: %s", (text) => {
    expect(presenceWordIn(`Bonjour ! 4,9 sur Google avec 154 avis, ${text}`)).toBeDefined();
  });

  it("names the word as written, for the person who reads the draft", () => {
    expect(presenceWordIn("Bonjour. Votre Site est beau.")).toBe("site");
    expect(presenceWordIn("Bonjour. Tout se fait en  ligne.")).toBe("en ligne");
  });

  it("does not take a word that merely contains one, nor the adverbs that say how THEY work", () => {
    expect(presenceWordIn("Bonjour. Un parasite ? Non. Une opposition ? Non plus.")).toBeUndefined();
    expect(presenceWordIn("Bonjour. Vos clients sont ravis, excellent travail.")).toBeUndefined();
    expect(presenceWordIn("Bonjour. Vos clients sont visiblement ravis, et vous répondez rapidement.")).toBeUndefined();
    expect(presenceWordIn("Bonjour. On trouve chez vous un vrai savoir-faire, et le lien avec vos clients se voit.")).toBeUndefined();
    expect(presenceWordIn("Bonjour. Votre vitrine donne envie d'entrer.")).toBeUndefined();
    // "Mérité" is the most natural compliment; "méritent mieux" is the innuendo.
    expect(presenceWordIn("Bonjour. 4,9 sur 154 avis, c'est amplement mérité, une réputation bien méritée.")).toBeUndefined();
    expect(presenceWordIn("Bonjour. Vos 154 avis méritent bien mieux.")).toBeDefined();
  });

  it("every entry of the list the prompt forbids is one the check finds", () => {
    for (const entry of PRESENCE_WORDS) {
      for (const word of entry.split(", ")) expect(presenceWordIn(`Bonjour, ${word} ici.`), word).toBeDefined();
    }
  });
});

describe("conversationFacts — what the model's opening may be built on", () => {
  const evidence = [
    fact("siren", "949829154"),
    fact("siret", "94982915400010"),
    fact("naf_code", "96.09Z"),
    fact("legal_name", "LE CERCLE D'OR TATTOO STUDIO"),
    fact("administrative_status", "A"),
    fact("employee_bracket", "NN"),
    fact("headquarters_address", "55 BOULEVARD DE LA LIBERTE 59800 LILLE"),
    fact("postal_code", "59800"),
    fact("city", "LILLE"),
    fact("google_cid", "15973388776108040189"),
    fact("google_phone_number", "03 20 86 95 44"),
    fact("google_website_url", "https://example.test/"),
    fact("operational_status", "OPERATIONAL"),
    fact("instagram_url", "https://www.instagram.com/x/"),
    fact("outdated_copyright_year", 2006),
    fact("establishment_count", 4),
    fact("employee_count", 5),
    fact("google_review_count", 751),
    fact("google_rating", 4.9),
    fact("place_category", "Tatoueur"),
    // Everything measured or read on a web page.
    fact("has_website", true),
    fact("third_party_presence_only", false),
    fact("is_redirected_to_social", true),
    fact("website_reachable", false),
    fact("lcp_seconds", 14.51),
    fact("fcp_seconds", 3.72),
    fact("mobile_pagespeed_score", 41),
    fact("mobile_friendly", false),
    fact("is_copyright_outdated", true),
    fact("has_booking_widget", false),
    fact("booking_provider", "custom_booking_link"),
    fact("cms_detected", true),
    fact("cms_name", "Squarespace"),
    fact("tech_stack", ["Squarespace"]),
    fact("ssl_active", true),
    fact("ecommerce_signals", ["cart_ui_detected"]),
    fact("ecommerce_platform", "WooCommerce"),
    fact("has_cart_button", true),
    fact("has_online_ordering", true),
    fact("has_viewport_meta", true),
    fact("has_legacy_layout_tables", false),
    fact("has_social_presence", true),
    fact("outdated_technical_signals", ["x"]),
    fact("third_party_platform", "mappy.com")
  ];
  const company = { name: "Le Cercle d'Or", city: "Lille", employeeCount: 5, establishmentCount: 4, industry: "Tatoueur" };
  const facts = conversationFacts(extractPersonalizationFacts(evidence as never, company));
  const keys = facts.map((item) => item.key);

  it("hands the model their reputation and their trade, and nothing else of this record", () => {
    expect([...keys].sort()).toEqual(["google_rating", "google_review_count", "industry", "place_category"]);
  });

  it("words them as a person would quote them: a decimal comma, the rating with its number of reviews", () => {
    const label = (key: string) => facts.find((item) => item.key === key)?.label ?? "";
    expect(label("google_rating")).toBe("Note moyenne Google Places : 4,9/5 (sur 751 avis)");
    expect(label("google_review_count")).toBe("751 avis clients sur Google");
  });

  it("caps the list", () => {
    expect(conversationFacts(extractPersonalizationFacts(evidence as never, company), 2)).toHaveLength(2);
  });
});

describe("the figure check's rounding boundary", () => {
  it("accepts a verified decimal quoted to one decimal, the half included, and no other rounding", () => {
    for (const seconds of [14.51, 10.01, 30.15, 30.05, 6.649]) {
      const quoted = seconds.toFixed(1).replace(".", ",");
      const known = knownFigures([{ key: "lcp_seconds", value: seconds, confidence: 90 }], {});
      expect(unverifiedFigures(`Cela prend ${quoted} secondes.`, known), String(seconds)).toEqual([]);
    }
    const known = knownFigures([{ key: "lcp_seconds", value: 14.51, confidence: 90 }], {});
    expect(unverifiedFigures("Cela prend 15 secondes.", known)).toEqual(["15"]);
    expect(unverifiedFigures("Cela prend 14,7 secondes.", known)).toEqual(["14.7"]);
  });
});
