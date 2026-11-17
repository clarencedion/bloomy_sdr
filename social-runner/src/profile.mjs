/**
 * Where each business's browser profile lives, and the lock check before a
 * launch. No Playwright here, so it is tested offline.
 *
 * The profile holds the Instagram / Facebook session cookies: it is the
 * account's login. It lives outside the repo and outside iCloud-synced
 * folders, readable by the owner only, one folder per business (so nothing
 * business-specific is ever coded) and per browser (Chromium and Chrome must
 * not share one: opening a newer Chrome's profile in the older bundled
 * Chromium is a downgrade that can corrupt it).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PROFILES_ROOT = path.join(os.homedir(), "Library", "Application Support", "devcomm-sdr", "profiles");

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LOCK_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

export function profileDir(businessId, channel, root = PROFILES_ROOT) {
  if (!ID_PATTERN.test(String(businessId))) throw new Error(`Identifiant d'entreprise invalide : ${businessId}`);
  return path.join(root, businessId, channel === "chrome" ? "chrome" : "chromium");
}

/** Chromium's SingletonLock is a symlink to "<hostname>-<pid>". */
export function lockOwnerPid(linkTarget) {
  const match = /-(\d+)$/.exec(String(linkTarget ?? ""));
  return match ? Number(match[1]) : null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error.code === "EPERM";
  }
}

/**
 * Creates the folder (owner-only) and clears a lock left by a crashed run.
 * Refuses when the lock belongs to a live process: the same profile open
 * twice (another runner, or Chrome itself) fails to launch, and killing that
 * browser could lose the session cookies.
 */
export async function prepareProfileDir(dir, { isAlive = isProcessAlive } = {}) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);

  let target;
  try {
    target = await fs.readlink(path.join(dir, "SingletonLock"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const pid = lockOwnerPid(target);
  if (pid === null) {
    throw new Error(`Verrou de profil illisible dans ${dir}. Ferme tout navigateur ouvert sur ce profil, supprime SingletonLock, puis relance.`);
  }
  if (isAlive(pid)) {
    throw new Error(`Ce profil est déjà ouvert (processus ${pid}). Ferme l'autre fenêtre du runner ou de Chrome sur ce profil, puis relance.`);
  }
  for (const name of LOCK_FILES) await fs.rm(path.join(dir, name), { force: true });
}
