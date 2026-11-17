import { describe, it, expect } from "vitest";
import { isPlatformHandle, siteIdentity, socialProfileTrust } from "../../services/social/profile-trust.js";

// Cases taken from the 139 live DM drafts audited on 2026-11-10.
const trust = (handle: string, name: string, website?: string, source: "scraped" | "listing" = "scraped") =>
  socialProfileTrust({ handle }, { name, website }, source);

describe("socialProfileTrust — platform and directory accounts are never the prospect", () => {
  it.each([
    ["teamfresha", "Le Milieu Mike Leboucher & Associés", "https://www.fresha.com/a/le-milieu"],
    ["fresha", "Kro Tatoo", "https://www.fresha.com/a/kro"],
    ["kipik.ink", "Cerbère Tattoo", "https://kipik.ink/cerbere"],
    ["mappyofficiel", "Bleu Macadam", "https://fr.mappy.com/poi/123"],
    ["flickr", "Inky Dinky Tatoueur Lyon", "https://www.flickr.com/photos/x"],
    ["inkinmag", "Badabing Tattoo Shop", "https://inkin.fr/salon/badabing"],
    ["wixfrancais", "Laurie Gavaudan dermopigmentiste Marseille", "https://www.lauriegavaudan.com"],
    ["sortiraparis.officiel", "La Petite Manis", "https://www.sortiraparis.com/x"],
    ["starofservice", "Urban Colour Tattoo", "https://www.starofservice.com/x"]
  ])("rejects @%s for %s", (handle, name, website) => {
    expect(trust(handle, name, website).trust).toBe("rejected");
  });

  it("rejects a profile found on a directory page, even an unknown account", () => {
    expect(trust("eliot.kohek", "Proib'ink - Salon de tatouage à Tours", "https://www.tattoocityguide.com/proibink")).toEqual({
      trust: "rejected",
      reason: "found_on_a_directory"
    });
    expect(trust("id:100073250740217", "June tattoo", "https://book-ink.co/june").trust).toBe("rejected");
  });

  it("rejects a platform account even when the listing names it", () => {
    expect(trust("teamfresha", "Kro Tatoo", undefined, "listing").trust).toBe("rejected");
  });
});

describe("socialProfileTrust — the prospect's own accounts are kept", () => {
  it.each([
    ["mike_leboucher", "Le Milieu Mike Leboucher & Associés (tatoueur / tatouage / Toulouse / tattoo)", "https://www.fresha.com/a/x"],
    ["baca.ttt", "Baca Store", "https://www.fresha.com/a/baca"],
    ["lyon_tattoo_shop", "LYON TATTOO SHOP", "https://www.fresha.com/a/lyon-tattoo-shop"],
    ["lachapelletattoo", "La Chapelle Tattoo Shop", "https://lachapelletattoo.com"],
    ["anna_theface", "The FACE by Anna | Maquillage permanent | Détatouage", "https://theface.fr"],
    ["opale_sasori", "Opale Sasori Tattoo", "https://kipik.ink/opale"],
    ["nea.marseille", "Nea studio", "https://nea-studio.fr"],
    ["tattoo_shop_18", "TATTOO SHOP 18", "https://nice-tattoo.fr"]
  ])("trusts @%s for %s (its name)", (handle, name, website) => {
    expect(trust(handle, name, website)).toEqual({ trust: "trusted", reason: "matches_name" });
  });

  it.each([
    ["studio54_tattooshop", "Studio 54 Nantes", "https://studio54shop.com"],
    ["id:149247375133783", "Studio 54 Nantes", "https://studio54shop.com"],
    ["id:100063536505177", "Tit For Tat - Tattoo Parlor", "https://titfortat-tattooparlor.fr"],
    ["id:847556035308522", "Boulangerie Utopie", "https://boulangerieutopie.com"]
  ])("trusts @%s for %s (found on its own site)", (handle, name, website) => {
    expect(trust(handle, name, website).trust).toBe("trusted");
  });

  it("trusts a profile the company listing names directly (its only web presence)", () => {
    expect(trust("lessalesgosses.tatouage", "Les Sales Gosses Tatouage", undefined, "listing")).toEqual({ trust: "trusted", reason: "named_by_listing" });
  });
});

