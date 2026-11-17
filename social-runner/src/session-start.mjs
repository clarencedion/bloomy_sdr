/**
 * The start of a send or inbox session, before any prospect is opened.
 *
 *  1. The network's home page: a login wall or checkpoint stops right here.
 *  2. A signed-in session, or the operator is sent back to `social:login`.
 *  3. Which account the window acts as. When the business has its account in
 *     its settings (business.socialAccounts) and the window shows another
 *     one, the session refuses: DMs from the owner's personal profile would
 *     be recorded as the business's, and their replies would land elsewhere.
 *  4. The operator confirms the account with an explicit "O", from the
 *     terminal. That key is also the moment to bring the terminal back to the
 *     front: a key typed in the browser window goes to the page (an Enter
 *     there would send a message), which is why it is said here.
 *
 * Takes everything through `ctx` like the session machines, so it is tested
 * with the mock driver and scripted keys.
 */
import { displayIdentity, identityMatches } from "./identity.mjs";
import { STOP } from "./session-machine.mjs";

const NETWORK_LABELS = { instagram: "Instagram", facebook: "Facebook" };

export const FOCUS_REMINDER =
  "Clique maintenant dans CE terminal et garde-le au premier plan pendant toute la session : une touche tapée dans la fenêtre du navigateur part sur la page (Entrée y enverrait le message).";

/**
 * @param {{ page: any, driver: any, keys: any, ui: any }} ctx
 * @param {{ network: "instagram" | "facebook", businessName: string, expected?: string }} options
 *   `expected`: the business's configured account (Instagram username or Facebook Page name).
 * @returns {Promise<{ ok: true, identity?: string } | { ok: false, reason: string, blocker?: object }>}
 */
export async function prepareSession(ctx, { network, businessName, expected }) {
  const { page, driver, keys, ui } = ctx;
  const label = NETWORK_LABELS[network] ?? network;

  const home = await driver.openHome(page);
  if (!home.ok) return { ok: false, reason: `blocked:${home.reason.kind}`, blocker: home.reason };
  if (!(await driver.isLoggedIn(page))) {
    ui.error(`La fenêtre n'est pas connectée à ${label} : lance « npm run social:login » pour cette entreprise, puis relance.`);
    return { ok: false, reason: "not_logged_in" };
  }

  let detected;
  try {
    detected = await driver.activeIdentity(page);
  } catch {
    detected = undefined;
  }
  if (expected && detected && !identityMatches(detected, expected)) {
    ui.error(
      `La fenêtre agit en tant que ${displayIdentity(network, detected)}, mais ${businessName} est réglée sur ${displayIdentity(network, expected)} : refus. Connecte le bon compte (${network === "facebook" ? "bascule sur le profil de la Page" : "npm run social:login"}), ou corrige le compte dans les réglages de l'entreprise.`
    );
    return { ok: false, reason: "wrong_account" };
  }

  if (detected) {
    ui.info(`Compte connecté dans la fenêtre : ${displayIdentity(network, detected)}${expected ? " (conforme aux réglages de l'entreprise)" : ""}.`);
  } else {
    ui.warn(
      `Je ne peux pas lire le compte connecté dans la fenêtre${expected ? ` ; ce doit être ${displayIdentity(network, expected)}` : ""}. Vérifie-le dans la fenêtre avant de continuer.`
    );
  }
  if (network === "facebook") {
    ui.info("Sur Facebook, les messages partent au nom du profil actif : ce doit être la Page de l'entreprise, pas un profil personnel.");
  }
  ui.warn(FOCUS_REMINDER);
  ui.keysHint(["o", "q"], { o: `O = c'est bien le compte de ${businessName}` });
  const key = await keys.prompt(["o", "q"]);
  if (key !== "o") return { ok: false, reason: STOP.OPERATOR };
  return { ok: true, identity: detected };
}
