import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pickInstagramFromSearch } from "../../services/social/profile-search.js";

// Search results recorded live on 2026-11-11 (titles and snippets shortened).
describe("pickInstagramFromSearch — the prospect's own account, confirmed by place", () => {
  it("takes the profile whose handle matches the name and whose result names the city", () => {
    const found = pickInstagramFromSearch(
      [
        { link: "https://www.instagram.com/lessalesgosses.tatouage/", title: "Les Sales Gosses (@lessalesgosses.tatouage) · Montpellier", snippet: "Les Sales Gosses. 6,497 followers." },
        { link: "https://www.instagram.com/calypso_tt/", title: "Calypso (@calypso_tt)", snippet: "Les Sales Gosses, on ne fait pas les choses à moitié." }
      ],
      { name: "Les Sales Gosses Tatouage", city: "Montpellier", postalCode: "34000" }
    );
    expect(found).toEqual({ url: "https://www.instagram.com/lessalesgosses.tatouage/", handle: "lessalesgosses.tatouage", confirmedBy: "city" });
  });

  it("never takes the same name in another town", () => {
    const results = [
      { link: "https://www.instagram.com/barber_avenue_73/", title: "Barber Avenue 73 (@barber_avenue_73) · Aix-les-Bains", snippet: "Ton Barber reste ouvert ce vendredi." },
      { link: "https://www.instagram.com/barber_avenue_paris/", title: "BARBER AVENUE PARIS (@barber_avenue_paris)", snippet: "170 avenue d'Italie 75013 paris MARDI AU DIMANCHE" }
    ];
    const found = pickInstagramFromSearch(results, { name: "Barber Avenue Paris", city: "Paris", postalCode: "75013" });
    expect(found?.handle).toBe("barber_avenue_paris");
    expect(pickInstagramFromSearch([results[0]], { name: "Barber Avenue Paris", city: "Paris", postalCode: "75013" })).toBeUndefined();
  });

  it("accepts a result that confirms the place by phone number when it names no city", () => {
    const found = pickInstagramFromSearch(
      [{ link: "https://www.instagram.com/lecercledor_studio/", title: "Le Cercle d'Or (@lecercledor_studio)", snippet: "Tattoo & Piercing Shop. ☎️: 0320869544. Tattoo :@ygrektattoo" }],
      { name: "Le Cercle d'Or - Lille", city: "Lille", postalCode: "59800", phones: ["03 20 86 95 44"] }
    );
    expect(found).toMatchObject({ handle: "lecercledor_studio", confirmedBy: "phone" });
  });

  it("with the city alone, one shared word is not enough: the handle must carry the whole name", () => {
    // Live, 2026-11-11: a Paris sneaker customiser was taken for "Kustom Tattoo".
    const shoes = { link: "https://www.instagram.com/kustomtashoes/", title: "Kustom Ta Shoes (@kustomtashoes) · Paris", snippet: "Custom de sneakers à Paris." };
    expect(pickInstagramFromSearch([shoes], { name: "Kustom Tattoo", city: "Paris", postalCode: "75011" })).toBeUndefined();
    // The same weak confirmation is fine when the handle is the business's name.
    expect(
      pickInstagramFromSearch(
        [{ link: "https://www.instagram.com/sashatattooingparis/", title: "Sasha (@sashatattooingparis) · Paris", snippet: "Tattoo artist." }],
        { name: "Sashatattooing Paris", city: "Paris", postalCode: "75004" }
      )?.handle
    ).toBe("sashatattooingparis");
    // A postcode or phone match needs no more than the name match.
    expect(
      pickInstagramFromSearch(
        [{ link: "https://www.instagram.com/lalogebarbier34/", title: "La Loge (@lalogebarbier34)", snippet: "Barbier, 12 rue X 34000 Montpellier" }],
        { name: "Barber Shop Montpellier La Loge", city: "Montpellier", postalCode: "34000" }
      )?.confirmedBy
    ).toBe("postcode");
  });

  it("carriesWholeName: the rest of the handle may only be trade words, the city or digits", async () => {
    const { carriesWholeName } = await import("../../services/social/profile-search.js");
    for (const [handle, name, city] of [
      ["sashatattooingparis", "Sashatattooing Paris", "Paris"],
      ["andp_barbier_toulouse", "ANDP Barbier Toulouse", "Toulouse"],
      ["freakyfamily", "Freaky Family Tattoo - Piercing", "Montpellier"],
      ["nouvelhairlhommelille", "Nouvel Hair L'Homme Lille - Coiffeur & Barbier", "Lille"],
      ["amalgametattooshop", "Amalgame Tattoo Shop", "Lille"],
      ["lessalesgosses.tatouage", "Les Sales Gosses Tatouage", "Montpellier"]
    ]) {
      expect(carriesWholeName(handle, name, city), handle).toBe(true);
    }
    expect(carriesWholeName("kustomtashoes", "Kustom Tattoo", "Paris")).toBe(false);
    expect(carriesWholeName("barber_avenue_73", "Barber Avenue Paris", "Paris")).toBe(true); // the place check, not this one, tells towns apart
  });

  it("without any confirmation of the place, a matching handle is not enough", () => {
    expect(
      pickInstagramFromSearch(
        [{ link: "https://www.instagram.com/lecercledor_studio/", title: "Le Cercle d'Or (@lecercledor_studio)", snippet: "Tattoo & Piercing Shop." }],
        { name: "Le Cercle d'Or - Lille", city: "Lille", postalCode: "59800" }
      )
    ).toBeUndefined();
  });

  it("ignores posts, reels, artists' accounts and platform accounts", () => {
    expect(
      pickInstagramFromSearch(
        [
          { link: "https://www.instagram.com/p/DfSVVp7EZ_d/", title: "Les Sales Gosses, Montpellier", snippet: "Montpellier" },
          { link: "https://www.instagram.com/reel/DQCRtcxCOo_/", title: "Le Cercle d'Or on Instagram", snippet: "Lille" },
          { link: "https://www.instagram.com/ygrektattoo/", title: "Ygrek - Le Cercle d'Or Studio (@ygrektattoo)", snippet: "Tatoueur LILLE FR" },
          { link: "https://www.instagram.com/fresha/", title: "Fresha (@fresha) · Lille", snippet: "Lille" }
        ],
        { name: "Le Cercle d'Or - Lille", city: "Lille", postalCode: "59800" }
      )
    ).toBeUndefined();
  });

  it("a city name inside another word does not confirm the place", () => {
    expect(
      pickInstagramFromSearch(
        [{ link: "https://www.instagram.com/ateliernoirink/", title: "Atelier Noir Ink (@ateliernoirink) · Nice", snippet: "Un service nicement fait." }],
        { name: "Atelier Noir Ink", city: "Nice", postalCode: "06000" }
      )?.confirmedBy
    ).toBe("city"); // the title says "Nice" as a word
    expect(
      pickInstagramFromSearch(
        [{ link: "https://www.instagram.com/ateliernoirink/", title: "Atelier Noir Ink (@ateliernoirink)", snippet: "Un service nicement fait." }],
        { name: "Atelier Noir Ink", city: "Nice", postalCode: "06000" }
      )
    ).toBeUndefined();
  });
});

describe("the search is wired where a channel is decided, and its result goes through the trust rule", () => {
  const root = fs.existsSync(path.resolve(process.cwd(), "src/services")) ? process.cwd() : path.resolve(process.cwd(), "functions");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it("the resolver reads the searched profile as a scraped one (name must match), with the whole-name rule for a city-only match", () => {
    const resolver = read("src/services/social/social-profile.ts");
    expect(resolver).toContain('{ value: company.searchedInstagramUrl, source: "scraped", searched: true }');
    expect(resolver).toContain("candidate.searched && !searchTiedToPlace && !carriesWholeName(");
  });

  it("the pipeline and the draft task search before deciding there is no channel", () => {
    const queue = read("src/services/task-queue-service.ts");
    expect(queue.split("findInstagramBySearch(companyId)").length - 1).toBe(2);
  });

  it("times out, retries a 429 once, and names no business (Invariant 1)", () => {
    const source = read("src/services/social/profile-search.ts");
    expect(source).toContain("AbortSignal.timeout(SERPER_TIMEOUT_MS)");
    expect(source).toContain("response.status === 429 && attempt === 0");
    for (const word of ["bloomy", "devcomm", "biz_"]) expect(source.toLowerCase()).not.toContain(word);
  });
});
