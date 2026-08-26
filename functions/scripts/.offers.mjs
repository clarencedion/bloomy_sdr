import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: "devcomm-os" });
const db = getFirestore();
const top = await db.collection("offers").limit(5).get();
console.log("top-level /offers docs:", top.size);
const scoped = await db.collection("workspaces/ws_default/businesses/biz_bloomy_studio/offers").get();
console.log("workspace-scoped offers:", scoped.size, "->", scoped.docs.map(d=>d.id).join(", "));
process.exit(0);
