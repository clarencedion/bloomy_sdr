import { describe, it, expect } from "vitest";
import { detectCMS, WebsiteTechnicalProvider } from "../../providers/signals/website-technical-provider.js";
import type { SignalContext } from "../../providers/signals/signal-provider.js";

describe("CMS & Technology Detection (REQ-033)", () => {
  it("detects WordPress from wp-content, wp-includes, and generator tags", () => {
    const wpSnippet = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="generator" content="WordPress 6.4.2" />
          <link rel="stylesheet" href="/wp-content/themes/artisan/style.css" />
          <script src="/wp-includes/js/jquery/jquery.min.js"></script>
        </head>
        <body>
          <h1>Bienvenue chez notre studio</h1>
        </body>
      </html>
    `;

    const result = detectCMS(wpSnippet);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("WordPress");
    expect(result.tech).toContain("WordPress");
    expect(result.tech).toContain("jQuery");
  });

  it("detects Wix from wixstatic.com and parastorage assets", () => {
    const wixSnippet = `
      <!DOCTYPE html>
      <html>
        <head>
          <script src="https://static.parastorage.com/services/wix-thunderbolt/dist/main.js"></script>
          <link rel="stylesheet" href="https://static.wixstatic.com/media/2312_abc.css" />
        </head>
        <body>
          <div id="SITE_CONTAINER">Wix Site Content</div>
        </body>
      </html>
    `;

    const result = detectCMS(wixSnippet);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Wix");
    expect(result.tech).toContain("Wix");
  });

  it("detects Shopify from cdn.shopify.com and shopify.theme", () => {
    const shopifySnippet = `
      <!DOCTYPE html>
      <html>
        <head>
          <script>window.Shopify = { theme: { name: "Dawn" } };</script>
          <link rel="stylesheet" href="https://cdn.shopify.com/s/files/1/theme.css" />
        </head>
        <body>
          <div class="shopify-section">Products</div>
        </body>
      </html>
    `;

    const result = detectCMS(shopifySnippet);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("Shopify");
    expect(result.tech).toContain("Shopify");
  });

  it("detects PrestaShop from theme paths and prestashop variables", () => {
    const prestashopSnippet = `
      <!DOCTYPE html>
      <html>
        <head>
          <script>var prestashop = { version: "8.1.0" };</script>
          <link rel="stylesheet" href="/themes/prestashop/assets/css/theme.css" />
        </head>
        <body>
          <div id="wrapper">Boutique en ligne</div>
        </body>
      </html>
    `;

    const result = detectCMS(prestashopSnippet);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("PrestaShop");
    expect(result.tech).toContain("PrestaShop");
  });

  it("detects Squarespace and Webflow from platform asset domains", () => {
    const sqsSnippet = `<html><head><script src="https://static1.squarespace.com/static/site.js"></script></head><body>Squarespace</body></html>`;
    const sqsResult = detectCMS(sqsSnippet);
    expect(sqsResult.name).toBe("Squarespace");

    const wfSnippet = `<html><head><script src="https://assets.webflow.com/600/js/webflow.js"></script></head><body data-wf-page="123">Webflow</body></html>`;
    const wfResult = detectCMS(wfSnippet);
    expect(wfResult.name).toBe("Webflow");
  });

  it("classifies custom or unknown sites when no CMS signature is present", () => {
    const customSnippet = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Cabinet Dentaire Moderne</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
          <header>Bienvenue</header>
        </body>
      </html>
    `;

    const result = detectCMS(customSnippet);
    expect(result.detected).toBe(false);
    expect(result.name).toBe("custom_or_unknown");
  });

  it("WebsiteTechnicalProvider emits verified CMS facts and tech stack", async () => {
    const provider = new WebsiteTechnicalProvider();
    const wpSnippet = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="generator" content="WordPress 6.4" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <link rel="stylesheet" href="/wp-content/themes/custom/style.css" />
          <script src="https://www.googletagmanager.com/gtag/js?id=UA-123"></script>
        </head>
        <body>
          <header><h1>Fleuriste Nantes</h1></header>
          <main><p>Nos bouquets artisanaux</p></main>
          <footer><p>© 2025 Fleuriste Nantes. Tous droits réservés.</p></footer>
        </body>
      </html>
    `;

    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_bloomy",
      company: {
        id: "comp_wp_1",
        name: "Fleuriste Nantes",
        website: "https://fleuriste-nantes.fr",
        rawProviderData: {
          html: wpSnippet,
          sslActive: true
        }
      }
    };

    const result = await provider.collect(context);
    expect(result.error).toBeUndefined();
    expect(result.providerId).toBe("website_technical");

    const evidenceMap = new Map(result.evidence.map((e) => [e.key, e]));

    expect(evidenceMap.get("cms_detected")?.value).toBe(true);
    expect(evidenceMap.get("cms_detected")?.nature).toBe("fact");
    expect(evidenceMap.get("cms_name")?.value).toBe("WordPress");
    expect(evidenceMap.get("cms_name")?.nature).toBe("fact");
    expect(evidenceMap.get("has_viewport_meta")?.value).toBe(true);
    expect(evidenceMap.get("mobile_friendly")?.value).toBe(true);
    expect(evidenceMap.get("ssl_active")?.value).toBe(true);
  });
});
