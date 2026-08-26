import type { SignalContext, SignalProvider, SignalResult } from "./signal-provider.js";
import type { EvidenceItem } from "../../types/domain.js";

/**
 * Third-party platforms a business may list on instead of owning a website.
 * A prospect whose only presence is one of these has no site of their own,
 * which is a need even though the listing page itself looks modern.
 */
const THIRD_PARTY_PRESENCE_DOMAINS = [
  "planity.com",
  "treatwell.fr",
  "treatwell.com",
  "fresha.com",
  "booksy.com",
  "wavy.pro",
  "balinea.com",
  "kiute.fr",
  "flexy.fr",
  "pagesjaunes.fr",
  "google.com",
  "sites.google.com",
  "business.site",
  "wixsite.com"
];

const SOCIAL_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "linktr.ee",
  "youtube.com",
  "pinterest.com"
];

export interface WebsiteAuditResult {
  hasWebsite: boolean;
  websiteReachable: boolean;
  sslActive: boolean;
  isRedirectedToSocial: boolean;
  finalUrl?: string;
  cmsName: string;
  cmsDetected: boolean;
  techStack: string[];
  hasViewportMeta: boolean;
  mobileFriendly: boolean;
  hasBookingWidget: boolean;
  bookingProvider: string | null;
  copyrightYear: number | null;
  isCopyrightOutdated: boolean;
  hasLegacyLayoutTables: boolean;
  outdatedSignals: string[];
}

export function detectCMS(html: string): { name: string; detected: boolean; tech: string[] } {
  const tech: string[] = [];
  const lowerHtml = html.toLowerCase();

  // WordPress detection
  if (
    lowerHtml.includes("/wp-content/") ||
    lowerHtml.includes("/wp-includes/") ||
    lowerHtml.includes('name="generator" content="wordpress') ||
    lowerHtml.includes("wp-json/wp/v2")
  ) {
    tech.push("WordPress");
  }

  // Wix detection
  if (
    lowerHtml.includes("wixstatic.com") ||
    lowerHtml.includes("static.parastorage.com") ||
    lowerHtml.includes("wix-sites.com") ||
    lowerHtml.includes("x-wix-renderer-server")
  ) {
    tech.push("Wix");
  }

  // Shopify detection
  if (
    lowerHtml.includes("cdn.shopify.com") ||
    lowerHtml.includes("shopify.theme") ||
    lowerHtml.includes("myshopify.com") ||
    lowerHtml.includes("shopify-section")
  ) {
    tech.push("Shopify");
  }

  // PrestaShop detection
  if (
    lowerHtml.includes("prestashop") ||
    lowerHtml.includes("/themes/prestashop/") ||
    lowerHtml.includes("var prestashop =")
  ) {
    tech.push("PrestaShop");
  }

  // Squarespace detection
  if (
    lowerHtml.includes("static1.squarespace.com") ||
    lowerHtml.includes("squarespace-config") ||
    lowerHtml.includes("squarespace.com")
  ) {
    tech.push("Squarespace");
  }

  // Webflow detection
  if (
    lowerHtml.includes("assets.webflow.com") ||
    lowerHtml.includes("data-wf-page") ||
    lowerHtml.includes("data-wf-site") ||
    lowerHtml.includes("webflow.require")
  ) {
    tech.push("Webflow");
  }

  // Joomla detection
  if (
    lowerHtml.includes("/media/jui/") ||
    lowerHtml.includes("index.php?option=com_") ||
    lowerHtml.includes('name="generator" content="joomla')
  ) {
    tech.push("Joomla");
  }

  // Drupal detection
  if (
    lowerHtml.includes("drupal.js") ||
    lowerHtml.includes("drupal.settings") ||
    lowerHtml.includes("/sites/all/modules/") ||
    lowerHtml.includes('name="generator" content="drupal')
  ) {
    tech.push("Drupal");
  }

  // Additional libraries & frameworks
  if (lowerHtml.includes("jquery") || lowerHtml.includes("jquery.min.js")) {
    tech.push("jQuery");
  }
  if (lowerHtml.includes("bootstrap") || lowerHtml.includes("bootstrap.min.css")) {
    tech.push("Bootstrap");
  }
  if (lowerHtml.includes("google-analytics.com") || lowerHtml.includes("googletagmanager.com")) {
    tech.push("Google Analytics");
  }
  if (lowerHtml.includes("fontawesome") || lowerHtml.includes("font-awesome")) {
    tech.push("FontAwesome");
  }

  const primaryCms = tech.find((t) =>
    ["WordPress", "Wix", "Shopify", "PrestaShop", "Squarespace", "Webflow", "Joomla", "Drupal"].includes(t)
  );

  return {
    name: primaryCms ?? "custom_or_unknown",
    detected: Boolean(primaryCms),
    tech
  };
}

