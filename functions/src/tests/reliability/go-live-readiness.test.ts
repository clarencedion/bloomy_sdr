import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Pure tests: nothing here may reach Firestore or a model. The logger is the
// only side effect on the paths exercised, so it is stubbed.
vi.mock("../../utils/logger.js", () => ({ writeLog: vi.fn(async () => undefined) }));

import {
  checkPricingStatements,
  describePricingTerms,
  extractPrices,
  mentionsCommercialTerms,
  type PricingTerms
} from "../../services/pricing-guardrail.js";
import { validateReplyGroundedness, generateGroundedReply } from "../../services/reply-generator.js";
import { validateOutreachClaims } from "../../services/claim-validator.js";
import { bookMeetingAtomically } from "../../services/meeting-creator.js";
import { isDailyLimitError } from "../../services/task-queue-service.js";
import { createDailyBudget, RUN_BATCH_CAP } from "../../jobs/daily-research-runner.js";
import { DailyQuotaExceededError, quotaDay, quotaDocId } from "../../services/daily-quota.js";
import { buildBusinessContext } from "../../services/business-context.js";
import { offerNeutralKnowledgeBase } from "../../services/offer-experiment.js";
import type { OfferDoc } from "../../types/domain.js";

// Runs from the repo root (npm test) or from functions/ (npm --prefix functions
// test); import.meta is unavailable because functions/ compiles to CommonJS.
const functionsRoot = fs.existsSync(path.resolve(process.cwd(), "src/services"))
  ? process.cwd()
  : path.resolve(process.cwd(), "functions");
const repoRoot = path.resolve(functionsRoot, "..");
const read = (rel: string) => fs.readFileSync(path.join(functionsRoot, rel), "utf8");

// The seeded subscription terms, and two archetypes with nothing in common.
const subscription: PricingTerms = {
  startingPrice: 49,
  currency: "EUR",
  pricingModel: "subscription",
  canDiscloseInColdReply: true,
  setupFee: 0,
  monthlyPrice: 49,
  commitmentMonths: 24,
  taxLabel: "HT",
  approvedTerms: [
    "0 € de création",
    "Création du site offerte",
    "49 € HT par mois",
    "Engagement de 24 mois",
    "Premier mois réglé à la commande",
    "Le domaine, le code et les contenus restent à votre nom"
  ]
};
const quoteOnly: PricingTerms = { currency: "EUR", pricingModel: "custom_quote", canDiscloseInColdReply: false };
const fixedNoCommitment: PricingTerms = { pricingModel: "fixed", canDiscloseInColdReply: true, startingPrice: 1490, taxLabel: "HT" };

const offerWith = (pricingGuardrails: PricingTerms): OfferDoc =>
  ({
    id: "off_test",
    workspaceId: "ws_test",
    businessId: "biz_test",
    name: "Offre test",
    description: "",
    targetPersonas: [],
    valuePropositions: [],
    proofPoints: [],
    pricingGuardrails,
    prohibitedPromises: [],
    createdAt: new Date(),
    updatedAt: new Date()
  }) as unknown as OfferDoc;

const passes = (text: string, terms?: PricingTerms | null) => checkPricingStatements(text, terms).passed;

