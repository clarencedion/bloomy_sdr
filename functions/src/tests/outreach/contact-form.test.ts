import { describe, it, expect } from "vitest";
import { parseForm, detectContactForm } from "../../services/contact-form-detector.js";
import { buildPayload } from "../../services/contact-form-outreach.js";
import { channelEnabled, resolveChannels } from "../../services/target-segment.js";

/**
 * The contact-form channel is only defensible because of what it refuses to do.
 * These tests pin the refusals, not the happy path: a CAPTCHA is never worked
 * around, a honeypot is never filled, and a form we cannot read is never
 * guessed at. Every case runs offline against fixture HTML.
 */

const SIMPLE_FORM = `
<html><body>
  <form action="/wp-admin/admin-post.php" method="post">
    <input type="text" name="votre-nom" required />
    <input type="email" name="votre-email" required />
    <input type="text" name="objet" />
    <textarea name="votre-message" required></textarea>
    <input type="hidden" name="_wpnonce" value="a1b2c3" />
    <button type="submit">Envoyer</button>
  </form>
</body></html>`;

describe("Contact form detection", () => {
  it("reads a plain HTML form and resolves its action against the page", () => {
    const form = parseForm(SIMPLE_FORM, "https://salon-exemple.fr/contact");

    expect(form?.channel).toBe("submittable");
    expect(form?.method).toBe("POST");
    expect(form?.action).toBe("https://salon-exemple.fr/wp-admin/admin-post.php");

    const roles = Object.fromEntries((form?.fields ?? []).map((f) => [f.name, f.role]));
    expect(roles["votre-nom"]).toBe("name");
    expect(roles["votre-email"]).toBe("email");
    expect(roles["objet"]).toBe("subject");
    expect(roles["votre-message"]).toBe("message");
    expect(roles["_wpnonce"]).toBe("hidden");
  });

  it("ignores forms that cannot carry a message, like a search box", () => {
    const html = `<form action="/search"><input type="text" name="q" /></form>`;
    expect(parseForm(html, "https://salon-exemple.fr/")).toBeNull();
  });

  it("classifies a field hidden by inline style as a trap, not a control", () => {
    const html = SIMPLE_FORM.replace(
      '<input type="hidden" name="_wpnonce" value="a1b2c3" />',
      '<input type="text" name="nom_complet" style="display:none" />'
    );
    const form = parseForm(html, "https://salon-exemple.fr/contact");
    const trap = form?.fields?.find((f) => f.name === "nom_complet");

    // Named like a real field, so only the styling reveals it.
    expect(trap?.role).toBe("hidden");
  });

  it("returns none without a network call when there is no usable website", async () => {
    await expect(detectContactForm(undefined)).resolves.toMatchObject({ channel: "none" });
    await expect(detectContactForm("not a url")).resolves.toMatchObject({ channel: "none" });
  });
});

describe("Contact form payload", () => {
  const message = {
    name: "Clarence Dion",
    email: "clarence@bloomy.fr",
    subject: "Votre site",
    body: "Bonjour, j'ai regardé votre salon..."
  };

  it("fills the visible fields with our real identity", () => {
    const form = parseForm(SIMPLE_FORM, "https://salon-exemple.fr/contact")!;
    const payload = buildPayload(form, message);

    expect(payload.get("votre-nom")).toBe(message.name);
    expect(payload.get("votre-email")).toBe(message.email);
    expect(payload.get("objet")).toBe(message.subject);
    expect(payload.get("votre-message")).toBe(message.body);
  });

  it("echoes a framework token but leaves a honeypot empty", () => {
    const html = SIMPLE_FORM.replace(
      '<button type="submit">Envoyer</button>',
      '<input type="hidden" name="bot-field" /><button type="submit">Envoyer</button>'
    );
    const form = parseForm(html, "https://salon-exemple.fr/contact")!;
    const payload = buildPayload(form, message);

    // A hidden field carrying a value is a CSRF/nonce token the form needs back.
    expect(payload.get("_wpnonce")).toBe("a1b2c3");
    // A hidden field with no value exists to catch bots that fill everything.
    expect(payload.has("bot-field")).toBe(false);
  });

  it("never invents a value for an unrecognised field", () => {
    const html = SIMPLE_FORM.replace(
      '<input type="text" name="objet" />',
      '<input type="text" name="numero_client" />'
    );
    const form = parseForm(html, "https://salon-exemple.fr/contact")!;
    const payload = buildPayload(form, message);

    expect(payload.has("numero_client")).toBe(false);
  });

  it("ticks a consent checkbox with the value the form declares", () => {
    const html = SIMPLE_FORM.replace(
      '<input type="text" name="objet" />',
      '<input type="checkbox" name="accept_rgpd" value="oui" required />'
    );
    const form = parseForm(html, "https://salon-exemple.fr/contact")!;
    const payload = buildPayload(form, message);

    expect(payload.get("accept_rgpd")).toBe("oui");
  });
});

describe("Channel selection", () => {
  it("keeps email on whatever else the campaign asks for", () => {
    expect(resolveChannels(["contact_form"])).toEqual(["email", "contact_form"]);
    expect(resolveChannels(undefined)).toEqual(["email"]);
  });

  it("does not enable the form channel unless the campaign asked for it", () => {
    expect(channelEnabled(undefined, "contact_form")).toBe(false);
    expect(channelEnabled(["email"], "contact_form")).toBe(false);
    expect(channelEnabled(["email", "contact_form"], "contact_form")).toBe(true);
  });

  it("discards channel names it does not recognise", () => {
    expect(resolveChannels(["email", "sms", "carrier_pigeon"])).toEqual(["email"]);
  });
});
