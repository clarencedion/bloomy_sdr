import { describe, it, expect } from "vitest";
import { detectEcommerceSignals, WebsiteEcommerceProvider } from "../../providers/signals/website-ecommerce-provider.js";
import type { SignalContext } from "../../providers/signals/signal-provider.js";

describe("E-Commerce & Online Ordering Audit (REQ-034)", () => {
  it("detects WooCommerce cart and online ordering from HTML classes", () => {
    const wooSnippet = `
      <div class="woocommerce">
        <ul class="products">
          <li class="product">
            <h2>Bouquet Pastel</h2>
            <span class="woocommerce-Price-amount">35,00 €</span>
            <a href="?add-to-cart=123" class="button add_to_cart_button">Ajouter au panier</a>
          </li>
        </ul>
        <div class="wc-cart">Panier (1)</div>
      </div>
    `;

    const audit = detectEcommerceSignals(wooSnippet);
    expect(audit.hasOnlineOrdering).toBe(true);
    expect(audit.hasCartButton).toBe(true);
    expect(audit.ecommercePlatform).toBe("WooCommerce");
    expect(audit.ecommerceSignals).toContain("engine_woocommerce");
    expect(audit.ecommerceSignals).toContain("cart_ui_detected");
  });

  it("detects Stripe checkout and click & collect keywords", () => {
    const stripeSnippet = `
      <div>
        <h1>Menu du Midi à Emporter</h1>
        <p>Commandez en ligne avec Click & Collect et retirez votre commande en 15 minutes.</p>
        <button id="checkout-button" class="btn-order">Passer commande</button>
        <script src="https://js.stripe.com/v3/"></script>
      </div>
    `;

    const audit = detectEcommerceSignals(stripeSnippet);
    expect(audit.hasOnlineOrdering).toBe(true);
    expect(audit.hasCartButton).toBe(true);
    expect(audit.ecommercePlatform).toBe("Stripe");
    expect(audit.ecommerceSignals).toContain("payment_stripe");
    expect(audit.ecommerceSignals).toContain("ordering_click_and_collect");
  });

  it("flags absence of e-commerce when site is pure showcase/vitrine", () => {
    const vitrineSnippet = `
      <!DOCTYPE html>
      <html>
        <head><title>Cabinet d'Avocats</title></head>
        <body>
          <h1>Conseil Juridique & Contentieux</h1>
          <p>Contactez notre secrétariat au 02 40 00 00 00 pour toute demande de rendez-vous.</p>
        </body>
      </html>
    `;

    const audit = detectEcommerceSignals(vitrineSnippet);
    expect(audit.hasOnlineOrdering).toBe(false);
    expect(audit.hasCartButton).toBe(false);
    expect(audit.ecommercePlatform).toBeNull();
  });

  it("WebsiteEcommerceProvider collects standardized e-commerce evidence items", async () => {
    const provider = new WebsiteEcommerceProvider();
    const shopifySnippet = `
      <html>
        <head>
          <script src="https://cdn.shopify.com/s/files/1/cart.js"></script>
        </head>
        <body>
          <button class="btn add-to-cart">Add to Cart</button>
          <span>Livraison à domicile disponible</span>
        </body>
      </html>
    `;

    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_bloomy",
      company: {
        id: "comp_ecom_1",
        name: "Boutique Artisanale",
        website: "https://boutique-artisanale.fr",
        rawProviderData: {
          html: shopifySnippet
        }
      }
    };

    const result = await provider.collect(context);
    expect(result.error).toBeUndefined();
    expect(result.providerId).toBe("website_ecommerce");

    const evidenceMap = new Map(result.evidence.map((e) => [e.key, e]));

    expect(evidenceMap.get("has_online_ordering")?.value).toBe(true);
    expect(evidenceMap.get("has_online_ordering")?.nature).toBe("fact");
    expect(evidenceMap.get("has_cart_button")?.value).toBe(true);
    expect(evidenceMap.get("ecommerce_platform")?.value).toBe("Shopify");
    expect(evidenceMap.get("ecommerce_platform")?.nature).toBe("fact");
    expect(evidenceMap.get("ecommerce_signals")?.nature).toBe("derived_metric");
  });
});