const HELD_OUT: string[] = [
    "Nous vous offrons le premier mois.",
    "On vous offre les trois premiers mois d'abonnement.",
    "Le premier mois ne vous coûte rien.",
    "Vous ne payez rien pendant les trois premiers mois.",
    "Aucun frais pendant 3 mois.",
    "Le premier mois n'est pas facturé.",
    "Le premier mois est à notre charge.",
    "Le premier mois, c'est cadeau.",
    "Premier mois remboursé si vous n'êtes pas satisfait.",
    "Sans aucun frais le premier mois.",
    "Ne ratez pas les trois mois offerts.",
    "Ne passez pas à côté de nos 3 mois offerts.",
    "Pas de frais et deux mois offerts.",
    "Aucun frais le mois gratuit.",
    "Le premier mois qui couvre toute la mise en ligne est offert.",
    "Le premier mois d'accompagnement incluant la création est offert.",
    "Votre abonnement des trois premiers mois avec la création est offert.",
    "Création et boutique en ligne offertes.",
    "Nous créons gratuitement votre boutique en ligne.",
    "La création de votre logo est offerte.",
    "Création et design sur mesure offerts.",
    "Création et nom de domaine offerts.",
    "Création et contrat de 3 mois offerts.",
    "Résiliation possible à tout moment.",
    "Vous pouvez résilier votre abonnement quand vous voulez.",
    "Vous pouvez arrêter l'abonnement à tout moment.",
    "Annulable à tout moment.",
    "Sans contrat, vous êtes libre.",
    "Aucune durée minimale.",
    "Pas de durée minimale.",
    "Engagement : aucun.",
    "Vous vous engagez pour 12 mois seulement.",
    "Un engagement annuel suffit.",
    "Minimum 12 mois.",
    "Pour une durée de 12 mois.",
    "L'abonnement dure 12 mois.",
    "Un abonnement de 12 mois.",
    "Vous restez libre de partir quand vous le souhaitez.",
    "Mois par mois, sans attache.",
    "Seulement 39 HT par mois.",
    "À partir de 39/mois.",
    "39 balles par mois.",
    "Comptez 39 euros HT.",
    "Pour 49 € TTC.",
    "49 € hors taxe, 588 € TTC à l'année.",
    "Je peux vous faire une remise.",
    "Une réduction est possible pour les fleuristes.",
    "Deux mois pour le prix d'un.",
    "À moitié prix le premier mois.",
    "Tarif réduit pour les premiers inscrits.",
    "Offre de bienvenue réservée aux fleuristes.",
    "50 % de remise la première année.",
    "6 mois offerts.",
    "Deuxième mois offert aussi.",
    "Comptez quelques centaines d'euros.",
    "Un diagnostic offert.",
    "Nous vous offrons un diagnostic.",
    "Le diagnostic ne vous coûte rien.",
    "Moins de 500 balles.",
    "Prévoyez 1500 HT."
  ];

describe("Phase 19 — pricing guardrail: every misstatement the adversarial review found is refused", () => {
  // The review fed these through the first version; 21 passed. Each is a
  // statement a prospect would rely on, and none is true of the offer.
  const lies: Array<[string, PricingTerms]> = [
    ["Et le premier mois est offert !", subscription],
    ["Les trois premiers mois sont offerts.", subscription],
    ["L'abonnement est gratuit pendant 3 mois.", subscription],
    ["0 € de création et 0 €/mois la première année.", subscription],
    ["La première année est offerte.", subscription],
    ["Il n'y a aucun engagement.", subscription],
    ["Pas d'engagement, vous arrêtez quand vous voulez.", subscription],
    ["L'engagement est de 12 mois seulement.", subscription],
    ["Durée d'engagement : 12 mois.", subscription],
    ["Un contrat de 12 mois.", subscription],
    ["Avec un engagement d'un an.", subscription],
    ["Avec un engagement de douze mois.", subscription],
    ["Seulement 39 € HT par mois.", subscription],
    ["Seulement €39 par mois.", subscription],
    ["Seulement 39 euros HT par mois.", subscription],
    ["Seulement trente-neuf euros par mois.", subscription],
    ["49 € TTC par mois.", subscription],
    ["49 € toutes taxes comprises par mois.", subscription],
    ["Profitez de -20 % sur l'abonnement.", subscription],
    ["20 % moins cher ce mois-ci.", subscription],
    ["Une remise de 50 % ce mois-ci.", subscription],
    ["Hébergement gratuit à vie.", subscription],
    ["La maintenance est offerte pendant un an.", subscription],
    ["Le site vous est offert.", subscription],
    ["Pas de frais de création et le premier mois est offert.", subscription],
    ["Le premier mois et la création sont offerts.", subscription],
    ["49 € HT par an.", subscription],
    ["Offre de lancement ce mois-ci.", subscription],
    ["Comptez environ 2k€ pour le diagnostic.", quoteOnly],
    ["Comptez 1 500 euros pour le diagnostic.", quoteOnly],
    ["Comptez 49 € par mois.", quoteOnly],
    ["Un diagnostic gratuit de votre site.", quoteOnly],
    ["Livraison offerte.", quoteOnly],
    ["Accompagnement sans engagement.", quoteOnly],
    ["1490 € HT, sans engagement.", fixedNoCommitment]
  ];
  it.each(lies)("refuses: %s", (text, terms) => {
    expect(passes(text, terms)).toBe(false);
  });
});

