/**
 * Command-line parsing for bin/run.mjs. Pure, so a typo is caught before
 * anything opens a browser or touches Firestore.
 */

export const USAGE = `Usage :
  npm run social:login -- --business <id> --network instagram|facebook [--chrome]
  npm run social:send  -- --business <id> --network instagram|facebook [--max N] [--chrome]
  npm run social:send  -- --business <id> --network instagram --auto [--veto S] [--max N]
      session automatique (Instagram seulement) : chaque premier DM part S secondes après son affichage (S = passer, Q = arrêter)
  npm run social:inbox -- --business <id> --network instagram|facebook [--chrome]
  npm run social:rehearse -- --business <id> --network instagram|facebook [--max N] [--chrome]
      répétition : ouvre les premières conversations de la file, ne tape rien, n'envoie rien
  npm run social:rehearse -- --business <id> --network instagram --type-to <compte sûr>
      test de frappe : tape un vrai DM dans la conversation d'un compte sûr (le tien), vérifie, efface ; jamais Entrée

Options :
  --business <id>     l'entreprise (ex. biz_bloomy)
  --network <réseau>  instagram ou facebook
  --workspace <id>    espace de travail (défaut : ws_default)
  --max <N>           send : nombre maximum de DM envoyés dans la session ; rehearse : prospects visités (défaut 3, max 10)
  --auto              send : envoi sans touche par message, seulement pour les DM que le SDR autorise sans relecture, dans une conversation vierge
  --veto <S>          send --auto : secondes d'affichage avant l'envoi (défaut 10, de 5 à 300)
  --chrome            utiliser Google Chrome installé (profil séparé) au lieu de Chromium`;

export class ArgError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArgError";
  }
}

const COMMANDS = new Set(["login", "send", "inbox", "rehearse"]);
const REHEARSAL_MAX = 10;
const NETWORKS = new Set(["instagram", "facebook"]);
/** Ids become folder names (the browser profile), so they stay plain. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_LIMIT = 500;

/** Automatic sessions: seconds a typed message stays on screen before it leaves. */
export const AUTO_VETO_DEFAULT_SECONDS = 10;
const AUTO_VETO_MIN_SECONDS = 5;
const AUTO_VETO_MAX_SECONDS = 300;

const VALUE_FLAGS = new Set(["business", "network", "workspace", "max", "type-to", "veto"]);
const BOOLEAN_FLAGS = new Set(["chrome", "help", "auto"]);

/**
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{ command: "login" | "send" | "inbox" | "rehearse", workspaceId: string, businessId: string,
 *   network: "instagram" | "facebook", max?: number, auto?: { vetoSeconds: number }, channel?: "chrome", help: boolean }}
 */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    if (BOOLEAN_FLAGS.has(rawName)) {
      if (inlineValue !== undefined) throw new ArgError(`--${rawName} ne prend pas de valeur.`);
      flags[rawName] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(rawName)) throw new ArgError(`Option inconnue : --${rawName}`);
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith("--"))) {
      throw new ArgError(`--${rawName} attend une valeur.`);
    }
    if (inlineValue === undefined) index += 1;
    flags[rawName] = value;
  }

  if (flags.help) return { help: true };

  if (positional.length !== 1 || !COMMANDS.has(positional[0])) {
    throw new ArgError("Commande attendue : login, send, inbox ou rehearse.");
  }
  const command = positional[0];

  if (!flags.business) throw new ArgError("--business est obligatoire.");
  if (!ID_PATTERN.test(flags.business)) throw new ArgError("--business : identifiant invalide (lettres, chiffres, _ et - uniquement).");
  const workspaceId = flags.workspace ?? "ws_default";
  if (!ID_PATTERN.test(workspaceId)) throw new ArgError("--workspace : identifiant invalide (lettres, chiffres, _ et - uniquement).");
  if (!flags.network) throw new ArgError("--network est obligatoire (instagram ou facebook).");
  if (!NETWORKS.has(flags.network)) throw new ArgError("--network : instagram ou facebook.");

  let max;
  if (flags.max !== undefined) {
    if (command !== "send" && command !== "rehearse") throw new ArgError("--max ne s'utilise qu'avec send ou rehearse.");
    const ceiling = command === "rehearse" ? REHEARSAL_MAX : MAX_LIMIT;
    if (!/^\d+$/.test(flags.max) || Number(flags.max) < 1 || Number(flags.max) > ceiling) {
      throw new ArgError(`--max : un entier entre 1 et ${ceiling}.`);
    }
    max = Number(flags.max);
  }

  let typeTo;
  if (flags["type-to"] !== undefined) {
    if (command !== "rehearse") throw new ArgError("--type-to ne s'utilise qu'avec rehearse.");
    const handle = String(flags["type-to"]).replace(/^@/, "");
    if (!/^[A-Za-z0-9._-]{1,50}$/.test(handle)) throw new ArgError("--type-to : un nom de compte (ex. bloomy.studio).");
    typeTo = handle;
  }

  // Only first DMs can be automatic: replies (inbox) always wait for a key.
  if (flags.auto && command !== "send") throw new ArgError("--auto ne s'utilise qu'avec send.");
  let auto;
  if (flags.veto !== undefined) {
    if (!flags.auto) throw new ArgError("--veto ne s'utilise qu'avec send --auto.");
    if (!/^\d+$/.test(flags.veto) || Number(flags.veto) < AUTO_VETO_MIN_SECONDS || Number(flags.veto) > AUTO_VETO_MAX_SECONDS) {
      throw new ArgError(`--veto : un entier entre ${AUTO_VETO_MIN_SECONDS} et ${AUTO_VETO_MAX_SECONDS} (secondes).`);
    }
  }
  if (flags.auto) auto = { vetoSeconds: flags.veto !== undefined ? Number(flags.veto) : AUTO_VETO_DEFAULT_SECONDS };

  return {
    command,
    workspaceId,
    businessId: flags.business,
    network: flags.network,
    max,
    ...(auto ? { auto } : {}),
    ...(typeTo ? { typeTo } : {}),
    channel: flags.chrome ? "chrome" : undefined,
    help: false
  };
}
