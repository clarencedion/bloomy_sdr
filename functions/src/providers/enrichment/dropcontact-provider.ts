import type { EnrichedContact, EnrichmentProvider } from "./enrichment-provider.js";

const BASE_URL = "https://api.dropcontact.com/v1/enrich/all";
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 20;

type BatchSubmitResponse = {
  request_id?: string;
  error?: boolean | string;
  reason?: string;
  credits_left?: number;
};

type BatchResultContact = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  civility?: string;
  job?: string;
  job_title?: string;
  lead_confidence?: number;
  email?: Array<{ email: string; qualification: string }> | string;
  phone?: Array<{ number: string }> | string;
};

type BatchResultResponse = {
  success?: boolean;
  completed?: boolean;
  error?: boolean | string;
  data?: BatchResultContact[];
};

export class DropcontactProvider implements EnrichmentProvider {
  readonly name = "dropcontact";

  constructor(private readonly apiKey: string) {}

  async findContactsForCompany(input: {
    companyName: string;
    domain?: string;
    siren?: string;
    siret?: string;
  }): Promise<EnrichedContact[]> {
    const requestId = await this.submitBatch(input);
    const results = await this.pollForResults(requestId);
    return results.map((item) => this.mapContact(item));
  }

  private async submitBatch(input: { companyName: string; domain?: string; siren?: string; siret?: string }): Promise<string> {
    const payload = {
      data: [
        {
          company: input.companyName,
          ...(input.domain ? { website: input.domain } : {}),
          ...(input.siren ? { num_siren: input.siren } : {}),
          ...(input.siret ? { num_siret: input.siret } : {})
        }
      ],
      siren: Boolean(input.siren),
      language: "fr"
    };

    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Token": this.apiKey
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dropcontact batch submit failed (${res.status}): ${text}`);
    }

    const data = await res.json() as BatchSubmitResponse;

    if (data.error) {
      throw new Error(`Dropcontact error: ${data.reason ?? String(data.error)}`);
    }

    if (!data.request_id) {
      throw new Error("Dropcontact returned no request_id.");
    }

    return data.request_id;
  }

  private async pollForResults(requestId: string): Promise<BatchResultContact[]> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const res = await fetch(`${BASE_URL}/${requestId}`, {
        headers: { "X-Access-Token": this.apiKey },
        signal: AbortSignal.timeout(10000)
      });

      console.log(`Dropcontact polling attempt ${attempt + 1}/${POLL_MAX_ATTEMPTS} for request_id: ${requestId}. Status: ${res.status}`);

      if (!res.ok) {
        console.warn(`Dropcontact poll returned non-ok status: ${res.status}`);
        continue;
      }

      const data = await res.json() as BatchResultResponse;
      console.log(`Dropcontact response data for request_id ${requestId}:`, JSON.stringify(data));

      if (data.error) throw new Error(`Dropcontact poll error: ${String(data.error)}`);
      if (data.success && data.data) return data.data;
    }

    throw new Error(`Dropcontact results not ready after ${POLL_MAX_ATTEMPTS} attempts.`);
  }

  private mapContact(item: BatchResultContact): EnrichedContact {
    const emailEntry = Array.isArray(item.email) ? item.email[0] : undefined;
    const emailStr = typeof item.email === "string" ? item.email : emailEntry?.email;
    const qualification = emailEntry?.qualification?.toLowerCase();
    const emailQualification: EnrichedContact["emailQualification"] =
      qualification === "verified" ? "verified" :
      qualification === "guessed" ? "guessed" : "uncertain";

    const phoneEntry = Array.isArray(item.phone) ? item.phone[0] : undefined;
    const phoneStr = typeof item.phone === "string" ? item.phone : phoneEntry?.number;

    return {
      firstName: item.first_name,
      lastName: item.last_name,
      fullName: item.full_name,
      email: emailStr,
      emailQualification: emailStr ? emailQualification : undefined,
      phone: phoneStr,
      jobTitle: item.job ?? item.job_title,
      civility: item.civility,
      confidence: item.lead_confidence,
      source: "dropcontact"
    };
  }
}
