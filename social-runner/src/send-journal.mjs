/**
 * The pending-send journal: a local note written BEFORE a send key acts and
 * removed once the SDR has recorded that send.
 *
 * Nothing durable used to exist between the operator's Enter and the record.
 * A force quit, a closed terminal, a crash or an SDR outage in that window
 * left the draft unlocked and queued again, and the next session offered the
 * same company a second first DM. The journal closes that window: an entry
 * still on disk at the next start means "this may have left". The session
 * then records it as unverified (never sends it again) and keeps it out of the
 * queue.
 *
 * One small JSON file per send, written synchronously and fsync'ed, then
 * renamed into place, so an exit at any instant leaves either no entry or a
 * whole one. The folder (social-runner/.state/) is git-ignored and holds only
 * our own message texts and record ids, never credentials.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_JOURNAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".state", "pending-sends");

const ENTRY_FILE = /^pending-[A-Za-z0-9-]+\.json$/;

/** A short, stable fingerprint of a message (for logs and the operator, not for security). */
export function textHash(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex").slice(0, 16);
}

function writeDurably(file, content) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/**
 * @param {{ dir?: string, now?: () => number }} [options]
 */
export function createSendJournal({ dir = DEFAULT_JOURNAL_DIR, now = Date.now } = {}) {
  const fileOf = (id) => path.join(dir, `pending-${id}.json`);

  return {
    dir,

    /**
     * Notes a send about to happen. Synchronous on purpose: it must be on disk
     * before the key reaches the page. Returns the entry id.
     *
     * @param {{ kind: "first_dm" | "reply", network: string, workspaceId?: string, businessId?: string,
     *   companyName?: string, outreachId?: string, conversationId?: string, text: string,
     *   record: Record<string, unknown> }} entry
     *   `record` is the input of the SDR call that records this send
     *   (recordSocialDmSent / recordSocialReplySent), without `verified`.
     */
    begin(entry) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const id = randomUUID();
      const content = {
        id,
        version: 1,
        at: new Date(now()).toISOString(),
        textHash: textHash(entry.text),
        ...entry
      };
      writeDurably(fileOf(id), JSON.stringify(content, null, 2));
      return id;
    },

    /** The send is recorded in the SDR: forget it. */
    settle(id) {
      if (!id) return;
      try {
        fs.rmSync(fileOf(id), { force: true });
      } catch {
        // A leftover entry is replayed (idempotently) at the next start.
      }
    },

    /** Entries left by sessions that did not get to record their send, oldest first. */
    pending() {
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
      const entries = [];
      for (const name of names) {
        if (!ENTRY_FILE.test(name)) continue;
        try {
          const entry = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
          if (entry && typeof entry.id === "string" && entry.record && typeof entry.record === "object") entries.push(entry);
        } catch {
          // A torn write never reaches this name (rename is atomic); anything
          // else unreadable is left for a person to look at.
        }
      }
      return entries.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    }
  };
}

/**
 * Records every leftover entry as an unverified send. Never sends anything.
 *
 * @returns {Promise<{ replayed: object[], failed: Array<{ entry: object, error: string }>, outreachIds: Set<string>, conversationIds: Set<string> }>}
 *   `outreachIds` / `conversationIds`: every id still or just journaled, to
 *   keep out of this session's queue whatever the replay outcome.
 */
export async function replayPendingSends({ journal, sdr, ui }) {
  const result = { replayed: [], failed: [], outreachIds: new Set(), conversationIds: new Set() };
  const entries = journal.pending();
  if (!entries.length) return result;

  ui.warn(
    `${entries.length} envoi(s) d'une session précédente n'ont pas été enregistrés (arrêt forcé, terminal fermé ou SDR injoignable). Je les enregistre « à vérifier », sans rien renvoyer.`
  );
  for (const entry of entries) {
    if (entry.outreachId) result.outreachIds.add(entry.outreachId);
    if (entry.conversationId) result.conversationIds.add(entry.conversationId);
    try {
      if (entry.kind === "first_dm") {
        await sdr.recordSocialDmSent({ ...entry.record, verified: false });
      } else if (entry.kind === "reply") {
        await sdr.recordSocialReplySent({ ...entry.record, verified: false });
      } else {
        throw new Error(`type d'envoi inconnu (${String(entry.kind)})`);
      }
      journal.settle(entry.id);
      result.replayed.push(entry);
      ui.info(`  ${entry.companyName || entry.outreachId || entry.conversationId} : enregistré, à vérifier dans la conversation.`);
    } catch (error) {
      const message = String(error?.message ?? error).split("\n")[0].slice(0, 200);
      result.failed.push({ entry, error: message });
      ui.error(
        `  ${entry.companyName || entry.outreachId || entry.conversationId} : toujours NON enregistré (${message}). Ce prospect est tenu hors de la file ; vérifie-le dans le SDR. Note : ${path.join(journal.dir, `pending-${entry.id}.json`)}`
      );
    }
  }
  return result;
}
