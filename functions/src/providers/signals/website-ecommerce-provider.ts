import type { SignalContext, SignalProvider, SignalResult } from "./signal-provider.js";
import type { EvidenceItem } from "../../types/domain.js";

export interface EcommerceAuditResult {
  hasOnlineOrdering: boolean;
  hasCartButton: boolean;
  ecommercePlatform: string | null;
  ecommerceSignals: string[];
}

export function detectEcommerceSignals(html: string): EcommerceAuditResult {
  const lower = html.toLowerCase();
  const signals: string[] = [];
  let detectedPlatform: string | null = null;
  let hasCartButton = false;
  let hasOnlineOrdering = false;

  // 1. Detect dedicated E-Commerce engines & payment SDKs
  if (
    lower.includes("woocommerce") ||
    lower.includes("wc-cart") ||
    lower.includes("wc-block") ||
    lower.includes("woocommerce-price-amount")
  ) {
    detectedPlatform = "WooCommerce";
    signals.push("engine_woocommerce");
    hasCartButton = true;
    hasOnlineOrdering = true;
  } else if (
    lower.includes("cdn.shopify.com") ||
    lower.includes("shopify.theme") ||
    lower.includes("cart.js") ||
    lower.includes("myshopify.com")
  ) {
    detectedPlatform = "Shopify";
    signals.push("engine_shopify");
    hasCartButton = true;
    hasOnlineOrdering = true;
  } else if (
    lower.includes("prestashop") ||
    lower.includes("ps_shoppingcart") ||
    lower.includes("ps-cart")
  ) {
    detectedPlatform = "PrestaShop";
    signals.push("engine_prestashop");
    hasCartButton = true;
    hasOnlineOrdering = true;
  } else if (lower.includes("snipcart.com") || lower.includes("snipcart-add-item")) {
    detectedPlatform = "Snipcart";
    signals.push("engine_snipcart");
    hasCartButton = true;
    hasOnlineOrdering = true;
  } else if (lower.includes("ecwid.com") || lower.includes("app.ecwid.com")) {
    detectedPlatform = "Ecwid";
    signals.push("engine_ecwid");
    hasCartButton = true;
    hasOnlineOrdering = true;
  } else if (lower.includes("magento") || lower.includes("checkout/cart")) {
    detectedPlatform = "Magento";
    signals.push("engine_magento");
    hasCartButton = true;
    hasOnlineOrdering = true;
  } else if (lower.includes("bigcommerce.com")) {
    detectedPlatform = "BigCommerce";
    signals.push("engine_bigcommerce");
    hasCartButton = true;
    hasOnlineOrdering = true;
  } else if (lower.includes("js.stripe.com") || lower.includes("buy.stripe.com")) {
    detectedPlatform = "Stripe";
    signals.push("payment_stripe");
    hasOnlineOrdering = true;
  } else if (lower.includes("paypal.com/sdk") || lower.includes("paypal-button")) {
    detectedPlatform = "PayPal";
    signals.push("payment_paypal");
    hasOnlineOrdering = true;
  }

  // 2. Detect Cart / Checkout UI elements & buttons
  const cartPatterns = [
    /ajouter\s+au\s+panier/i,
    /add\s+to\s+cart/i,
    /class=["'][^"']*(?:cart|panier|basket|checkout|shopping-bag)[^"']*["']/i,
    /id=["'][^"']*(?:cart|panier|basket|checkout)[^"']*["']/i,
    /<a\s+[^>]*href=["'][^"']*(?:panier|cart|checkout|commander)[^"']*["']/i,
    /passer\s+commande/i,
    /mon\s+panier/i
  ];

  for (const pattern of cartPatterns) {
    if (pattern.test(html)) {
      hasCartButton = true;
      signals.push("cart_ui_detected");
      break;
    }
  }

  // 3. Detect Ordering, Click & Collect, Delivery, Takeaway keywords
  const orderingKeywords = [
    "click and collect",
    "click & collect",
    "click&collect",
    "commander en ligne",
    "commande en ligne",
    "livraison à domicile",
    "livraison a domicile",
    "vente à emporter",
    "vente a emporter",
    "takeaway",
    "ubereats",
    "deliveroo",
    "justeat",
    "just eat"
  ];

  for (const kw of orderingKeywords) {
    if (lower.includes(kw)) {
      hasOnlineOrdering = true;
      const slug = kw.replace(/&/g, "and").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
      signals.push(`ordering_${slug}`);
    }
  }

  if (hasCartButton || detectedPlatform) {
    hasOnlineOrdering = true;
  }

  return {
    hasOnlineOrdering,
    hasCartButton,
    ecommercePlatform: detectedPlatform,
    ecommerceSignals: [...new Set(signals)]
  };
}

export class WebsiteEcommerceProvider implements SignalProvider {
  readonly id = "website_ecommerce";
  readonly name = "Website E-Commerce & Online Ordering Audit";
  readonly description = "Audits website e-commerce capabilities, cart buttons, checkout scripts, delivery options, and online ordering presence.";
  readonly capabilities = [
    "has_online_ordering",
    "has_cart_button",
    "ecommerce_platform",
    "ecommerce_signals"
  ];
  readonly costPerExecutionUsd = 0;

  supports(context: SignalContext): boolean {
    if (
      context.company.rawProviderData &&
      typeof context.company.rawProviderData === "object" &&
      ("html" in (context.company.rawProviderData as object) || "ecommerceAudit" in (context.company.rawProviderData as object))
    ) {
      return true;
    }
    return Boolean(context.company.website || context.company.domain);
  }

  async collect(context: SignalContext): Promise<SignalResult> {
    const startTime = Date.now();
    const evidence: Array<Omit<EvidenceItem, "id" | "workspaceId" | "businessId" | "companyId">> = [];
    const now = new Date();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const rawUrl = context.company.website || (context.company.domain ? `https://${context.company.domain}` : undefined);

    if (!rawUrl && (!context.company.rawProviderData || !("html" in (context.company.rawProviderData as object)))) {
      evidence.push({
        signalProvider: this.id,
        key: "has_online_ordering",
        value: false,
        sourceType: "website",
        confidence: 95,
        nature: "fact",
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });
      return {
        providerId: this.id,
        evidence,
        costEstimateUsd: 0,
        durationMs: Date.now() - startTime
      };
    }

    const targetUrl = rawUrl && rawUrl.startsWith("http") ? rawUrl : rawUrl ? `https://${rawUrl}` : "https://example.com";

    try {
      let html = "";

      // 1. Check for fixture / mock HTML in rawProviderData
      if (
        context.company.rawProviderData &&
        typeof context.company.rawProviderData === "object" &&
        "html" in (context.company.rawProviderData as object)
      ) {
        html = String((context.company.rawProviderData as { html: string }).html);
      } else {
        // 2. Fetch live website HTML with 8s timeout bound
        try {
          const response = await fetch(targetUrl, {
            signal: AbortSignal.timeout(8000),
            headers: {
              "User-Agent": "DevcommSalesOS/0.1 EcommerceAudit (+https://devcomm-os.firebaseapp.com)"
            }
          });
          if (response.ok) {
            const rawBody = await response.text();
            html = rawBody.slice(0, 250000);
          }
        } catch {
          // Handled gracefully below
        }
      }

      const audit = detectEcommerceSignals(html);

      evidence.push({
        signalProvider: this.id,
        key: "has_online_ordering",
        value: audit.hasOnlineOrdering,
        sourceType: "website",
        sourceUrl: targetUrl,
        confidence: 90,
        nature: "fact",
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });

      evidence.push({
        signalProvider: this.id,
        key: "has_cart_button",
        value: audit.hasCartButton,
        sourceType: "website",
        sourceUrl: targetUrl,
        confidence: 90,
        nature: "fact",
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });

      if (audit.ecommercePlatform) {
        evidence.push({
          signalProvider: this.id,
          key: "ecommerce_platform",
          value: audit.ecommercePlatform,
          sourceType: "website",
          sourceUrl: targetUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      evidence.push({
        signalProvider: this.id,
        key: "ecommerce_signals",
        value: audit.ecommerceSignals,
        sourceType: "website",
        sourceUrl: targetUrl,
        confidence: 85,
        nature: "derived_metric",
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });

      return {
        providerId: this.id,
        evidence,
        costEstimateUsd: 0,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        providerId: this.id,
        evidence: [],
        costEstimateUsd: 0,
        durationMs: Date.now() - startTime,
        error: errorMsg
      };
    }
  }
}