describe("socialProfileTrust — uncertain is not used", () => {
  it.each([
    ["familin.paris", "Les Petits Mitrons", "https://familinparis.fr", "site_not_the_company"],
    ["laurettetheatre", "Les Fleurs du Mal", "https://laurette-theatre.fr", "site_not_the_company"],
    ["lafrenchtechaixmarseille", "GoTattoo", "https://lafrenchtech-aixmarseille.fr", "site_not_the_company"],
    ["maissa_tattoo", "L'Atelier des Métamorphoses", "https://atelierdesmetamorphoses.com", "not_the_site_account"],
    ["vulpera_", "L'Atelier Tattoo | Tatouage | Lyon 6", "https://lateliertattoo.com", "not_the_site_account"],
    // A name too generic to tell vouches for no site: this listing pointed at a design blog.
    ["commeuncamion", "Studio Art Tattoo", "https://commeuncamion.com", "site_not_the_company"],
    ["laiguille_tattoo", "Salon De Tatouage", "https://laiguille-tattoo.com", "site_not_the_company"],
    ["ernestetvalentin", "Boulangerie Pâtisserie", "https://ernestetvalentin.com", "site_not_the_company"]
  ])("@%s for %s is uncertain (%s)", (handle, name, website, reason) => {
    expect(trust(handle, name, website)).toEqual({ trust: "uncertain", reason });
  });

  it("a scraped profile with no site to vouch for it is uncertain", () => {
    expect(trust("co_a", "Studio co_a")).toEqual({ trust: "uncertain", reason: "no_site" });
  });
});

describe("helpers", () => {
  it("knows platform handles whatever their punctuation", () => {
    expect(isPlatformHandle("Kipik.Ink")).toBe(true);
    expect(isPlatformHandle("team_fresha")).toBe(true);
    expect(isPlatformHandle("mike_leboucher")).toBe(false);
  });

  it("names a site by its registrable domain, or its subdomain on a site builder", () => {
    expect(siteIdentity("https://www.laiguille-tattoo.com/contact")).toEqual({ domain: "laiguille-tattoo.com", name: "laiguille-tattoo" });
    expect(siteIdentity("https://monsalon.wixsite.com/accueil")).toEqual({ domain: "monsalon.wixsite.com", name: "monsalon" });
    expect(siteIdentity("guide.michelin.com/fr/x")).toEqual({ domain: "guide.michelin.com", name: "michelin" });
    expect(siteIdentity("not a url")).toBeUndefined();
  });
});

describe("Invariant 1", () => {
  it("the trust rule names no business of ours", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = fs.existsSync(path.resolve(process.cwd(), "src/services")) ? process.cwd() : path.resolve(process.cwd(), "functions");
    const source = fs.readFileSync(path.join(root, "src/services/social/profile-trust.ts"), "utf8").toLowerCase();
    for (const word of ["bloomy", "devcomm", "biz_"]) expect(source).not.toContain(word);
  });
});

describe("prefersDirectMessages — the campaign's 'prefer direct messages' switch", () => {
  it("is on only when chosen AND DMs are enabled", async () => {
    const { prefersDirectMessages } = await import("../../services/target-segment.js");
    expect(prefersDirectMessages({ preferredChannel: "social_dm", channels: ["email", "social_dm"] })).toBe(true);
    expect(prefersDirectMessages({ preferredChannel: "social_dm", channels: ["email"] })).toBe(false);
    expect(prefersDirectMessages({ preferredChannel: "email", channels: ["email", "social_dm"] })).toBe(false);
    expect(prefersDirectMessages({ channels: ["email", "social_dm"] })).toBe(false);
    expect(prefersDirectMessages(undefined)).toBe(false);
  });
});
