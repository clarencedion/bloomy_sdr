/**
 * Facebook / Messenger: every URL, label and selector the runner relies on.
 *
 * On a Page, "Message" opens a Messenger chat window on top of the page. Those
 * windows survive navigation, so the driver closes it after each prospect
 * (`closeChatButton`); if one is still open when the next prospect starts, the
 * session stops rather than risk typing into the previous prospect's chat.
 */
import { facebookIdentityFromSnapshot } from "../identity.mjs";
import { createWebDmDriver } from "./web-dm-driver.mjs";

export const FACEBOOK_CONFIG = {
  network: "facebook",
  homeUrl: "https://www.facebook.com/",
  inboxUrl: "https://www.facebook.com/messages/",
  messageButton: /^(Message|Envoyer un message|Contacter)$/i,
  /**
   * The chat composer. Anchored at the start: an unanchored "Aa" would also
   * match the post composer ("Quoi de neuf, Isaac ?").
   */
  composer: (page) => page.getByRole("textbox", { name: /^(?:Écrire un message|Ecrire un message|Message|Aa)(?![a-zà-ÿ])/i }),
  closeChatButton: /^(Close chat|Fermer la discussion)$/i,
  notFoundText: /(This content isn.t available|Ce contenu n.est pas disponible|This page isn.t available|Cette page n.est pas disponible)/i,
  loggedInMarker: (page) => page.locator('[aria-label="Messenger"], a[href*="/messages/"]'),
  /** The profile or Page the window acts as: the left column's first profile shortcut (see identity.mjs). */
  identityFromSnapshot: facebookIdentityFromSnapshot,
  threadListSelectors: ['[aria-label="Chats"]', '[aria-label="Discussions"]'],
  conversationPaneSelectors: ['[aria-label^="Messages in conversation"]', '[aria-label^="Messages dans la conversation"]', 'main, [role="main"]']
};

export function createFacebookDriver() {
  return createWebDmDriver(FACEBOOK_CONFIG);
}
