/**
 * Instagram: every URL, label and selector the runner relies on.
 *
 * Labels follow the account's interface language, so each pattern covers the
 * French and English wording. If Instagram renames something, the prospect
 * is set aside with a reason ("no_message_button", "no_composer") rather than
 * clicked around, and three such prospects in a row stop the session
 * (session-machine.mjs); update the pattern here.
 */
import { instagramIdentityFromSnapshot } from "../identity.mjs";
import { createWebDmDriver } from "./web-dm-driver.mjs";

export const INSTAGRAM_CONFIG = {
  network: "instagram",
  homeUrl: "https://www.instagram.com/",
  inboxUrl: "https://www.instagram.com/direct/inbox/",
  /**
   * The profile's "Message" button (a div with role=button on the web app).
   * Since 2026 a professional account's profile shows "Contacter" instead; it
   * opens the same chat window (checked live on 2026-11-10).
   */
  messageButton: /^(Message|Envoyer un message|Contacter|Contact)$/i,
  /** The chat window's close button ("Fermer"), next to "Développer" and "Retour". */
  closeChatButton: /^(Fermer|Close)$/i,
  /**
   * The chat window's header links to the profile it writes to ("Ouvrir la
   * page de profil de <handle>"): the conversation must be the prospect's.
   */
  recipientLinks: (page) => page.getByRole("link", { name: /(page de profil de|profile page of|profile of)/i }),
  /** Direct's composer: labelled "Message…" / "Votre message…"; the bare contenteditable is the fallback. */
  composer: (page) =>
    page.getByRole("textbox", { name: /Message/i }).or(page.locator('[contenteditable="true"][role="textbox"]')),
  notFoundText: /(Sorry, this page isn.t available|Cette page n.est pas disponible)/i,
  privateText: /(This account is private|Ce compte est privé)/i,
  /** Only a signed-in session has a link to Direct. */
  loggedInMarker: (page) => page.locator('a[href^="/direct/inbox"]'),
  /** The logged-in username: the navigation's "Profil" link (see identity.mjs). */
  identityFromSnapshot: instagramIdentityFromSnapshot,
  /**
   * What a NEW conversation's chat window shows and nothing more (read live
   * on 2026-11-11, French interface, three prospects): the header (back,
   * expand, close), the recipient's display name twice, "Vérifié" twice on a
   * verified account, the intro card ("<handle> · Instagram", "Voir profil")
   * and the composer's own buttons. `classifyThread` (common.mjs) uses it so
   * an automatic session never writes a "first" message into a conversation
   * that already has one.
   *
   * One interface language at a time: the window is read with the labels of
   * the language its header is in, so a previous message that reads like a
   * label of the OTHER language ("Close" in a French window) is still seen.
   * The English labels are the same strings in the English interface,
   * unverified: a wrong one only makes the check say "not new", never "new".
   */
  emptyThread: {
    recipientLabel: "(page de profil de|profile page of|profile of)",
    handleLine: (handle) => new RegExp(`^${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · instagram$`),
    interfaces: [
      {
        /** Always there, once each: they tell which language the window is in. */
        header: ["Retour", "Développer", "Fermer"],
        labels: ["Voir profil", "Voir le profil", "Choisir un emoji", "Votre message…", "Clip vocal", "Ajouter une photo ou une vidéo", "Choisir un GIF ou un sticker"],
        /** On a verified account, in the header and on the intro card: both or neither. */
        verified: "Vérifié",
        /**
         * Added by the interface once the composer holds text. Read live on
         * 2026-11-11: the French interface's send button reads "Send".
         */
        typingLabels: ["Send", "Envoyer"]
      },
      {
        header: ["Back", "Expand", "Close"],
        labels: ["View profile", "Choose an emoji", "Message...", "Message…", "Voice clip", "Add Photo or Video", "Choose a GIF or sticker"],
        verified: "Verified",
        typingLabels: ["Send"]
      }
    ],
    roles: ["button", "img", "link", "textbox"],
    /** The recipient's avatar, in the header and on the intro card. */
    maxImages: 2
  },
  threadListSelectors: ['[aria-label="Thread list"]', '[aria-label="Liste des fils de discussion"]'],
  conversationPaneSelectors: ['[aria-label^="Messages in conversation"]', '[aria-label^="Messages dans la conversation"]', 'main, [role="main"]']
};

export function createInstagramDriver() {
  return createWebDmDriver(INSTAGRAM_CONFIG);
}
