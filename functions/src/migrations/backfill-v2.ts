import type { DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase";
import {
  createWorkspace,
  createBusiness,
  createOffer,
  saveKnowledgeBase,
  getWorkspace,
  getBusiness,
  getOffer,
  getKnowledgeBase,
} from "../services/business-service";

export interface MigrationResult {
  workspaceId: string;
  businessesCreated: string[];
  offersCreated: string[];
  countsByCollection: Record<string, number>;
  totalMigrated: number;
  dryRun: boolean;
}

export async function backfillV2Migration(options?: {
  defaultWorkspaceId?: string;
  defaultBusinessId?: string;
  dryRun?: boolean;
}): Promise<MigrationResult> {
  const workspaceId = options?.defaultWorkspaceId || "ws_default";
  const defaultBusinessId = options?.defaultBusinessId || "biz_devcomm";
  const dryRun = Boolean(options?.dryRun);

  const businessesCreated: string[] = [];
  const offersCreated: string[] = [];

  // 1. Ensure Default Workspace exists
  if (!dryRun) {
    const existingWs = await getWorkspace(workspaceId);
    if (!existingWs) {
      await createWorkspace(workspaceId, "Default Workspace", undefined, defaultBusinessId);
    }
  }

  // 2. Ensure Devcomm Consulting business exists
  const devcommBiz = await getBusiness(workspaceId, defaultBusinessId);
  if (!devcommBiz && !dryRun) {
    await createBusiness(workspaceId, {
      id: defaultBusinessId,
      name: "Devcomm Consulting",
      legalName: "Devcomm SAS",
      website: "https://devcomm.fr",
      defaultLanguage: "fr",
      branding: {
        primaryColor: "#2563eb",
        tagline: "Commercial Performance & B2B Consulting",
      },
      automationPolicy: {
        mode: "assisted",
        dailyOutreachLimit: 50,
        dailyDiscoveryLimit: 100,
        requireApprovalBeforeSend: true,
        autoReplySafeThreshold: 0.85,
      },
      calendarConfig: {
        provider: "microsoft_graph",
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: "09:00", end: "18:00" },
        timezone: "Europe/Paris",
      },
    });
    businessesCreated.push(defaultBusinessId);
  }

  // Ensure Devcomm default offer exists
  const devcommOfferId = "off_devcomm_commercial";
  const existingDevcommOffer = await getOffer(workspaceId, defaultBusinessId, devcommOfferId);
  if (!existingDevcommOffer && !dryRun) {
    await createOffer(workspaceId, defaultBusinessId, {
      id: devcommOfferId,
      name: "Commercial Performance & B2B Sales Coaching",
      description: "Comprehensive sales training, outbound restructuring, and commercial coaching for French SMEs.",
      targetPersonas: [
        {
          title: "Dirigeant / Directeur Général",
          priority: 1,
          keywords: ["gérant", "directeur général", "fondateur", "président", "ceo"],
        },
        {
          title: "Directeur Commercial / Responsable Ventes",
          priority: 2,
          keywords: ["directeur commercial", "responsable commercial", "head of sales"],
        },
      ],
      valuePropositions: [
        "Accelerate B2B sales cycle by 35%",
        "Structured outbound sales execution and prospecting playbooks",
        "Team sales coaching and closing workshops",
      ],
      proofPoints: [
        "+40% pipeline velocity across 60+ French client teams",
        "Over 15 years of B2B sales coaching excellence",
      ],
      pricingGuardrails: {
        startingPrice: 3500,
        currency: "EUR",
        pricingModel: "custom_quote",
        canDiscloseInColdReply: false,
      },
      prohibitedPromises: [
        "guaranteed revenue doubling in 30 days",
        "free unlimited coaching",
      ],
    });
    offersCreated.push(devcommOfferId);
  }

  // Ensure Devcomm Knowledge Base exists
  const devcommKb = await getKnowledgeBase(workspaceId, defaultBusinessId);
  if (!devcommKb && !dryRun) {
    await saveKnowledgeBase(workspaceId, defaultBusinessId, {
      services: [
        {
          name: "Commercial Performance Diagnostic",
          description: "Audit of sales pipeline, conversion funnel, and team execution.",
          idealFor: "SMEs with 5 to 50 employees looking to scale revenue.",
        },
        {
          name: "B2B Outbound Coaching",
          description: "Hands-on training on cold outreach, objection handling, and closing.",
          idealFor: "Sales teams needing modernized prospecting workflows.",
        },
      ],
      caseStudies: [
        {
          title: "Logistics SaaS Outbound Overhaul",
          clientIndustry: "Transport & Logistics",
          metric: "+65% qualified discovery meetings in 90 days",
          description: "Restructured ICP definition, multi-channel messaging, and sales objection handling.",
        },
      ],
      pricingRules: [
        "Diagnostics start at €2,500 HT.",
        "Monthly coaching engagements range from €3,500 to €7,500 HT.",
        "Always recommend a diagnostic call before quoting fixed prices.",
      ],
      faqs: [
        {
          question: "How long does a typical consulting engagement last?",
          answer: "Engagements typically run for 3 to 6 months with bi-weekly coaching sessions.",
        },
      ],
      prohibitedPromises: [
        "Do not promise fixed ROI percentages in initial cold outreach.",
        "Do not offer unapproved discounts.",
      ],
    });
  }

  // 3. Ensure Bloomy Digital Studio business exists
  const bloomyBizId = "biz_bloomy";
  const bloomyBiz = await getBusiness(workspaceId, bloomyBizId);
  if (!bloomyBiz && !dryRun) {
    await createBusiness(workspaceId, {
      id: bloomyBizId,
      name: "Bloomy Digital Studio",
      legalName: "Bloomy Digital Studio",
      website: "https://bloomydigital.com",
      defaultLanguage: "fr",
      branding: {
        primaryColor: "#059669",
        tagline: "High-Performance Websites & Digital Modernization",
      },
      automationPolicy: {
        mode: "assisted",
        dailyOutreachLimit: 40,
        dailyDiscoveryLimit: 80,
        requireApprovalBeforeSend: true,
        autoReplySafeThreshold: 0.85,
      },
      calendarConfig: {
        provider: "google_calendar",
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: "09:00", end: "18:00" },
        timezone: "Europe/Paris",
      },
    });
    businessesCreated.push(bloomyBizId);
  }

  // Ensure Bloomy default offer exists
  const bloomyOfferId = "off_bloomy_website_redesign";
  const existingBloomyOffer = await getOffer(workspaceId, bloomyBizId, bloomyOfferId);
  if (!existingBloomyOffer && !dryRun) {
    await createOffer(workspaceId, bloomyBizId, {
      id: bloomyOfferId,
      name: "Website Modernization & Mobile Optimization",
      description: "Modern, ultra-fast, mobile-optimized showcase and e-commerce websites designed to convert local French customers.",
      targetPersonas: [
        {
          title: "Artisan / Commerçant / Gérant",
          priority: 1,
          keywords: ["gérant", "propriétaire", "artisan", "patron", "fondateur"],
        },
      ],
      valuePropositions: [
        "Instant mobile loading (<1.5s PageSpeed)",
        "Modern responsive design tailored to French local artisans and SMBs",
        "Turnkey online ordering and appointment booking integration",
      ],
      proofPoints: [
        "95+ mobile PageSpeed scores on modern web architectures",
        "Over 30 local business website redesigns delivered",
      ],
      pricingGuardrails: {
        startingPrice: 1490,
        currency: "EUR",
        pricingModel: "fixed",
        canDiscloseInColdReply: true,
      },
      prohibitedPromises: [
        "guaranteed #1 Google ranking in 48 hours",
        "free hosting forever",
      ],
    });
    offersCreated.push(bloomyOfferId);
  }

  // Ensure Bloomy Knowledge Base exists
  const bloomyKb = await getKnowledgeBase(workspaceId, bloomyBizId);
  if (!bloomyKb && !dryRun) {
    await saveKnowledgeBase(workspaceId, bloomyBizId, {
      services: [
        {
          name: "Showcase Website Redesign",
          description: "5 to 10-page modern responsive website with local SEO optimization.",
          idealFor: "Artisans, local shops, professional services with outdated or slow websites.",
        },
        {
          name: "E-Commerce & Online Booking Integration",
          description: "Complete setup of online ordering, catalog, and booking calendar.",
          idealFor: "Florists, bakeries, salons, and local retail.",
        },
      ],
      caseStudies: [
        {
          title: "Atelier Floral Nantes Website Modernization",
          clientIndustry: "Florist / Retail",
          metric: "PageSpeed increased from 24 to 98; +120% mobile inquiries",
          description: "Replaced an outdated slow site with modern responsive ordering platform.",
        },
      ],
      pricingRules: [
        "Showcase websites start at €1,490 HT.",
        "E-Commerce & Booking platforms start at €2,490 HT.",
        "Monthly maintenance & hosting starts at €49 HT/month.",
      ],
      faqs: [
        {
          question: "How long does a website redesign take?",
          answer: "Typically 2 to 3 weeks from kickoff to live deployment.",
        },
      ],
      prohibitedPromises: [
        "Do not promise overnight SEO rank #1.",
        "Do not quote below €1,490 without explicit approval.",
      ],
    });
  }

  // 4. Backfill existing legacy collections
  const collectionsToBackfill = [
    "companies",
    "contacts",
    "discoveryCampaigns",
    "discoveryRuns",
    "discoveryRejected",
    "leadResearch",
    "outreach",
    "logs",
    "meetings",
  ];

  const countsByCollection: Record<string, number> = {};
  let totalMigrated = 0;

  for (const colName of collectionsToBackfill) {
    const snapshot = await adminDb.collection(colName).get();
    let colMigrated = 0;
    const docsToUpdate: Array<{ id: string; ref: DocumentReference; data: Record<string, unknown> }> = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const needsWorkspace = !data.workspaceId;
      const needsBusiness = !data.businessId;
      const needsOffer = colName === "discoveryCampaigns" && !data.offerId;

      if (needsWorkspace || needsBusiness || needsOffer) {
        const patch: Record<string, unknown> = {};
        if (needsWorkspace) patch.workspaceId = workspaceId;
        if (needsBusiness) patch.businessId = defaultBusinessId;
        if (needsOffer) patch.offerId = devcommOfferId;

        docsToUpdate.push({
          id: docSnap.id,
          ref: docSnap.ref,
          data: patch,
        });
      }
    }

    if (!dryRun && docsToUpdate.length > 0) {
      // Chunk batches by 450 (Firestore limit is 500)
      const chunkSize = 450;
      for (let i = 0; i < docsToUpdate.length; i += chunkSize) {
        const chunk = docsToUpdate.slice(i, i + chunkSize);
        const batch = adminDb.batch();
        for (const item of chunk) {
          batch.set(item.ref, item.data, { merge: true });
        }
        await batch.commit();
      }
    }

    colMigrated = docsToUpdate.length;
    countsByCollection[colName] = colMigrated;
    totalMigrated += colMigrated;
  }

  return {
    workspaceId,
    businessesCreated,
    offersCreated,
    countsByCollection,
    totalMigrated,
    dryRun,
  };
}
