import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import type { SocialNetwork } from "../types/domain.js";

/**
 * Per-business daily usage counters, reserved atomically.
 *
 * The previous limits counted documents by query. That failed three ways at
 * once: the composite indexes were never deployed (an unreadable counter
 * allows the work, so no limit ever applied), research reuses a document
 * created on discovery day so its `createdAt` is not today, and backend-created
 * research documents carried no tenant stamps so a scoped query never matched
 * them. A counter document per business per day has none of those failure
 * modes: one read, no index, and a transaction makes "check then use"
 * atomic under concurrent workers.
 *
 * The day is the Paris calendar day — the day the owner sets a limit for.
 * Server-only collection: the catch-all Firestore rule denies clients.
 */

/**
 * Social DMs are counted per network: Instagram and Facebook restrict
 * accounts independently, so each has its own cap. Replies to a prospect who
 * wrote to us are not counted — they are not cold outreach, and capping them
 * would leave people unanswered.
 */
export type SocialDmQuotaKind = "social_dm_instagram" | "social_dm_facebook";

export type QuotaKind = "research" | "outreach_generation" | SocialDmQuotaKind;

export interface QuotaScope {
  workspaceId?: string;
  businessId?: string;
}

const COLLECTION = "dailyUsage";
/** Usage nobody can be credited with still has a counter of its own. */
export const UNATTRIBUTED_QUOTA_SCOPE = "_unattributed";

export function quotaDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function quotaDocId(scope: QuotaScope, day: string = quotaDay()): string {
  return `${scope.workspaceId || "ws_default"}_${scope.businessId || UNATTRIBUTED_QUOTA_SCOPE}_${day}`;
}

export class DailyQuotaExceededError extends Error {
  constructor(message: string, readonly used: number, readonly limit: number) {
    super(message);
    this.name = "DailyQuotaExceededError";
  }
}

/**
 * Takes one unit of today's quota or throws. `message` builds the error text;
 * callers keep the existing "Daily … limit reached (n/limit)." wording, which
 * the task queue recognises as a deferral rather than a failure.
 */
export async function reserveDailyQuota(
  kind: QuotaKind,
  scope: QuotaScope,
  limit: number,
  message: (used: number, limit: number) => string
): Promise<number> {
  const ref = adminDb.collection(COLLECTION).doc(quotaDocId(scope));
  return adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const used = Number(snap.data()?.[kind] ?? 0);
    if (used >= limit) throw new DailyQuotaExceededError(message(used, limit), used, limit);
    transaction.set(
      ref,
      {
        workspaceId: scope.workspaceId || "ws_default",
        businessId: scope.businessId || UNATTRIBUTED_QUOTA_SCOPE,
        day: quotaDay(),
        [kind]: FieldValue.increment(1),
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );
    return used + 1;
  });
}

/** Units used today, or `null` when the counter cannot be read. */
export async function getDailyUsage(kind: QuotaKind, scope: QuotaScope): Promise<number | null> {
  try {
    const snap = await adminDb.collection(COLLECTION).doc(quotaDocId(scope)).get();
    return Number(snap.data()?.[kind] ?? 0);
  } catch {
    return null;
  }
}

export function socialDmQuotaKind(network: SocialNetwork): SocialDmQuotaKind {
  return network === "instagram" ? "social_dm_instagram" : "social_dm_facebook";
}

/**
 * The per-business document holding the time of the last social DM on each
 * network. Not a day: a day id is "YYYY-MM-DD", so the two never collide.
 */
export function socialPacingDocId(scope: QuotaScope): string {
  return `${scope.workspaceId || "ws_default"}_${scope.businessId || UNATTRIBUTED_QUOTA_SCOPE}_social_last`;
}

export type SocialDmSlot =
  | { ok: true; used: number; cap: number }
  | { ok: false; reason: "daily_cap" | "spacing"; used: number; cap: number; retryInSeconds?: number };

function toMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  // Duck-typed: a Timestamp read back from Firestore exposes toMillis().
  const millis = (value as { toMillis?: () => unknown } | null)?.toMillis?.();
  return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
}

/**
 * Takes one social DM send from today's allowance, or says why not.
 *
 * Cap and spacing are checked and the slot is taken in one transaction, so
 * two sessions running for the same business cannot both slip through the
 * last slot or send back to back. A refusal is an expected outcome (the
 * session waits or stops), so it is returned rather than thrown. Nothing is
 * refunded when a send then fails: over-counting is the safe direction.
 *
 * Spacing is measured from the last send ever reserved, kept in a pacing
 * document of its own: the platforms' rate limits do not reset at midnight,
 * so a send at 23:59:50 still holds the one at 00:00:05 back. Only the cap is
 * per (Paris) day.
 */
export async function reserveSocialDmSlot(
  scope: QuotaScope & { businessId: string },
  network: SocialNetwork,
  limits: { dailyCap: number; minSpacingSeconds: number },
  now: Date = new Date()
): Promise<SocialDmSlot> {
  if (!scope.businessId) throw new Error("A social DM slot belongs to a business.");
  // Limits come from getSocialLimits, which always yields numbers; anything
  // else is a programming error, and silently comparing against NaN would
  // allow every send.
  if (!Number.isFinite(limits.dailyCap) || !Number.isFinite(limits.minSpacingSeconds)) {
    throw new Error("Social DM limits must be finite numbers.");
  }
  const cap = Math.max(0, Math.floor(limits.dailyCap));
  const spacingMs = Math.max(0, limits.minSpacingSeconds) * 1000;

  const kind = socialDmQuotaKind(network);
  const lastAtField = `${kind}LastAt`;
  const day = quotaDay(now);
  const ref = adminDb.collection(COLLECTION).doc(quotaDocId(scope, day));
  const pacingRef = adminDb.collection(COLLECTION).doc(socialPacingDocId(scope));

  return adminDb.runTransaction(async (transaction): Promise<SocialDmSlot> => {
    const snap = await transaction.get(ref);
    const pacingSnap = await transaction.get(pacingRef);
    const data = snap.data() ?? {};
    const used = Number(data[kind] ?? 0);
    if (used >= cap) return { ok: false, reason: "daily_cap", used, cap };

    // The pacing document, or today's counter for a send reserved before the
    // pacing document existed; whichever is later.
    const pacedAt = toMillis(pacingSnap.data()?.[lastAtField]);
    const countedAt = toMillis(data[lastAtField]);
    const lastAt = pacedAt === null ? countedAt : countedAt === null ? pacedAt : Math.max(pacedAt, countedAt);
    if (lastAt !== null && spacingMs > 0) {
      // A clock that moved backwards reads as "just sent": wait, never skip.
      const elapsed = Math.max(0, now.getTime() - lastAt);
      if (elapsed < spacingMs) {
        return {
          ok: false,
          reason: "spacing",
          used,
          cap,
          retryInSeconds: Math.max(1, Math.ceil((spacingMs - elapsed) / 1000))
        };
      }
    }

    transaction.set(
      ref,
      {
        workspaceId: scope.workspaceId || "ws_default",
        businessId: scope.businessId,
        day,
        // The transaction read `used`, so the explicit value is exact.
        [kind]: used + 1,
        [lastAtField]: Timestamp.fromDate(now),
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );
    transaction.set(
      pacingRef,
      {
        workspaceId: scope.workspaceId || "ws_default",
        businessId: scope.businessId,
        [lastAtField]: Timestamp.fromDate(now),
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );
    return { ok: true, used: used + 1, cap };
  });
}

/** Social DMs sent today on one network, or `null` when the counter cannot be read. */
export async function getSocialDmUsage(scope: QuotaScope, network: SocialNetwork): Promise<number | null> {
  return getDailyUsage(socialDmQuotaKind(network), scope);
}
