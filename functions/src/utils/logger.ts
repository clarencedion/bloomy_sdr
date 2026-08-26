import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";

export type LogLevel = "debug" | "info" | "warning" | "error";

/** Single-workspace deployments still need an explicit scope on every log. */
const DEFAULT_WORKSPACE_ID = "ws_default";

export async function writeLog(input: {
  type: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  workspaceId?: string;
  businessId?: string;
}) {
  // Logs must be tenant-scoped so the SDR activity feed can query them without
  // reading another workspace's events. Many call sites already carry the
  // context inside `metadata`, so hoist it rather than making every caller
  // pass it twice.
  const workspaceId =
    input.workspaceId ??
    (typeof input.metadata?.workspaceId === "string" ? input.metadata.workspaceId : undefined);
  const businessId =
    input.businessId ??
    (typeof input.metadata?.businessId === "string" ? input.metadata.businessId : undefined);

  await adminDb.collection("logs").add({
    ...stripUndefined(input),
    workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    ...(businessId ? { businessId } : {}),
    createdAt: Timestamp.now()
  });
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)).filter((item) => item !== undefined) as T;
  }
  if (value && typeof value === "object" && !(value instanceof Timestamp)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)])
    ) as T;
  }
  return value;
}
