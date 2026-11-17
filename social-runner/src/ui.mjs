/**
 * The runner's terminal output, in French, kept short.
 *
 * Company names, drafts, prospect messages, model-written reasons and error
 * messages are untrusted text. Every helper strips control characters from
 * what it is given before printing, so a message carrying terminal escape
 * sequences cannot repaint the screen (and, say, show one draft while another
 * sits in the composer). Colours are added after that, by this module only.
 */

import { BLOCKER_LABELS_FR } from "./blockers.mjs";
import { stripControlChars } from "./composer.mjs";

const ESC = String.fromCharCode(27);

const KEY_LABELS = {
  enter: "Entrée = envoyer",
  e: "E = modifier",
  r: "R = autre proposition",
  s: "S = passer",
  q: "Q = arrêter",
  n: "N = revenir",
  o: "O = oui"
};

const NETWORK_LABELS = { instagram: "Instagram", facebook: "Facebook" };

/**
 * @param {{ out?: NodeJS.WriteStream, color?: boolean, log?: (line: string) => void }} [options]
 *   `log` receives every line shown, without colours (the session's log file);
 *   the countdown, which rewrites one line every second, is not logged.
 */
export function createUi({ out = process.stdout, color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR, log } = {}) {
  const paint = (code) => (text) => (color ? `${ESC}[${code}m${text}${ESC}[0m` : String(text));
  const red = paint("31");
  const amber = paint("33");
  const green = paint("32");
  const dim = paint("2");
  const bold = paint("1");

  const colours = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
  const print = (text = "") => {
    out.write(`${text}\n`);
    // A log that cannot be written must never stop a session.
    try {
      log?.(String(text).replace(colours, ""));
    } catch {
      // Ignored on purpose.
    }
  };
  const clean = (text) => stripControlChars(text);
  const indent = (text) =>
    clean(text)
      .split(/\r\n|\r|\n/)
      .map((line) => `    ${line}`)
      .join("\n");

  return {
    title: (text) => print(`\n${bold(clean(text))}`),
    info: (text) => print(`  ${clean(text)}`),
    ok: (text) => print(`  ${green(clean(text))}`),
    warn: (text) => print(`  ${amber(clean(text))}`),
    error: (text) => print(`  ${red(clean(text))}`),

    item({ index, total, companyName, network, profileUrl }) {
      print(`\n${bold(`[${index + 1}/${total}] ${stripControlChars(companyName)}`)} ${dim(`— ${NETWORK_LABELS[network] ?? network} ${stripControlChars(profileUrl)}`)}`);
    },

    thread({ companyName, handle, network }) {
      print(`\n${bold(stripControlChars(companyName))} ${dim(`— ${NETWORK_LABELS[network] ?? network} @${stripControlChars(handle)}`)}`);
    },

    prospectMessages(texts) {
      print(dim("  Message(s) du prospect :"));
      for (const text of texts) print(indent(text));
    },

    message({ text, edited, typed, pricingGuardrailPassed, mentionsCommercialTerms, warnings }) {
      print(dim(edited ? "  Texte (modifié par toi) :" : "  Texte proposé :"));
      print(indent(text));
      if (pricingGuardrailPassed === false) {
        print(red(`  ATTENTION : contrôle des prix en échec${edited ? " (sur le texte d'origine, pas relancé après modification)" : ""}. Vérifie chaque montant.`));
      }
      if (mentionsCommercialTerms) {
        print(amber("  Parle de conditions commerciales (prix, gratuité, engagement) : relis avant d'envoyer."));
      }
      for (const warning of warnings ?? []) print(amber(`  • ${stripControlChars(warning)}`));
      if (!typed) {
        print(red("  Le texte du champ ne correspond pas à l'aperçu : E pour le retaper, S pour passer."));
      }
    },

    /** `labels` overrides a key's label for this prompt (e.g. O = "envoyer quand même"). */
    keysHint(choices, labels = {}) {
      print(dim(`  ${clean(choices.map((choice) => labels[choice] ?? KEY_LABELS[choice] ?? choice).join("   "))}`));
    },

    /** Rewrites one line in place; 0 clears it. */
    countdown(secondsLeft) {
      if (secondsLeft > 0) out.write(`\r  ${dim(`envoi dans ${secondsLeft} s  `)}`);
      else out.write(`\r${" ".repeat(40)}\r`);
    },

    blocker(blocker) {
      print(red(`\n  ARRÊT — ${BLOCKER_LABELS_FR[blocker.kind] ?? clean(blocker.kind)} [${clean(blocker.detail)}]`));
      print("  Règle-le toi-même dans la fenêtre du navigateur (le runner ne contourne jamais ces pages), puis relance plus tard.");
    },

    summary(lines) {
      print(`\n${bold("Bilan")}`);
      for (const line of lines) print(`  ${clean(line)}`);
    }
  };
}
