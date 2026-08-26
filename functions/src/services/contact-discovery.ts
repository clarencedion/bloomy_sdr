import { runContactWaterfall, type WaterfallOptions } from "./contact-waterfall.js";
import { isJobTitleIrrelevant, IRRELEVANT_ROLE_KEYWORDS } from "./persona-ranker.js";

export { isJobTitleIrrelevant, IRRELEVANT_ROLE_KEYWORDS };

/**
 * Discovers, filters, ranks, and verifies contacts for a company using the multi-provider waterfall.
 */
export async function findContactsForCompany(
  companyId: string,
  options?: WaterfallOptions
): Promise<{
  found: number;
  created: number;
  skipped: number;
  error?: string;
}> {
  const result = await runContactWaterfall(companyId, options);
  return {
    found: result.found,
    created: result.created,
    skipped: result.skipped,
    error: result.error
  };
}
