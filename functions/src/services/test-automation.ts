import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { runDiscoveryCampaign } from "./run-discovery-campaign.js";
import { researchCompany } from "./research-company.js";
import { enrichCompanyWebsite } from "./company-enrichment.js";
import { findContactsForCompany } from "./contact-discovery.js";
import { generateOutreach } from "./outreach-generation.js";

export async function runFullAutomationTest(campaignId: string, testId: string) {
  const logs: string[] = [];
  
  const updateProgress = async (progress: number, currentStep: string, status: "running" | "completed" | "failed" = "running", extraData?: Record<string, any>) => {
    await adminDb.collection("automationTests").doc(testId).set({
      campaignId,
      progress,
      status,
      currentStep,
      logs,
      updatedAt: Timestamp.now(),
      ...extraData
    }, { merge: true });
  };

  const log = async (msg: string) => {
    logs.push(msg);
    console.log(`[E2E Automation Test] ${msg}`);
    await adminDb.collection("automationTests").doc(testId).set({
      logs,
      updatedAt: Timestamp.now()
    }, { merge: true });
  };

  await updateProgress(0, "Initializing E2E test run...");
  await log(`Starting End-to-End Automation Test for Campaign ID: ${campaignId}`);

  try {
    // Step 1: Run Discovery Campaign to find companies
    await updateProgress(10, "Step 1/5: Running lead discovery...");
    await log("Step 1: Running lead discovery...");
    try {
      const discoveryResult = await runDiscoveryCampaign(campaignId);
      await log(`Discovery run complete. Found ${discoveryResult.companiesFound} companies.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log(`Discovery warning (continuing with existing campaign leads if any): ${msg}`);
    }

    // Find companies that match this campaign
    await updateProgress(25, "Step 1/5: Querying campaign leads...");
    const companiesSnap = await adminDb.collection("companies")
      .where("discoveryCampaignId", "==", campaignId)
      .limit(100)
      .get();

    if (companiesSnap.empty) {
      throw new Error("No companies found or created for this campaign. Adjust your campaign settings (keywords, cities) or check logs.");
    }

    // Sort in JS memory to avoid requiring a composite query index
    const sortedCompanies = companiesSnap.docs
      .map(doc => ({ id: doc.id, ref: doc.ref, data: doc.data() }))
      .sort((a, b) => {
        const left = a.data.createdAt instanceof Timestamp ? a.data.createdAt.toMillis() : 0;
        const right = b.data.createdAt instanceof Timestamp ? b.data.createdAt.toMillis() : 0;
        return right - left;
      });

    // Pick the most recently created company
    const companyItem = sortedCompanies[0];
    const companyId = companyItem.id;
    const companyRef = companyItem.ref;
    const companyData = companyItem.data;
    const companyName = companyData.name;
    await log(`Selected company for E2E flow: "${companyName}" (ID: ${companyId})`);

    // Step 2: AI Research
    await updateProgress(40, `Step 2/5: Performing AI Research on "${companyName}"...`);
    await log(`Step 2: Performing AI Research on "${companyName}"...`);
    // Ensure the company is marked as pending research and qualityScore is high enough
    await companyRef.set({ status: "research_pending", qualityScore: 80, needsResearch: true }, { merge: true });
    const researchResult = await researchCompany(companyId, { force: true });
    if (researchResult.status !== "completed") {
      throw new Error(`AI Research failed: ${researchResult.error ?? "unknown error"}`);
    }
    await log(`AI Research completed successfully. Fit Score: ${researchResult.fitScore}, Confidence: ${researchResult.confidence}%`);

    // Step 3: Website Enrichment & Contact Discovery
    await updateProgress(60, `Step 3/5: Enriching website and looking up contacts...`);
    await log(`Step 3: Enriching website and looking up contacts...`);
    try {
      const enrichmentResult = await enrichCompanyWebsite(companyId);
      await log(`Website enrichment completed. Created ${enrichmentResult.emailsCreated} contacts from website.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log(`Website enrichment skipped or warning: ${msg}`);
    }

    // Run contact discovery via Dropcontact
    await updateProgress(75, `Step 3/5: Running Dropcontact lookup...`);
    await log(`Running Dropcontact lookup...`);
    try {
      const contactDiscoveryResult = await findContactsForCompany(companyId);
      await log(`Dropcontact lookup completed. Found ${contactDiscoveryResult.found} contacts, created ${contactDiscoveryResult.created} in database.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log(`Dropcontact lookup skipped or warning: ${msg}`);
    }

    // Step 4: Outreach Generation
    await updateProgress(85, `Step 4/5: Generating outreach copy...`);
    await log(`Step 4: Generating outreach draft...`);
    // Get contacts
    const contactsSnap = await adminDb.collection("contacts").where("companyId", "==", companyId).get();
    const contacts = contactsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as any);
    
    // Pick the first contact or none
    const targetContact = contacts[0];
    const contactId = targetContact?.id as string | undefined;
    const targetEmail = targetContact?.email as string | undefined;
    if (targetContact) {
      await log(`Target contact selected: ${targetContact.fullName ?? "Unnamed"} <${targetEmail}> (${targetContact.role ?? "no role"})`);
    } else {
      await log(`No individual contacts found. Proceeding with company-level outreach.`);
    }

    // Generate outreach
    const outreachResult = await generateOutreach({
      companyId,
      contactId,
      campaignId,
      force: true
    });
    await log(`Outreach draft generated with ID: ${outreachResult.outreachId}`);

    // Fetch the generated outreach contents
    const outreachSnap = await adminDb.collection("outreach").doc(outreachResult.outreachId).get();
    const outreachData = outreachSnap.data() || {};

    // Step 5: Fake Send Outreach
    await updateProgress(95, `Step 5/5: Simulating outreach send (Fake Send)...`);
    await log(`Step 5: Simulating outreach send (Fake Send)...`);
    const now = Timestamp.now();
    
    await outreachSnap.ref.set({
      status: "sent",
      sentAt: now,
      updatedAt: now,
      lastInteractionAt: now,
      simulated: true,
      simulatedSendLogs: `Simulated E2E automation test send. Targeted: ${targetEmail ?? "Company level"}`
    }, { merge: true });

    await adminDb.collection("companies").doc(companyId).set({
      status: "contacted",
      lastActivityAt: now,
      updatedAt: now
    }, { merge: true });

    await log(`E2E Automation Test complete! Lead status is now 'contacted'.`);

    const resultReport = {
      company: {
        id: companyId,
        name: companyName,
        website: companyData.website || outreachData.rawInput?.company?.website || "",
        domain: companyData.domain || ""
      },
      research: {
        fitScore: researchResult.fitScore,
        confidence: researchResult.confidence,
        summary: outreachData.internalSalesNotes || "E2E research summary completed."
      },
      contact: targetContact ? {
        fullName: targetContact.fullName || "General Contact",
        email: targetEmail || "",
        role: targetContact.role || "General"
      } : null,
      outreach: {
        id: outreachResult.outreachId,
        subject: outreachData.generatedSubject || "",
        body: outreachData.generatedBody || ""
      }
    };

    await updateProgress(100, "Test completed successfully.", "completed", { result: resultReport });

    return { success: true, result: resultReport };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown E2E test error";
    await log(`Error in E2E Pipeline: ${message}`);
    await updateProgress(100, `Test failed: ${message}`, "failed", { error: message });
    throw error;
  }
}