export function detectBookingWidget(html: string): { hasBooking: boolean; provider: string | null } {
  const lower = html.toLowerCase();

  const providers: Array<{ name: string; patterns: string[] }> = [
    { name: "Planity", patterns: ["planity.com", "widget.planity.com"] },
    { name: "Doctolib", patterns: ["doctolib.fr", "doctolib.com"] },
    { name: "Calendly", patterns: ["calendly.com", "assets.calendly.com"] },
    { name: "Zenfirst", patterns: ["zenfirst.com", "zenya.fr"] },
    { name: "Reservio", patterns: ["reservio.com"] },
    { name: "Fresha", patterns: ["fresha.com"] },
    { name: "TheFork", patterns: ["thefork.com", "thefork.fr", "lafourchette.com", "module.lafourchette.com"] },
    { name: "OpenTable", patterns: ["opentable.com", "opentable.fr"] },
    { name: "Cal.com", patterns: ["cal.com"] },
    { name: "Treatwell", patterns: ["treatwell.fr", "treatwell.com"] }
  ];

  for (const { name, patterns } of providers) {
    if (patterns.some((p) => lower.includes(p))) {
      return { hasBooking: true, provider: name };
    }
  }

  // Generic booking trigger keywords in buttons/links
  if (
    lower.includes("prendre rendez-vous") ||
    lower.includes("prendre rdv") ||
    lower.includes("réserver en ligne") ||
    lower.includes("reserver en ligne")
  ) {
    return { hasBooking: true, provider: "custom_booking_link" };
  }

  return { hasBooking: false, provider: null };
}

