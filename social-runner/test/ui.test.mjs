import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createUi } from "../src/ui.mjs";

function capture() {
  const out = new PassThrough();
  let written = "";
  out.on("data", (chunk) => (written += chunk));
  return { ui: createUi({ out, color: false }), text: () => written };
}

describe("terminal UI", () => {
  it("never prints control characters from untrusted text", () => {
    const { ui, text } = capture();
    const esc = String.fromCharCode(27);
    ui.message({ text: `Bonjour${esc}[2J${esc}]0;titre${String.fromCharCode(7)}\nà vous`, typed: true, warnings: [`note${esc}[31m`] });
    ui.prospectMessages([`Salut${esc}[1A`]);
    ui.item({ index: 0, total: 1, companyName: `Fleurs${esc}[2K`, network: "instagram", profileUrl: "https://www.instagram.com/x/" });
    expect(text()).not.toContain(esc);
    expect(text()).not.toContain(String.fromCharCode(7));
    expect(text()).toContain("    Bonjour[2J]0;titre\n    à vous");
  });

  it("flags a failed pricing check and commercial terms", () => {
    const { ui, text } = capture();
    ui.message({ text: "Le site est à 0 €.", typed: true, pricingGuardrailPassed: false, mentionsCommercialTerms: true, warnings: [] });
    expect(text()).toMatch(/ATTENTION : contrôle des prix en échec/);
    expect(text()).toMatch(/conditions commerciales/);
  });

  it("says when the composer does not match, and labels keys in French", () => {
    const { ui, text } = capture();
    ui.message({ text: "Bonjour", typed: false });
    ui.keysHint(["e", "s", "q"]);
    expect(text()).toMatch(/ne correspond pas/);
    expect(text()).toMatch(/E = modifier {3}S = passer {3}Q = arrêter/);
    expect(text()).not.toMatch(/Entrée = envoyer/);
  });

  it("copies every line shown to the session log, without colours and without the countdown; a failing log never stops the display", () => {
    const out = new PassThrough();
    let shown = "";
    out.on("data", (chunk) => (shown += chunk));
    const lines = [];
    const ui = createUi({ out, color: true, log: (line) => lines.push(line) });
    ui.ok("Envoyé à Boutique 1.");
    ui.countdown(7);
    ui.countdown(0);
    ui.error("Arrêt.");
    expect(lines).toEqual(["  Envoyé à Boutique 1.", "  Arrêt."]);
    expect(shown).toContain(String.fromCharCode(27));
    expect(shown).toContain("envoi dans 7 s");

    const broken = createUi({ out, color: false, log: () => { throw new Error("disk full"); } });
    expect(() => broken.info("toujours affiché")).not.toThrow();
    expect(shown).toContain("toujours affiché");
  });

  it("explains a blocker without offering to work around it", () => {
    const { ui, text } = capture();
    ui.blocker({ kind: "checkpoint", detail: "challenge" });
    expect(text()).toMatch(/ARRÊT — Vérification de sécurité Meta/);
    expect(text()).toMatch(/ne contourne jamais/);
  });
});
