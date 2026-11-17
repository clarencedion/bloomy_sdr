import { describe, expect, it, vi } from "vitest";
import { sendApprovedOutreach } from "../../services/send-outreach.js";
import { adminDb } from "../../config/firebase.js";
import * as canContactModule from "../../services/can-contact.js";

describe("Instantly V2 Sequence Dispatch & Conversation Creation (REQ-058 & REQ-062)", () => {
  it("should dispatch lead with custom variables and initialize conversation and outbound message", async () => {
    let leadAddedPayload: any = null;
    let createdConvData: any = null;
    let createdMsgData: any = null;
    let outreachUpdatedData: any = null;

    // Mock global fetch for Instantly API
    const mockFetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (url.includes("/campaign/list")) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: "camp_123", name: "Devcomm Outreach Automation", status: 1 }] })
        };
      }
      if (url.includes("/lead/add")) {
        const body = JSON.parse(opts.body);
        leadAddedPayload = body;
        return {
          ok: true,
          json: async () => ({ leads: [{ id: "instantly_lead_789" }] })
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", mockFetch);

    const mockOutreachRef = {
      set: vi.fn().mockImplementation((data: any) => {
        outreachUpdatedData = data;
        return Promise.resolve();
      })
    };

    // Mock Firestore
    const mockDoc = vi.fn().mockImplementation((pathStr: string) => {
      if (pathStr === "settings/global") {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ dailyOutreachSendLimit: 50, requireApprovalBeforeExport: false })
          })
        };
      }
      if (pathStr === "settings/integrationSecrets") {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ instantlyApiKey: "test_instantly_api_key_v2" })
          })
        };
      }
      if (pathStr === "outreach/outreach_abc") {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: "outreach_abc",
            ref: mockOutreachRef,
            data: () => ({
              id: "outreach_abc",
              companyId: "comp_123",
              contactId: "cont_456",
              status: "approved",
              generatedSubject: "Optimisation de vos processus commerciaux",
              generatedBody: "Bonjour Alice, suite à l'analyse de votre écosystème...",
              followUp1: "Bonjour Alice, je me permets de vous relancer...",
              followUp2: "Bonjour Alice, un dernier mot avant de clore ce dossier...",
              linkedinNote: "Bonjour Alice, ravi d'échanger avec vous.",
              pdfStorageUrl: "https://storage.googleapis.com/test-bucket/pdfs/proposal.pdf",
              approvedBy: "rep_user_99"
            })
          }),
          set: mockOutreachRef.set,
          ref: mockOutreachRef
        };
      }
      if (pathStr === "contacts/cont_456") {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: "cont_456",
            data: () => ({
              id: "cont_456",
              firstName: "Alice",
              lastName: "Dupont",
              email: "alice.dupont@prospect-tech.fr"
            })
          })
        };
      }
      if (pathStr === "companies/comp_123") {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: "comp_123",
            data: () => ({
              id: "comp_123",
              name: "Prospect Tech SAS",
              domain: "prospect-tech.fr"
            })
          }),
          set: vi.fn().mockResolvedValue({})
        };
      }
      if (pathStr.startsWith("conversations/conv_comp_123_cont_456")) {
        return {
          get: vi.fn().mockResolvedValue({ exists: false }),
          set: vi.fn().mockImplementation((data: any) => {
            createdConvData = data;
            return Promise.resolve();
          }),
          collection: vi.fn().mockReturnValue({
            doc: vi.fn().mockReturnValue({
              set: vi.fn().mockImplementation((data: any) => {
                createdMsgData = data;
                return Promise.resolve();
              })
            })
          })
        };
      }
      return {
        get: vi.fn().mockResolvedValue({ exists: false }),
        set: vi.fn().mockResolvedValue({})
      };
    });

    vi.spyOn(adminDb, "doc").mockImplementation(mockDoc as any);
    vi.spyOn(adminDb, "collection").mockImplementation((col: string) => ({
      doc: (id?: string) => mockDoc(`${col}/${id || "auto_id"}`),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      add: vi.fn().mockResolvedValue({ id: "added_id" })
    } as any));

    vi.spyOn(canContactModule, "canContact").mockResolvedValue({ allowed: true });

    const result = await sendApprovedOutreach("outreach_abc");

    expect(result.status).toBe("sent");
    expect(result.leadId).toBe("instantly_lead_789");
    expect(result.conversationId).toBe("conv_comp_123_cont_456");

    // 1. Verify Instantly payload has custom variables
    expect(leadAddedPayload).toBeDefined();
    expect(leadAddedPayload.campaign_id).toBe("camp_123");
    const lead = leadAddedPayload.leads[0];
    expect(lead.email).toBe("alice.dupont@prospect-tech.fr");
    expect(lead.first_name).toBe("Alice");
    expect(lead.last_name).toBe("Dupont");
    expect(lead.company_name).toBe("Prospect Tech SAS");
    expect(lead.custom_subject).toBe("Optimisation de vos processus commerciaux");
    expect(lead.custom_variables.pdfUrl).toBe("https://storage.googleapis.com/test-bucket/pdfs/proposal.pdf");
    expect(lead.custom_pdfUrl).toBe("https://storage.googleapis.com/test-bucket/pdfs/proposal.pdf");

    // 2. Verify Conversation creation (REQ-062)
    expect(createdConvData).toBeDefined();
    expect(createdConvData.id).toBe("conv_comp_123_cont_456");
    expect(createdConvData.status).toBe("sequence_active");
    expect(createdConvData.companyId).toBe("comp_123");
    expect(createdConvData.contactId).toBe("cont_456");
    expect(createdConvData.instantlyLeadId).toBe("instantly_lead_789");
    expect(createdConvData.messageCount).toBe(1);

    // 3. Verify Outbound Message creation
    expect(createdMsgData).toBeDefined();
    expect(createdMsgData.direction).toBe("outbound");
    // Phase 19: the business's own sender, never a hardcoded address. This
    // fixture configures none, so the explicit placeholder is recorded.
    expect(createdMsgData.senderEmail).not.toBe("outreach@devcomm.fr");
    expect(createdMsgData.senderEmail).toBe("sender-not-configured@localhost");
    expect(createdMsgData.recipientEmail).toBe("alice.dupont@prospect-tech.fr");
    expect(createdMsgData.subject).toBe("Optimisation de vos processus commerciaux");

    // 4. Verify Outreach status updated
    expect(outreachUpdatedData.status).toBe("sent");
    expect(outreachUpdatedData.conversationId).toBe("conv_comp_123_cont_456");
    expect(outreachUpdatedData.instantlyLeadId).toBe("instantly_lead_789");

    vi.restoreAllMocks();
  });
});
