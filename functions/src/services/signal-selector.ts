import type { OfferDoc, ResearchStrategy, SignalProviderId } from "../types/domain.js";

interface StrategyContext {
  prompt?: string;
  offer?: Partial<OfferDoc> | null;
  targetPersonas?: string[];
  keywords?: string[];
  nafCodes?: string[];
  minEmployeeCount?: number;
  requireWebsite?: boolean;
}

/**
 * Dynamically determines which Signal Providers to enable for a campaign
 * based on the offer value propositions and targeting context.
 * Adheres strictly to Invariant 1 (Generic, offer-agnostic logic).
 */
export function selectSignalStrategy(context: StrategyContext | string): ResearchStrategy {
  const ctx: StrategyContext = typeof context === "string" ? { prompt: context } : context;
  const promptText = (ctx.prompt ?? "").toLowerCase();
  
  const offerName = (ctx.offer?.name ?? "").toLowerCase();
  const offerDesc = (ctx.offer?.description ?? "").toLowerCase();
  const offerProps = (ctx.offer?.valuePropositions ?? []).join(" ").toLowerCase();
  const offerPersonas = (ctx.offer?.targetPersonas ?? []).map(p => p.title + " " + p.keywords.join(" ")).join(" ").toLowerCase();
  
  const combinedText = [
    promptText,
    offerName,
    offerDesc,
    offerProps,
    offerPersonas,
    (ctx.keywords ?? []).join(" ").toLowerCase(),
    (ctx.targetPersonas ?? []).join(" ").toLowerCase()
  ].join(" ");

  const enabledProviders: SignalProviderId[] = ["company_registry"]; // Always universal

  // 1. Google Places (Local B2B, retail, artisans, shops, restaurants, clinics)
  const localKeywords = [
    "fleuriste", "florist", "boulangerie", "bakery", "restaurant", "artisan", "commerce", "magasin",
    "boutique", "salon", "coiffeur", "garage", "clinique", "cabinet", "local", "nantes", "lyon", "paris"
  ];
  const isLocalOrRetail = localKeywords.some(kw => combinedText.includes(kw)) ||
    (ctx.minEmployeeCount !== undefined && ctx.minEmployeeCount <= 5);

  if (isLocalOrRetail) {
    enabledProviders.push("google_places");
  }

  // 2. Website Presence & Technical Audits (Web design, redesign, modernization, SEO, PageSpeed, CMS)
  const webTechnicalKeywords = [
    "site web", "site internet", "site vitrine", "website", "refonte", "redesign", "modernisation web",
    "web design", "webdesign", "ux/ui", "pagespeed", "core web vitals", "cms", "wordpress", "wix", "prestashop",
    "shopify", "seo", "audit web", "présence en ligne", "web"
  ];
  const isWebTechnical = webTechnicalKeywords.some(kw => {
    if (kw === "web") {
      return /\bweb\b/i.test(combinedText);
    }
    return combinedText.includes(kw);
  });

  if (isWebTechnical) {
    if (!enabledProviders.includes("website_presence")) enabledProviders.push("website_presence");
    if (!enabledProviders.includes("website_technical")) enabledProviders.push("website_technical");
  }

  // 3. E-Commerce & Online Ordering (Shop, cart, click & collect, reservation widgets)
  const ecommerceKeywords = [
    "e-commerce", "ecommerce", "boutique en ligne", "commande en ligne", "click and collect",
    "panier", "paiement", "reservation", "booking", "doctolib", "planity", "shop"
  ];
  const isEcommerce = ecommerceKeywords.some(kw => combinedText.includes(kw));

  if (isEcommerce) {
    if (!enabledProviders.includes("website_presence")) enabledProviders.push("website_presence");
    if (!enabledProviders.includes("website_ecommerce")) enabledProviders.push("website_ecommerce");
  }

  // 4. Company Scale (Multi-site, subsidiaries, corporate hierarchy, manufacturing, fleet, road safety)
  const scaleKeywords = [
    "industrie", "manufacturing", "pme", "eti", "usine", "fabrication", "chaudronnerie",
    "mécanique", "flotte", "fleet", "transport", "logistique", "multi-site", "agences", "corporate"
  ];
  const isScale = scaleKeywords.some(kw => combinedText.includes(kw)) ||
    (ctx.minEmployeeCount !== undefined && ctx.minEmployeeCount >= 10);

  if (isScale) {
    if (!enabledProviders.includes("company_scale")) enabledProviders.push("company_scale");
  }

  // 5. Company Hiring & HR / Sales Coaching (Recruitment, sales training, staffing, talent)
  const hiringKeywords = [
    "formation", "training", "coaching", "recrutement", "hiring", "rh", "talent",
    "sales", "commercial", "performance commerciale", "forces de vente", "management"
  ];
  const isHiringOrTraining = hiringKeywords.some(kw => combinedText.includes(kw));

  if (isHiringOrTraining) {
    if (!enabledProviders.includes("company_hiring")) enabledProviders.push("company_hiring");
  }

  // 6. Technology Stack (SaaS, CRM, marketing automation, software)
  const techStackKeywords = [
    "saas", "crm", "hubspot", "salesforce", "logiciel", "software", "stack", "cloud"
  ];
  const isTechStack = techStackKeywords.some(kw => combinedText.includes(kw));

  if (isTechStack) {
    if (!enabledProviders.includes("technology_stack")) enabledProviders.push("technology_stack");
  }

  // Build scoring weights based on enabled signal archetypes
  const scoringWeights = {
    companyFitWeight: isScale ? 0.35 : 0.25,
    needStrengthWeight: (isWebTechnical || isEcommerce) ? 0.45 : 0.35,
    commercialScaleWeight: isScale ? 0.30 : 0.15,
    evidenceConfidenceWeight: 0.15
  };

  const relevanceExplanation = `Strategy configured with ${enabledProviders.length} signal modules based on offer & targeting signals: ${enabledProviders.join(", ")}.`;

  return {
    enabledSignalProviders: enabledProviders,
    relevanceExplanation,
    scoringWeights
  };
}
