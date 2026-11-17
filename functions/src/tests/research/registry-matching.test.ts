import { describe, it, expect, vi, afterEach } from "vitest";
import * as registry from "../../providers/signals/registry-signal-provider.js";

// Offline: the public API is replaced by a stub that answers per query.
const Provider = Object.values(registry).find((v) => typeof v === "function" && /Provider/.test((v as { name: string }).name)) as new () => {
  collect: (ctx: unknown) => Promise<{ evidence: Array<{ key: string; value: unknown }>; error?: string }>;
};

function stubApi(answer: (params: URLSearchParams) => { status?: number; results: unknown[] }) {
  const calls: URLSearchParams[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const params = new URL(url).searchParams;
    calls.push(params);
    const { status = 200, results } = answer(params);
    return { ok: status === 200, status, json: async () => ({ results }) };
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const ctx = (name: string, postalCode: string, city = "Paris") => ({ workspaceId: "w", businessId: "b", company: { id: "c", name, postalCode, city } });
const siren = (res: { evidence: Array<{ key: string; value: unknown }> }) => res.evidence.find((e) => /siren/.test(e.key))?.value;

describe("registeredNameCandidate", () => {
  it.each([
    ["Maison Python - Tatouage Paris", "Paris", "Maison Python"],
    ["La Bête Humaine Tatouage", "Paris", "La Bête Humaine"],
    ["Barbe à Bidou - Le Marais, Paris 3e - Barbershop", "Paris", "Barbe à Bidou"],
    ["Tattoo 13", "Paris", "Tattoo 13"],
    ["L'Atelier Paris 3e", "Paris", "L'Atelier"],
    ["Studio", "Paris", "Studio"]
  ])("%s → %s", (display, city, expected) => {
    expect(registry.registeredNameCandidate(display, city)).toBe(expected);
  });
});

describe("registry lookup for a listing's display name", () => {
  it("retries with the registered-name candidate in the département and keeps the result at the same postcode carrying the name", async () => {
    const calls = stubApi((params) =>
      params.get("departement")
        ? {
            results: [
              { nom_complet: "LA COMPAGNIE BODY", siren: "111111111", siege: { code_postal: "75010" } },
              { nom_complet: "PIERRE ROMIEU", siren: "449299882", activite_principale: "96.09Z", siege: { code_postal: "75010", liste_enseignes: ["LA BETE HUMAINE"] } }
            ]
          }
        : { results: [] }
    );
    const res = await new Provider().collect(ctx("La Bête Humaine Tatouage", "75010"));
    expect(siren(res)).toBe("449299882");
    expect(calls[1].get("q")).toBe("La Bête Humaine");
    expect(calls[1].get("departement")).toBe("75");
    expect(calls[1].get("etat_administratif")).toBe("A");
  });

  it("never takes a same-name business at another postcode", async () => {
    stubApi((params) => (params.get("departement") ? { results: [{ nom_complet: "MATIERE NOIRE", siren: "222", siege: { code_postal: "75008" } }] } : { results: [] }));
    const res = await new Provider().collect(ctx("Matière Noire Tattoo - Tatouage Paris 4", "75004"));
    expect(siren(res)).toBeUndefined();
    expect(res.error).toMatch(/No matching company/);
  });

  it("never takes a result that only matched on an address or a director (name not carried)", async () => {
    stubApi((params) => (params.get("departement") ? { results: [{ nom_complet: "SOMEONE ELSE", siren: "333", siege: { code_postal: "31000" } }] } : { results: [] }));
    expect(siren(await new Provider().collect(ctx("La Fumisterie Tattoo Shop", "31000", "Toulouse")))).toBeUndefined();
  });

  it("does not guess with a name too short to tell apart", async () => {
    const calls = stubApi(() => ({ results: [] }));
    await new Provider().collect(ctx("By O' Tattoo", "31000", "Toulouse"));
    expect(calls).toHaveLength(1);
  });

  it("retries once after a 429 (the API allows 7 requests per second)", async () => {
    let first = true;
    const calls = stubApi(() => {
      if (first) {
        first = false;
        return { status: 429, results: [] };
      }
      return { results: [{ nom_complet: "SORRY MOM TATOUAGE", siren: "825370448", siege: { code_postal: "31000" } }] };
    });
    const res = await new Provider().collect(ctx("Sorry Mom", "31000", "Toulouse"));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(siren(res)).toBe("825370448");
  });
});
