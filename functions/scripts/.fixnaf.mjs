import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: "devcomm-os" });
const db = getFirestore();
const CAMPAIGN = "OS7TyLk8Fstb2DCkU8HJ";
const ref = db.doc(`discoveryCampaigns/${CAMPAIGN}`);
const before = (await ref.get()).data();
console.log("before nafCodes:", JSON.stringify(before.nafCodes));
// 82.11Z = "Services administratifs combinés de bureau" (office admin) — wrong.
// 9602A = "Coiffure" — what this campaign actually targets.
await ref.update({ nafCodes: ["9602A"], updatedAt: Timestamp.now() });
console.log("after  nafCodes:", JSON.stringify((await ref.get()).data().nafCodes));
process.exit(0);