export function detectOutdatedTechnicalSignals(html: string, currentYear = new Date().getFullYear()): {
  copyrightYear: number | null;
  isCopyrightOutdated: boolean;
  hasLegacyLayoutTables: boolean;
  outdatedSignals: string[];
} {
  const outdatedSignals: string[] = [];
  let copyrightYear: number | null = null;
  let isCopyrightOutdated = false;

  // Extract copyright year from footer/text
  const copyrightMatch = html.match(/(?:copyright|©|\(c\)|tous droits r[ée]serv[ée]s|all rights reserved)[^0-9\n]{0,30}(?:20\d{2}\s*[-–—/]\s*)?(20\d{2})/i)
    || html.match(/(?:20\d{2}\s*[-–—/]\s*)?(20\d{2})\s*(?:copyright|©|\(c\)|tous droits r[ée]serv[ée]s)/i);

  if (copyrightMatch?.[1]) {
    const parsed = parseInt(copyrightMatch[1], 10);
    if (!isNaN(parsed) && parsed >= 1995 && parsed <= currentYear + 1) {
      copyrightYear = parsed;
      if (parsed <= currentYear - 3) {
        isCopyrightOutdated = true;
        outdatedSignals.push(`outdated_copyright_${parsed}`);
      }
    }
  }

  // Check for legacy HTML layout tables (e.g. tables with layout presentation attributes and lack of semantic HTML5)
  const hasLegacyTableAttributes = /<table[^>]*(?:cellpadding|cellspacing|border=["']0["'])[^>]*>/i.test(html);
  const hasModernSemanticTags = /<(?:header|main|nav|footer|section|article)\b/i.test(html);
  const hasLegacyLayoutTables = hasLegacyTableAttributes && !hasModernSemanticTags;

  if (hasLegacyLayoutTables) {
    outdatedSignals.push("legacy_layout_tables");
  }

  // Check for deprecated Flash / Applets
  if (html.includes("application/x-shockwave-flash") || /<applet\b/i.test(html)) {
    outdatedSignals.push("flash_applet_detected");
  }

  // Check for missing viewport meta
  if (!/<meta\s+[^>]*name=["']viewport["']/i.test(html)) {
    outdatedSignals.push("missing_viewport_meta");
  }

  return {
    copyrightYear,
    isCopyrightOutdated,
    hasLegacyLayoutTables,
    outdatedSignals
  };
}

export class WebsiteTechnicalProvider implements SignalProvider {
  readonly id = "website_technical";
  readonly name = "Website Technical, CMS & Mobile Audit";
  readonly description = "Audits website presence, SSL validity, CMS/technology stack, mobile responsiveness, booking widgets, and outdated technical signals.";
  readonly capabilities = [
    "has_website",
    "website_reachable",
    "ssl_active",
    "is_redirected_to_social",
    "final_website_url",
    "has_viewport_meta",
    "mobile_friendly",
    "cms_detected",
    "cms_name",
    "tech_stack",
    "has_booking_widget",
    "booking_provider",
    "outdated_copyright_year",
    "is_copyright_outdated",
    "has_legacy_layout_tables",
    "outdated_technical_signals"
  ];
  readonly costPerExecutionUsd = 0;

  supports(context: SignalContext): boolean {
    if (
      context.company.rawProviderData &&
      typeof context.company.rawProviderData === "object" &&
      ("html" in (context.company.rawProviderData as object) || "websiteAudit" in (context.company.rawProviderData as object))
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

    // If company has no website/domain at all
    if (!rawUrl && (!context.company.rawProviderData || !("html" in (context.company.rawProviderData as object)))) {
      evidence.push({
        signalProvider: this.id,
        key: "has_website",
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
      let finalUrl = targetUrl;
      let sslActive = targetUrl.startsWith("https://");
      let websiteReachable = true;
      let isRedirectedToSocial = false;

      // 1. Check for fixture / mock HTML in rawProviderData
      if (
        context.company.rawProviderData &&
        typeof context.company.rawProviderData === "object" &&
        "html" in (context.company.rawProviderData as object)
      ) {
        html = String((context.company.rawProviderData as { html: string }).html);
        if ("sslActive" in (context.company.rawProviderData as object)) {
          sslActive = Boolean((context.company.rawProviderData as { sslActive: boolean }).sslActive);
        }
        if ("finalUrl" in (context.company.rawProviderData as object)) {
          finalUrl = String((context.company.rawProviderData as { finalUrl: string }).finalUrl);
        }
      } else {
        // 2. Fetch live website HTML with 8s timeout bound
        try {
          const response = await fetch(targetUrl, {
            signal: AbortSignal.timeout(8000),
            headers: {
              "User-Agent": "DevcommSalesOS/0.1 TechnicalAudit (+https://devcomm-os.firebaseapp.com)"
            }
          });

          finalUrl = response.url || targetUrl;
          sslActive = finalUrl.startsWith("https://");

          if (!response.ok) {
            websiteReachable = false;
          } else {
            const rawBody = await response.text();
            html = rawBody.slice(0, 250000); // Cap inspection to 250KB
          }
        } catch {
          websiteReachable = false;
          sslActive = false;
        }
      }

      // Check for social redirect / third-party-only presence
      let thirdPartyPresenceOnly = false;
      let thirdPartyPlatform = "";
      try {
        const parsedFinal = new URL(finalUrl);
        const host = parsedFinal.hostname.replace(/^www\./, "");
        if (SOCIAL_DOMAINS.some((soc) => host === soc || host.endsWith(`.${soc}`))) {
          isRedirectedToSocial = true;
        }
        const matched = THIRD_PARTY_PRESENCE_DOMAINS.find(
          (dom) => host === dom || host.endsWith(`.${dom}`)
        );
        if (matched) {
          thirdPartyPresenceOnly = true;
          thirdPartyPlatform = matched;
        }
      } catch {
        // Ignore URL parse error
      }

      evidence.push({
        signalProvider: this.id,
        key: "third_party_presence_only",
        value: thirdPartyPresenceOnly,
        sourceType: "website",
        sourceUrl: finalUrl,
        confidence: 90,
        nature: "derived_metric",
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });

      if (thirdPartyPresenceOnly) {
        evidence.push({
          signalProvider: this.id,
          key: "third_party_platform",
          value: thirdPartyPlatform,
          sourceType: "website",
          sourceUrl: finalUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      // REQ-030: Website Presence & SSL
      evidence.push({
        signalProvider: this.id,
        key: "has_website",
        value: true,
        sourceType: "website",
        sourceUrl: targetUrl,
        confidence: 95,
        nature: "fact",
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });

      evidence.push({
        signalProvider: this.id,
        key: "website_reachable",
        value: websiteReachable,
        sourceType: "website",
        sourceUrl: finalUrl,
        confidence: 95,
        nature: "fact",
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });

      evidence.push({
        signalProvider: this.id,
        key: "ssl_active",
        value: sslActive,
        sourceType: "website",
        sourceUrl: finalUrl,
        confidence: 95,
        nature: "fact",
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });

      evidence.push({
        signalProvider: this.id,
        key: "is_redirected_to_social",
        value: isRedirectedToSocial,
        sourceType: "website",
        sourceUrl: finalUrl,
        confidence: 90,
        nature: "fact",
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });

      evidence.push({
        signalProvider: this.id,
        key: "final_website_url",
        value: finalUrl,
        sourceType: "website",
        sourceUrl: finalUrl,
        confidence: 90,
        nature: "fact",
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });

      if (html) {
        // REQ-033: CMS & Tech Detection
        const cmsResult = detectCMS(html);
        evidence.push({
          signalProvider: this.id,
          key: "cms_detected",
          value: cmsResult.detected,
          sourceType: "website",
          sourceUrl: finalUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });

        evidence.push({
          signalProvider: this.id,
          key: "cms_name",
          value: cmsResult.name,
          sourceType: "website",
          sourceUrl: finalUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });

        evidence.push({
          signalProvider: this.id,
          key: "tech_stack",
          value: cmsResult.tech,
          sourceType: "website",
          sourceUrl: finalUrl,
          confidence: 85,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });

        // REQ-032: Mobile UX & Responsiveness Check
        const hasViewport = /<meta\s+[^>]*name=["']viewport["']/i.test(html);
        evidence.push({
          signalProvider: this.id,
          key: "has_viewport_meta",
          value: hasViewport,
          sourceType: "website",
          sourceUrl: finalUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });

        evidence.push({
          signalProvider: this.id,
          key: "mobile_friendly",
          value: hasViewport,
          sourceType: "website",
          sourceUrl: finalUrl,
          confidence: 85,
          nature: "derived_metric",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });

        // REQ-035: Booking Widget Detection
        const bookingResult = detectBookingWidget(html);
        evidence.push({
          signalProvider: this.id,
          key: "has_booking_widget",
          value: bookingResult.hasBooking,
          sourceType: "website",
          sourceUrl: finalUrl,
          confidence: 90,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });

        if (bookingResult.provider) {
          evidence.push({
            signalProvider: this.id,
            key: "booking_provider",
            value: bookingResult.provider,
            sourceType: "website",
            sourceUrl: finalUrl,
            confidence: 90,
            nature: "fact",
            collectedAt: now,
            expiresAt,
            costUsd: 0
          });
        }

        // REQ-036: Outdated Technical Signals
        const outdatedResult = detectOutdatedTechnicalSignals(html);
        if (outdatedResult.copyrightYear !== null) {
          evidence.push({
            signalProvider: this.id,
            key: "outdated_copyright_year",
            value: outdatedResult.copyrightYear,
            sourceType: "website",
            sourceUrl: finalUrl,
            confidence: 90,
            nature: "fact",
            collectedAt: now,
            expiresAt,
            costUsd: 0
          });
        }

        evidence.push({
          signalProvider: this.id,
          key: "is_copyright_outdated",
          value: outdatedResult.isCopyrightOutdated,
          sourceType: "website",
          sourceUrl: finalUrl,
          confidence: 85,
          nature: "derived_metric",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });

        evidence.push({
          signalProvider: this.id,
          key: "has_legacy_layout_tables",
          value: outdatedResult.hasLegacyLayoutTables,
          sourceType: "website",
          sourceUrl: finalUrl,
          confidence: 85,
          nature: "fact",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });

        evidence.push({
          signalProvider: this.id,
          key: "outdated_technical_signals",
          value: outdatedResult.outdatedSignals,
          sourceType: "website",
          sourceUrl: finalUrl,
          confidence: 85,
          nature: "derived_metric",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

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
        evidence,
        costEstimateUsd: 0,
        durationMs: Date.now() - startTime,
        error: errorMsg
      };
    }
  }
}
