import { adminDb } from "./config/firebase.js";

async function main() {
  console.log("Fetching collections...");
  const collections = await adminDb.listCollections();
  console.log("Collections:", collections.map(c => c.id));
  
  const snapshot = await adminDb.collection("discoveryCampaigns").get();
  console.log(`Found ${snapshot.size} campaigns`);
  for (const doc of snapshot.docs) {
    console.log("Campaign ID:", doc.id);
    console.log("Campaign Data:", JSON.stringify(doc.data(), null, 2));
  }
}

main().catch(console.error);
