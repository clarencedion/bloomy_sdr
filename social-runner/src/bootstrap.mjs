/**
 * Binds the compiled SDR backend (functions/lib) to the devcomm-os project.
 *
 * Why this exact order: functions/lib/config/firebase.js calls
 * `initializeApp()` with no project as soon as it loads, and on this machine
 * a project-less init lands on the production CRM (the default ADC project).
 * So the project is pinned and the app initialised first, through the SAME
 * firebase-admin copy functions/lib uses (createRequire from
 * functions/package.json; the runner has no firebase-admin of its own, a
 * second copy would keep a second app registry), and only then is lib loaded.
 *
 * Tests never import this module.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ID = "devcomm-os";
export const FUNCTIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../functions");

for (const key of ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "FIREBASE_PROJECT_ID"]) {
  if (process.env[key] && process.env[key] !== PROJECT_ID) {
    throw new Error(`${key}=${process.env[key]} — refus (doit être ${PROJECT_ID}).`);
  }
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST est défini — refus : le runner travaille sur le vrai projet devcomm-os.");
}
process.env.GOOGLE_CLOUD_PROJECT = process.env.GCLOUD_PROJECT = PROJECT_ID;

/** Resolves modules from functions/node_modules (firebase-admin) and functions/lib. */
export const fnRequire = createRequire(path.join(FUNCTIONS_DIR, "package.json"));

const { initializeApp, applicationDefault, getApps } = fnRequire("firebase-admin/app");
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });

const { adminApp } = fnRequire("./lib/config/firebase.js");
if (adminApp.options.projectId !== PROJECT_ID) {
  throw new Error("functions/lib est lié à une autre application firebase-admin — refus.");
}

/** Loads a compiled backend module, e.g. lib("services/daily-quota.js"). */
export const lib = (rel) => fnRequire(`./lib/${rel}`);
