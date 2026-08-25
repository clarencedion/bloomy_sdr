import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";

export type LogLevel = "debug" | "info" | "warning" | "error";

export async function writeLog(input: {
  type: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  await adminDb.collection("logs").add({
    ...stripUndefined(input),
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
