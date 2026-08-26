import { describe, it, expect } from "vitest";
import {
  detectBookingWidget,
  detectOutdatedTechnicalSignals,
  WebsiteTechnicalProvider
} from "../../providers/signals/website-technical-provider.js";
import type { SignalContext } from "../../providers/signals/signal-provider.js";

describe("Outdated Signals, Booking Widgets & SSL Audit (REQ-030, REQ-032, REQ-035, REQ-036)", () => {
  it("detects outdated copyright year and legacy layout tables (REQ-036)", () => {
    const legacySnippet = `
      <html>
        <head>
          <!-- Missing viewport tag -->
          <title>Ancien Garage Automobile</title>
        </head>
        <body bgcolor="#FFFFFF">
          <table width="100%" border="0" cellpadding="5" cellspacing="0">
            <tr>
              <td>Bienvenue sur notre site web</td>
            </tr>
          </table>
          <div>
            <p>Copyright © 2017 Garage Dupont. Tous droits réservés.</p>
          </div>
        </body>
      </html>
    `;

    const signals = detectOutdatedTechnicalSignals(legacySnippet, 2026);
    expect(signals.copyrightYear).toBe(2017);
    expect(signals.isCopyrightOutdated).toBe(true);
    expect(signals.hasLegacyLayoutTables).toBe(true);
    expect(signals.outdatedSignals).toContain("outdated_copyright_2017");
    expect(signals.outdatedSignals).toContain("legacy_layout_tables");
    expect(signals.outdatedSignals).toContain("missing_viewport_meta");
  });

  it("does not flag recent copyright years (e.g. 2025/2026)", () => {
    const modernSnippet = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
          <header><h1>Modern Studio</h1></header>
          <main><p>Contenu moderne</p></main>
          <footer><p>© 2026 Modern Studio Nantes</p></footer>
        </body>
      </html>
    `;

    const signals = detectOutdatedTechnicalSignals(modernSnippet, 2026);
    expect(signals.copyrightYear).toBe(2026);
    expect(signals.isCopyrightOutdated).toBe(false);
    expect(signals.hasLegacyLayoutTables).toBe(false);
    expect(signals.outdatedSignals).toEqual([]);
  });

  it("detects booking widgets (Planity, Doctolib, Calendly, TheFork) (REQ-035)", () => {
    const planitySnippet = `<html><body><script src="https://widget.planity.com/widget.js"></script></body></html>`;
    const planityResult = detectBookingWidget(planitySnippet);
    expect(planityResult.hasBooking).toBe(true);
    expect(planityResult.provider).toBe("Planity");

    const doctolibSnippet = `<html><body><a href="https://www.doctolib.fr/dentiste/nantes/dr-martin">Prendre RDV</a></body></html>`;
    const doctolibResult = detectBookingWidget(doctolibSnippet);
    expect(doctolibResult.hasBooking).toBe(true);
    expect(doctolibResult.provider).toBe("Doctolib");

    const theforkSnippet = `<html><body><iframe src="https://module.lafourchette.com/fr_FR/module/123-456"></iframe></body></html>`;
    const theforkResult = detectBookingWidget(theforkSnippet);
    expect(theforkResult.hasBooking).toBe(true);
    expect(theforkResult.provider).toBe("TheFork");
  });

  it("handles companies with no website at all (REQ-030)", async () => {
    const provider = new WebsiteTechnicalProvider();
    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_bloomy",
      company: {
        id: "comp_no_web",
        name: "Plombier Sans Site"
      }
    };

    const result = await provider.collect(context);
    expect(result.providerId).toBe("website_technical");
    expect(result.evidence.length).toBe(1);
    expect(result.evidence[0].key).toBe("has_website");
    expect(result.evidence[0].value).toBe(false);
    expect(result.evidence[0].nature).toBe("fact");
  });

  it("detects social media redirects (REQ-030)", async () => {
    const provider = new WebsiteTechnicalProvider();
    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_bloomy",
      company: {
        id: "comp_social_redirect",
        name: "Boutique Facebook Only",
        website: "https://boutique-fb.fr",
        rawProviderData: {
          html: "<html><body>Redirecting to Facebook...</body></html>",
          finalUrl: "https://www.facebook.com/boutique.artisanale",
          sslActive: true
        }
      }
    };

    const result = await provider.collect(context);
    const evidenceMap = new Map(result.evidence.map((e) => [e.key, e]));

    expect(evidenceMap.get("is_redirected_to_social")?.value).toBe(true);
    expect(evidenceMap.get("is_redirected_to_social")?.nature).toBe("fact");
    expect(evidenceMap.get("final_website_url")?.value).toBe("https://www.facebook.com/boutique.artisanale");
  });
});
