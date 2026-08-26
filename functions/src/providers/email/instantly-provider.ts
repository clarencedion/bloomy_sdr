const BASE_URL = "https://api.instantly.ai/api/v1";

export type InstantlyLead = {
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  customVariables?: Record<string, string>;
};

export type InstantlyLeadStatus = {
  email: string;
  status?: string;
  replied?: boolean;
  bounced?: boolean;
};

export class InstantlyProvider {
  readonly name = "instantly";

  constructor(private readonly apiKey: string) {}

  async listCampaigns(): Promise<Array<{ id: string; name: string; status: number }>> {
    const res = await this.get("/campaign/list?limit=100&skip=0");
    return (res.data ?? []) as Array<{ id: string; name: string; status: number }>;
  }

  async findOrCreateCampaign(name: string): Promise<string> {
    const campaigns = await this.listCampaigns();
    const existing = campaigns.find((c) => c.name === name);
    if (existing) return existing.id;
    const res = await this.post("/campaign/create", { name });
    return String(res.id ?? res.campaign_id ?? "");
  }

  async addLead(campaignId: string, lead: InstantlyLead): Promise<{ leadId?: string }> {
    const payload = {
      campaign_id: campaignId,
      leads: [
        {
          email: lead.email,
          first_name: lead.firstName,
          last_name: lead.lastName,
          company_name: lead.companyName,
          custom_variables: lead.customVariables ?? {},
          ...flattenCustomVariables(lead.customVariables)
        }
      ],
      skip_if_in_workspace: true
    };
    const res = await this.post("/lead/add", payload);
    const leads = res.leads as Array<Record<string, unknown>> | undefined;
    return { leadId: typeof leads?.[0]?.id === "string" ? (leads[0].id as string) : undefined };
  }

  async getLeadStatus(email: string): Promise<InstantlyLeadStatus> {
    const res = await this.get(`/lead/get?email=${encodeURIComponent(email)}`);
    const replyData = res.reply_data as Record<string, unknown> | undefined;
    return {
      email,
      status: typeof res.status === "string" ? res.status : undefined,
      replied: Boolean(replyData?.replied),
      bounced: res.status === "Bounced"
    };
  }


  async pauseLead(email: string): Promise<boolean> {
    try {
      await this.post("/lead/pause", { email });
      return true;
    } catch {
      return false;
    }
  }

  async deleteLead(campaignId: string, email: string): Promise<boolean> {
    try {
      await this.post("/lead/delete", { campaign_id: campaignId, email });
      return true;
    } catch {
      return false;
    }
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${BASE_URL}${path}${sep}api_key=${encodeURIComponent(this.apiKey)}`, {
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Instantly GET ${path} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${BASE_URL}${path}?api_key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Instantly POST ${path} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  }
}

function flattenCustomVariables(vars?: Record<string, string>): Record<string, string> {
  if (!vars) return {};
  return Object.fromEntries(Object.entries(vars).map(([key, value]) => [`custom_${key}`, value]));
}
