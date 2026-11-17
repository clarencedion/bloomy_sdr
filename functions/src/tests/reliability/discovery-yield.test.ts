import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const base = cwd.endsWith("/functions") ? cwd : join(cwd, "functions");
const source = readFileSync(join(base, "src/services/run-discovery-campaign.ts"), "utf8");

/**
 * Discovery kept reporting "completed" while creating nothing. Three separate
 * causes, all measured on the live campaign.
 */

describe("Nothing is paid for before it is filtered", () => {
  it("runs the free checks before website resolution", () => {
    // Website resolution calls Pappers. It used to run on every candidate ahead
    // of every filter, and the filters then rejected essentially all of them:
    // 0 of 25 on a live page of registry results.
    const filterAt = source.indexOf("describeCheapRejections(company, campaign)");
    const resolveAt = source.indexOf("resolveCompanyWebsite(");
    expect(filterAt).toBeGreaterThan(0);
    expect(filterAt).toBeLessThan(resolveAt);
  });

  it("does not use the paid registry for small businesses", () => {
    // Same reasoning as the contact waterfall: a registry lookup on a two-chair
    // salon returns nothing the free sources did not already have.
    expect(source).toContain('campaign.targetSegment !== "small_business"');
    expect(source).toContain("paidLookupAllowed ? integrationSecrets.pappersApiKey : undefined");
  });

  it("leaves the free resolver running when the paid one is skipped", () => {
    expect(source).toContain("serperApiKey: integrationSecrets.serperApiKey");
  });

  it("logs a paid lookup, so it can never be invisible again", () => {
    // The resolver contains no logging and records no spend, which is why a few
    // hundred Pappers calls left no trace anywhere in the app.
    expect(source).toContain("discovery.website.paid_lookup");
  });
});

describe("A registry result is judged on its activity code", () => {
  it("accepts a trade keyword OR a matching NAF code, not both", () => {
    // A sole trader is registered under their own name, so "SOPHIE TRESCA"
    // never contains "tatoueur" however precisely her NAF code says tattooing.
    expect(source).toContain("Matches neither the campaign's trade keywords nor its activity codes");
    expect(source).toContain("!keywordMatch && !nafMatch");
  });

  it("no longer rejects on the keyword alone", () => {
    expect(source).not.toContain("Does not match campaign target keywords.");
  });

  it("checks each reason once, not twice", () => {
    // The city and NAF checks existed in both blocks after the split.
    expect(source.split("is not in target cities").length - 1).toBe(1);
  });
});

describe("Paging restarts when the search area changes", () => {
  it("keys the page cursor to the provider and the area set", () => {
    // The cursor was global while areas rotate three at a time, so by the time
    // the rotation reached a fresh city it asked for page 19 of a city it had
    // never searched — nothing came back, and the campaign went quiet while
    // still reporting "completed".
    expect(source).toContain("`${candidate}:${areaKey}`");
    expect(source).toContain("pageCursors");
  });

  it("no longer advances a single cursor shared by every area", () => {
    expect(source).not.toContain("cursorUpdates.googlePlacesPageCursor =");
    expect(source).not.toContain("cursorUpdates.rechercheEntreprisesPageCursor =");
  });
});