describe("Phase 19 — pricing guardrail: honest statements of the offer pass", () => {
  const honest: Array<[string, PricingTerms]> = [
    ["0 € de création, puis 49 € HT par mois avec un engagement de 24 mois.", subscription],
    ["La création de votre site est gratuite : vous payez 49 € HT par mois.", subscription],
    ["Nous créons votre site gratuitement, vous réglez 49 € HT par mois.", subscription],
    ["Création offerte pour un abonnement de 49 € HT/mois.", subscription],
    ["Création offerte avec un engagement de 24 mois.", subscription],
    ["Le site coûte 49€ HT/mois.", subscription],
    ["Soit 49,00 € HT par mois.", subscription],
    ["Il n'y a pas de mois offert : le premier mois est réglé à la commande.", subscription],
    ["Aucun mois gratuit, mais aucun frais de création.", subscription],
    ["L'engagement est de deux ans.", subscription],
    ["Avec 24 mois d'engagement.", subscription],
    ["Nous avons 110 réalisations sur studio.bloomy.one.", subscription],
    ["J'ai vu les prestations offertes par votre salon.", quoteOnly],
    ["Le site offert par votre hébergeur est lent.", quoteOnly],
    ["Ce n'est pas gratuit, chaque devis est sur mesure.", quoteOnly],
    ["Vous pourriez gagner 20 % de réduction du temps de chargement.", quoteOnly],
    ["Chaque devis est construit après un échange.", quoteOnly]
  ];
  it.each(honest)("accepts: %s", (text, terms) => {
    expect(checkPricingStatements(text, terms).violations).toEqual([]);
  });

  it("escalates — deliberately — figures and terms the offer does not declare, even when true", () => {
    // A total, a TTC conversion, or what happens after the commitment are not
    // declared; a person confirms them. Escalating costs a glance, a wrong
    // figure sent automatically costs trust.
    expect(passes("Sur 24 mois, cela représente 1 176 € HT.", subscription)).toBe(false);
    expect(passes("49 € HT, soit 58,80 € TTC par mois.", subscription)).toBe(false);
    expect(passes("Engagement de 24 mois, puis résiliable à tout moment.", subscription)).toBe(false);
  });

  it("parses French amount formats", () => {
    expect(extractPrices("1 490 € puis 49€ et 49,90 euros, ou 1.490 €")).toEqual([1490, 49, 49.9, 1490]);
    expect(extractPrices("0 € de création")).toEqual([0]);
    expect(extractPrices("€39 ou 2k€")).toEqual(expect.arrayContaining([39, 2000]));
    expect(extractPrices("49 € 24 mois")).toEqual([49]);
    expect(extractPrices("24 mois, 110 réalisations")).toEqual([]);
  });

  it("tells the model exactly what it may state, including what is undeclared", () => {
    const prompt = describePricingTerms(subscription);
    expect(prompt).toContain("Setup / creation fee: 0 € (free)");
    expect(prompt).toContain("Monthly price: 49 € HT per month");
    expect(prompt).toContain("Commitment: 24 months");
    expect(prompt).toContain("Only the setup / creation is free");
    const quote = describePricingTerms(quoteOnly);
    expect(quote).toContain("NOT allowed");
    expect(quote).toContain("Commitment: not declared");
    expect(quote).toContain("Never write HT or TTC");
  });
});

describe("Phase 19 — the guardrail is enforced on every drafting path", () => {
  it("reply validation accepts the honest free-setup reply the old word list escalated", () => {
    const reply = "Bonjour, la création est gratuite : vous ne payez que 49 € HT par mois, engagement de 24 mois.";
    expect(validateReplyGroundedness(reply, offerWith(subscription), null).passed).toBe(true);
  });

  it("reply validation escalates an invented free month", () => {
    const validation = validateReplyGroundedness("Et le premier mois offert !", offerWith(subscription), null);
    expect(validation.passed).toBe(false);
    expect(validation.warnings.join(" ")).toMatch(/Free period/);
  });

  it("checks the reply subject as well as the body (except the prospect's own echoed subject)", () => {
    const source = read("src/services/reply-generator.ts");
    expect(source).toContain("echoedSubject ? rawDraftBody : `${rawDraftSubject}\\n${rawDraftBody}`");
  });

  it("cold outreach validation flags a wrong price as an unsupported claim", () => {
    const result = validateOutreachClaims({
      sequence: {
        subject: "Votre site",
        body: "Bonjour, nous proposons un site à 29 € HT par mois. Si ce n'est pas le moment, dites-le-moi simplement."
      },
      company: { name: "Prospect" },
      offer: offerWith(subscription)
    });
    expect(result.passed).toBe(false);
    expect(result.unsupportedClaims.join(" ")).toMatch(/Conditions commerciales non validées/);
  });

  it("cold outreach finds its offer in the real pipeline (discovery campaign, company.offerId)", () => {
    // The pipeline passes a discoveryCampaigns id; looking only in `campaigns`
    // left the offer undefined and every honest draft flagged.
    const source = read("src/services/outreach-generation.ts");
    expect(source).toContain('collection("discoveryCampaigns")');
    expect(source).toContain("(company.offerId as string)");
    expect(source).toMatch(/\?\? offers\[0\] \?\? null/);
    // Manual edits are re-validated against the draft's offer too.
    expect(source).toContain("offer: draftOffer");
  });

  it("checks DMs and contact-form copy (both written by generateSocialDm)", () => {
    const source = read("src/services/social-dm-generation.ts");
    // One review for generated and edited DMs (ADR-021): with a terms line,
    // the line against the offer and the rest by the strict money check;
    // otherwise the whole text against the offer.
    expect(source).toContain("reviewSocialDmText({ body, termsLine, terms: offer?.pricingGuardrails, extraIssues: judgeIssues })");
    expect(source).toContain("pricingGuardrailPassed: review.pricingGuardrailPassed");
    const review = read("src/services/social-dm-terms.ts");
    expect(review).toContain("checkPricingStatements(termsLine, input.terms)");
    expect(review).toContain("checkPricingStatements(body, input.terms)");
  });

  it("grounds replies in the offer the prospect was sent, not the campaign id", () => {
    expect(read("src/services/reply-router.ts")).toContain("resolveConversationOfferId(convData)");
    expect(read("src/services/conversation-service.ts")).toContain("offerId: await resolveConversationOfferId(conversation)");
  });
});

