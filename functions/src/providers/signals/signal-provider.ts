import type {
  EvidenceItem,
  EvidenceNature,
  EvidenceSourceType,
  SignalContext,
  SignalProviderId,
  SignalResult
} from "../../types/domain.js";

export type {
  EvidenceItem,
  EvidenceNature,
  EvidenceSourceType,
  SignalContext,
  SignalProviderId,
  SignalResult
};

/**
 * Standard interface that all pluggable signal provider modules must implement
 */
export interface SignalProvider {
  /**
   * Unique identifier of the signal provider (e.g. "company_registry", "google_places")
   */
  readonly id: SignalProviderId | string;

  /**
   * Human-readable display name (e.g. "French Commercial Registry (INPI / INSEE)")
   */
  readonly name: string;

  /**
   * Description of data collected and rationale
   */
  readonly description: string;

  /**
   * List of specific signal capabilities provided (e.g. ["legal_name", "siren", "naf_code", "employee_count"])
   */
  readonly capabilities: string[];

  /**
   * Estimated cost per execution in USD (e.g. 0 for free APIs, 0.001 for Serper Places)
   */
  readonly costPerExecutionUsd: number;

  /**
   * Determines whether this provider can run given the available company context
   */
  supports(context: SignalContext): boolean;

  /**
   * Collects verifiable signals and returns standardized evidence items
   */
  collect(context: SignalContext): Promise<SignalResult>;
}
