import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export const adminApp = getApps().length ? getApps()[0] : initializeApp();
export const adminDb = getFirestore(adminApp);
adminDb.settings({ ignoreUndefinedProperties: true });
export const adminStorage = getStorage(adminApp);