describe("Phase 19 — fail-closed gate: no commercial wording is ever sent unattended", () => {
  // Written from scratch by the second adversarial review, held out from the
  // detector's development: 52 of these 60 passed the detector. Every one
  // must trip the gate, so none can be sent without a person.
  const heldOut: string[] = HELD_OUT;
  it.each(heldOut)("gates: %s", (text) => {
    expect(mentionsCommercialTerms(text)).toBe(true);
  });

  // Third review: "\w" is ASCII-only, so accented forms slipped past the
  // stems; and these words were not in the vocabulary at all.
  const heldOutAccents = [
    "Satisfait ou remboursé.", "Rien n'est facturé avant la mise en ligne.", "Vous n'êtes engagé sur rien.",
    "La gratuité est totale.", "Tout est annulé sans souci.", "C'est résilié en un clic.",
    "Vous pouvez arrêter quand vous voulez.", "Vous partez quand vous voulez.", "Aucune obligation de votre côté.",
    "Sans obligation.", "Vous n'aurez rien à débourser.", "Pas un centime à avancer.", "Aucun investissement de départ.",
    "Je peux vous faire un petit geste.", "On peut s'arranger sur le montant.", "-20 % pour vous.",
    "Première semaine pour nous.", "Sans condition.", "Zéro risque, zéro engagement.", "Stop quand vous voulez."
  ];
  it.each(heldOutAccents)("gates (accents, missing stems): %s", (text) => {
    expect(mentionsCommercialTerms(text)).toBe(true);
  });

  it("lets ordinary scheduling and factual replies through the gate", () => {
    expect(mentionsCommercialTerms("Seriez-vous disponible jeudi à 14h pour un échange ?")).toBe(false);
    expect(mentionsCommercialTerms("Merci pour votre message, je reviens vers vous demain.")).toBe(false);
  });

  it("autonomous dispatch requires a real transport and no commercial wording", () => {
    const dispatcher = read("src/services/reply-dispatcher.ts");
    expect(dispatcher).toContain("!mentionsCommercial && transport");
    // Delivery goes through the shared path, which re-checks suppression.
    expect(dispatcher).toContain("await deliverReply({");
    expect(read("src/services/reply-delivery.ts")).toMatch(/canContact\(input\.contactId/);
    // No provider can send a reply yet: the seam returns null until Phase 20.
    expect(read("src/services/reply-transport.ts")).toMatch(/return null;/);
    // Automatic approval of cold email respects the same flag.
    const runner = read("src/jobs/daily-research-runner.ts");
    expect(runner).toContain("draft.mentionsCommercialTerms === false");
    expect(runner).toContain("draft.pricingGuardrailPassed !== false");
    expect(runner).toContain('["VALID", "WARNINGS_ONLY"].includes(String(draft.claimValidationStatus))');
  });

  it("never records a manual or approved reply as sent unless it was delivered", () => {
    for (const file of ["src/services/conversation-service.ts", "src/services/inbox-service.ts"]) {
      const source = read(file);
      expect(source).toContain("await deliverReply({");
      expect(source).toContain('deliveryStatus = delivery.delivered ? "delivered" : "recorded_not_sent"');
      // Attention flags are cleared only on delivery.
      expect(source).toMatch(/delivery\.delivered\s*\?\s*\{ unreadHumanAttention: false, humanAttentionRequired: false/);
    }
    const ui = fs.readFileSync(path.join(repoRoot, "src/features/inbox/conversation-thread-view.tsx"), "utf8");
    expect(ui).toContain("sent.delivered === false");
    expect(ui).toContain("Validé — à envoyer depuis Unibox");
    expect(ui).not.toContain("Message envoyé avec succès au prospect !");
  });

  it("never presents a passing detector as clearance on the approval card", () => {
    const card = fs.readFileSync(path.join(repoRoot, "src/features/approvals/approvals-page.tsx"), "utf8");
    // A draft written before the flag existed is treated as commercial.
    expect(card).toContain("item.outreach.mentionsCommercialTerms !== false");
    expect(card).toContain("Compare it with your offer before sending");
  });
});

describe("Phase 19 — no fallback business (ADR-016 #6)", () => {
  it("drafts no reply for an unattributed conversation and hands it to a person", async () => {
    const result = await generateGroundedReply({
      latestInboundMessage: { subject: "Votre offre", bodyText: "Combien ça coûte ?" }
    });
    expect(result.requiresHumanEscalation).toBe(true);
    expect(result.draft.bodyText).toBe("");
    expect(result.escalationReason).toMatch(/not attributed/);
  });

  it("books no meeting for an unattributed conversation, and escalates the confirmation instead of dropping it", async () => {
    const result = await bookMeetingAtomically({
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
      prospectEmail: "x@example.fr",
      prospectName: "X"
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not attributed/);
    expect(read("src/services/reply-router.ts")).toMatch(/could not be booked/);
  });

  it("describes no business when none is attributed (the global default named one firm)", async () => {
    await expect(buildBusinessContext({ workspaceId: "ws_test" })).rejects.toThrow(/not attributed/);
    for (const file of ["research-company.ts", "outreach-generation.ts", "social-dm-generation.ts"]) {
      expect(read(`src/services/${file}`)).not.toContain("settings.companyContext");
    }
  });

  it("puts no other business's booking link in a proposal", () => {
    expect(read("src/services/pdf-generator.ts")).not.toContain("settings.bookingLink");
  });

  it("refuses to send an empty reply draft", () => {
    expect(read("src/services/conversation-service.ts")).toContain("The reply is empty");
  });

  it("lists unattributed replies in every business's Inbox rather than none", () => {
    expect(read("src/services/conversation-service.ts")).toContain("needsAttribution: !businessId");
    const client = fs.readFileSync(path.join(repoRoot, "src/lib/firebase/firestore.ts"), "utf8");
    expect(client.match(/where\("needsAttribution", "==", true\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("does not let one unattributed campaign stop scheduled discovery for the others", () => {
    const index = read("src/index.ts");
    const scheduled = index.slice(index.indexOf("export const scheduledLeadDiscoveryRunner"), index.indexOf("export const dailyResearchQueueRunner"));
    expect(scheduled).toContain("discovery.campaign.unattributed");
    expect(scheduled).toMatch(/try \{\s*await runDiscoveryCampaign\(campaign\.id\);/);
  });

  it("leaves no hardcoded business id, name or sender as a fallback in generic code", () => {
    // Fixture identities are allowed where they are the subject: the demo
    // simulator, the one-off v2 migration (whose callable now requires an
    // explicit id), and the empty-workspace seed.
    const allowed = new Set([
      "functions/src/services/sdr-demo-service.ts",
      "functions/src/migrations/backfill-v2.ts",
      "src/app/api/demo/simulation/route.ts",
      "src/lib/context/business-context.tsx"
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["tests", "node_modules", "__tests__"].includes(entry.name)) continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const rel = path.relative(repoRoot, full);
          if (allowed.has(rel)) continue;
          const source = fs.readFileSync(full, "utf8");
          if (
            /(\|\||\?\?)\s*["']biz_[a-z_]+["']|=\s*["']biz_devcomm["']|(\|\||\?\?)\s*["']Devcomm["']|["']outreach@devcomm\.fr["']|calendly\.com\/devcomm|Devcomm is a French/.test(source)
          ) {
            offenders.push(rel);
          }
        }
      }
    };
    walk(path.join(functionsRoot, "src"));
    walk(path.join(repoRoot, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("Phase 19 — daily volume follows Settings and is actually enforced", () => {
  it("counts usage in one atomic per-business, per-Paris-day counter (no query, no index)", () => {
    expect(quotaDocId({ workspaceId: "ws", businessId: "b" }, "2026-11-10")).toBe("ws_b_2026-11-10");
    expect(quotaDocId({ workspaceId: "ws" }, "2026-11-10")).toBe("ws__unattributed_2026-11-10");
    // 23:30 UTC on 10 Nov is already 11 Nov in Paris.
    expect(quotaDay(new Date("2026-11-10T23:30:00Z"))).toBe("2026-11-11");
    for (const [file, kind] of [["research-company.ts", "research"], ["outreach-generation.ts", "outreach_generation"]]) {
      const source = read(`src/services/${file}`);
      expect(source).toContain(`reserveDailyQuota("${kind}"`);
      expect(source).not.toMatch(/collection\("leadResearch"\)\.where\("createdAt"|collection\("outreach"\)\.where\("createdAt"/);
    }
  });

  it("keeps the queue's deferral wording, so a limit hit returns work to the backlog", () => {
    const error = new DailyQuotaExceededError("Daily email generation limit reached (50/50).", 50, 50);
    expect(isDailyLimitError(error.message)).toBe(true);
    expect(isDailyLimitError("Daily AI research limit reached (25/25).")).toBe(true);
    expect(isDailyLimitError("Company not ready for outreach")).toBe(false);
    const queue = read("src/services/task-queue-service.ts");
    expect(queue).toContain('status: "deferred"');
    expect(queue).toMatch(/\.update\(\s*isOutreachLimit/);
  });

  it("spends each business's remaining allowance independently", async () => {
    const used: Record<string, number> = { "ws/a": 8, "ws/b": 0 };
    const budget = createDailyBudget(10, async (scope) => used[`${scope.workspaceId}/${scope.businessId}`]);
    const a = { workspaceId: "ws", businessId: "a" };
    const b = { workspaceId: "ws", businessId: "b" };
    expect(await budget.remaining(a)).toBe(2);
    expect(await budget.take(a)).toBe(true);
    expect(await budget.take(a)).toBe(true);
    expect(await budget.take(a)).toBe(false);
    for (let i = 0; i < 10; i++) expect(await budget.take(b)).toBe(true);
    expect(await budget.take(b)).toBe(false);
    expect(budget.unreadable.size).toBe(0);
  });

  it("reports — rather than silently ignores — a counter it cannot read", async () => {
    const budget = createDailyBudget(1, async () => null);
    const scope = { workspaceId: "ws", businessId: "a" };
    expect(await budget.take(scope)).toBe(true);
    expect(budget.unreadable.has("ws/a")).toBe(true);
    expect(read("src/jobs/daily-research-runner.ts")).toContain("automation.daily_counter_unreadable");
  });

  it("keeps each pass bounded, queries per business, budgets outreach too, and runs hourly", () => {
    expect(RUN_BATCH_CAP).toBeLessThanOrEqual(50);
    const index = read("src/index.ts");
    const runner = index.slice(index.indexOf("export const dailyResearchQueueRunner"));
    expect(runner.slice(0, 600)).toMatch(/schedule: "0 8-19 \* \* \*"/);
    const source = read("src/jobs/daily-research-runner.ts");
    expect(source).not.toMatch(/Math\.min\(settings\.daily\w+Limit, 50\)/);
    expect(source).toMatch(/\.where\("businessId", "==", scope\.businessId\)\s*\.where\("needsResearch", "==", true\)/);
    expect(source).toContain("outreachBudget.take(scope)");
    expect(source).toContain("OUTREACH_ENQUEUE_COOLDOWN_MS");
  });

  it("blocks an unattributed company once instead of re-enqueueing it every hour", () => {
    expect(read("src/services/task-queue-service.ts")).toMatch(/not attributed to any business\/i\.test\(errorMsg\)/);
    expect(read("src/jobs/daily-research-runner.ts")).toContain('outreachBlockedReason: "Not attributed to any business."');
  });
});

describe("Phase 19 — the seeded offer is the owner's, and is self-consistent", () => {
  const seed = JSON.parse(
    execFileSync(process.execPath, [path.join(functionsRoot, "scripts/seed-bloomy-web-offer.mjs"), "--dry-run"], {
      encoding: "utf8"
    })
  ) as {
    offer: { pricingGuardrails: PricingTerms; valuePropositions: string[]; proofPoints: string[]; description: string };
    knowledgeBase: {
      caseStudies: Array<{ title: string; metric: string }>;
      faqs: Array<{ answer: string }>;
      pricingRules: string[];
    };
  };

  it("states the terms the owner confirmed on 2026-11-10", () => {
    const terms = seed.offer.pricingGuardrails;
    expect(terms.setupFee).toBe(0);
    expect(terms.monthlyPrice).toBe(49);
    expect(terms.commitmentMonths).toBe(24);
    expect(terms.taxLabel).toBe("HT");
    expect(terms.canDiscloseInColdReply).toBe(true);
  });

  it("carries none of the untraceable case studies or the old price list", () => {
    const text = JSON.stringify(seed);
    for (const invented of ["PageSpeed mobile 28", "40 % des RDV", "Demandes de devis x2", "1 490", "29 € HT/mois", "Ne jamais annoncer de prix ferme"]) {
      expect(text).not.toContain(invented);
    }
    for (const study of seed.knowledgeBase.caseStudies) expect(study.metric).toBe("");
  });

  it("contains nothing its own guardrail would reject — pricing rules included, since they reach the prompt", () => {
    const terms = seed.offer.pricingGuardrails;
    const quotable = [
      seed.offer.description,
      ...seed.offer.valuePropositions,
      ...seed.offer.proofPoints,
      ...(terms.approvedTerms ?? []),
      ...seed.knowledgeBase.faqs.map((faq) => faq.answer),
      ...seed.knowledgeBase.pricingRules
    ];
    for (const line of quotable) {
      expect(checkPricingStatements(line, terms).violations, line).toEqual([]);
    }
  });

  it("never deletes an offer and only updates one it recognises", () => {
    const script = read("scripts/seed-bloomy-web-offer.mjs");
    expect(script).not.toMatch(/\.delete\(\)/);
    expect(script).toContain("--plan");
    expect(script).toContain("SEEDED_NAMES.has(");
  });
});

describe("Offer experiment (2026-11-10) — four self-consistent offers, one offer-neutral knowledge base", () => {
  type SeededOffer = {
    id?: string;
    name: string;
    description: string;
    targetPersonas: unknown[];
    valuePropositions: string[];
    proofPoints: string[];
    prohibitedPromises: string[];
    scoringWeights?: unknown;
    scoringRules?: unknown;
    pricingGuardrails: PricingTerms;
  };
  type SeededKnowledgeBase = {
    services: Array<{ name: string; description: string }>;
    pricingRules: string[];
    faqs: Array<{ question: string; answer: string }>;
  };
  const controlSeed = JSON.parse(
    execFileSync(process.execPath, [path.join(functionsRoot, "scripts/seed-bloomy-web-offer.mjs"), "--dry-run"], { encoding: "utf8" })
  ) as { offer: SeededOffer; knowledgeBase: SeededKnowledgeBase };
  // Offline: --dry-run reads the control on stdin and touches no database.
  const experimentSeed = JSON.parse(
    execFileSync(
      process.execPath,
      [path.join(functionsRoot, "scripts/seed-offer-experiment.mjs"), "--business", "biz_bloomy", "--control", "off_control", "--dry-run"],
      { encoding: "utf8", input: JSON.stringify(controlSeed) }
    )
  ) as { variants: SeededOffer[]; experiment: { id: string; offerIds: string[]; status: string; note: string } };
  const control = controlSeed.offer;
  const [b, c, d] = experimentSeed.variants;
  const all: Array<[string, SeededOffer]> = [["A", control], ["B", b], ["C", c], ["D", d]];
  const ownership = "Le domaine, le code et les contenus restent à votre nom";

  it("keeps the control (A) exactly on the owner-confirmed terms", () => {
    const { termsLine, ...terms } = control.pricingGuardrails;
    expect(terms).toEqual(subscription);
    expect(termsLine).toBe("Notre formule : 0 € de création, puis 49 € HT par mois, engagement 24 mois.");
    expect(control.description).toContain("49 € HT par mois, engagement 24 mois, premier mois réglé à la commande");
  });

  it("writes B, C and D with the owner's terms, and an active experiment listing all four", () => {
    expect(experimentSeed.variants.map((variant) => variant.id)).toEqual([
      "off_biz_bloomy_ab_b",
      "off_biz_bloomy_ab_c",
      "off_biz_bloomy_ab_d"
    ]);
    expect(b.pricingGuardrails).toMatchObject({ setupFee: 0, monthlyPrice: 29, commitmentMonths: 36, taxLabel: "HT", canDiscloseInColdReply: true });
    expect(b.pricingGuardrails.approvedTerms).toEqual([
      "0 € de création", "Création du site offerte", "29 € HT par mois", "Engagement de 36 mois", "Premier mois réglé à la commande", ownership
    ]);
    expect(c.pricingGuardrails).toMatchObject({ setupFee: 490, monthlyPrice: 29, commitmentMonths: 12, startingPrice: 490, taxLabel: "HT", canDiscloseInColdReply: true });
    expect(c.pricingGuardrails.approvedTerms).toEqual([
      "490 € HT de mise en service", "29 € HT par mois", "Engagement de 12 mois", "Mise en service réglée à la commande", ownership
    ]);
    expect(d.pricingGuardrails).toMatchObject({
      pricingModel: "fixed", setupFee: 1490, startingPrice: 1490, monthlyPrice: 15, commitmentMonths: 0, taxLabel: "HT", canDiscloseInColdReply: true
    });
    expect(d.pricingGuardrails.approvedTerms).toEqual([
      "1 490 € HT, site livré", "15 € HT par mois d'hébergement et de maintenance, sans engagement", "Acompte de 30 % à la commande", ownership
    ]);
    // Every first DM of the test states its terms in these exact words (ADR-021).
    expect([b, c, d].map((variant) => variant.pricingGuardrails.termsLine)).toEqual([
      "Notre formule : 0 € de création, puis 29 € HT par mois, engagement 36 mois.",
      "Notre formule : 490 € HT de mise en service, puis 29 € HT par mois, engagement 12 mois.",
      "Notre formule : 1\u00a0490 € HT, site livré, puis 15 € HT par mois d'hébergement et de maintenance, sans engagement."
    ]);
    expect(experimentSeed.experiment).toMatchObject({
      id: "exp_offers_2026_11",
      offerIds: ["off_control", "off_biz_bloomy_ab_b", "off_biz_bloomy_ab_c", "off_biz_bloomy_ab_d"],
      status: "active"
    });
  });

  it("clones everything of the control that is not a price, and none of its price", () => {
    for (const variant of [b, c, d]) {
      expect(variant.targetPersonas).toEqual(control.targetPersonas);
      expect(variant.proofPoints).toEqual(control.proofPoints);
      expect(variant.prohibitedPromises).toEqual(control.prohibitedPromises);
      expect(variant.scoringWeights).toEqual(control.scoringWeights);
      expect(variant.scoringRules).toEqual(control.scoringRules);
      // Own price line first, then the control's figure-free value propositions.
      expect(variant.valuePropositions.slice(1)).toEqual(control.valuePropositions.filter((line) => !/€/.test(line)));
      expect(variant.valuePropositions[0]).not.toEqual(control.valuePropositions[0]);
      expect(JSON.stringify(variant)).not.toContain("49 €");
    }
  });

  it("every offer's quotable text passes its own guardrail (self-consistency)", () => {
    for (const [label, offer] of all) {
      const quotable = [
        offer.name,
        offer.description,
        ...offer.valuePropositions,
        ...offer.proofPoints,
        ...(offer.pricingGuardrails.approvedTerms ?? [])
      ];
      for (const line of quotable) {
        expect(checkPricingStatements(line, offer.pricingGuardrails).violations, `${label}: ${line}`).toEqual([]);
      }
    }
  });

  it("each variant's price line is refused under every other offer's terms (they really differ)", () => {
    for (const [label, offer] of all) {
      for (const [otherLabel, other] of all) {
        if (other === offer) continue;
        expect(passes(offer.valuePropositions[0], other.pricingGuardrails), `${label} under ${otherLabel}`).toBe(false);
      }
    }
  });

  it("the knowledge base states no amount and passes under EVERY offer's terms", () => {
    const kb = controlSeed.knowledgeBase;
    const lines = [
      ...kb.pricingRules,
      ...kb.faqs.flatMap((faq) => [faq.question, faq.answer]),
      ...kb.services.map((service) => service.description)
    ];
    for (const line of lines) {
      expect(extractPrices(line), line).toEqual([]);
      for (const [label, offer] of all) {
        expect(checkPricingStatements(line, offer.pricingGuardrails).violations, `${label}: ${line}`).toEqual([]);
      }
    }
    expect(kb.pricingRules.join(" ")).toContain("sont celles de l'offre présentée à ce prospect");
  });

  it("so the engine withholds nothing from it for any variant", () => {
    const business = { offerExperiment: { ...experimentSeed.experiment, status: "active" as const } };
    for (const [, offer] of all) {
      expect(offerNeutralKnowledgeBase(controlSeed.knowledgeBase, business, offer.pricingGuardrails)).toEqual(controlSeed.knowledgeBase);
    }
  });
});

describe("Phase 19 — the guardrail stays business-agnostic (Invariant 1)", () => {
  it("names no business, trade or offer", () => {
    const source = read("src/services/pricing-guardrail.ts").toLowerCase();
    for (const word of ["bloomy", "devcomm", "fleur", "website", "site internet"]) {
      expect(source).not.toContain(word);
    }
  });
});
