/**
 * Typing into, reading back and sending from a DM composer.
 *
 * The one trap this module exists to avoid: Playwright turns "\n" and "\r"
 * into the Enter key, and Enter sends the message in both the Instagram and
 * Messenger composers. Typing a multi-line draft with `keyboard.type` or
 * `pressSequentially` would therefore send its first line before the human
 * approved anything. So each line goes in through `insertText` (which fires an
 * input event, never a key) and line breaks are `Shift+Enter`.
 *
 * Nothing here decides to send. `sendFromComposer` is called by the session
 * machine only after the operator's Enter for that very message.
 */

/** Line terminators of every flavour, so a stray "\r" can never reach the page. */
const LINE_BREAK = /\r\n|\r|\n/;

/** Zero-width characters some editors insert around text. */
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/g;

/**
 * The comparison form of a message: NFC, zero-width characters dropped, every
 * whitespace run (line breaks and non-breaking spaces included) collapsed.
 *
 * Line breaks are collapsed on purpose. Rich-text composers read back with
 * one or two "\n" per paragraph depending on their markup, so only the words
 * and their order are compared.
 */
export function normaliseForCompare(text) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(ZERO_WIDTH, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** C0/C1 control characters, except tab (0x09) and line feed (0x0a). */
function isControl(char) {
  const code = char.charCodeAt(0);
  return code <= 0x08 || (code >= 0x0b && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
}

/**
 * Drafts are model output that may echo prospect text, so control characters
 * (terminal escape sequences included) are removed before a message is shown
 * or typed: what the operator reads is exactly what goes into the composer.
 * Windows and old-Mac line endings become "\n".
 */
export function stripControlChars(text) {
  return Array.from(String(text ?? "").replace(/\r\n|\r/g, "\n"))
    .filter((char) => !isControl(char))
    .join("");
}

/** PURE: does what the composer holds equal what we meant to type? */
export function composerMatches(actual, expected) {
  return normaliseForCompare(actual) === normaliseForCompare(expected);
}

/** Splits a message into the lines typed one by one. Empty lines are kept (blank line = paragraph). */
export function splitLines(text) {
  return String(text ?? "").split(LINE_BREAK);
}

/** The composer's current text, or "" when it cannot be read. */
export async function readComposer(composerLocator) {
  try {
    return await composerLocator.innerText({ timeout: 5000 });
  } catch {
    return "";
  }
}

/**
 * Empties the composer: focus, select all, delete.
 * Returns true when it reads back empty.
 */
export async function clearComposer(page, composerLocator) {
  try {
    await composerLocator.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
  } catch {
    // The composer may be gone (navigation, closed chat). Nothing to clear then.
  }
  return normaliseForCompare(await readComposer(composerLocator)) === "";
}

/**
 * Types `text` into the composer without ever producing an Enter key.
 * Leftover text (an unsent draft Meta restored) is cleared first so the
 * composer ends up holding exactly this message.
 */
export async function typeIntoComposer(page, composerLocator, text) {
  if (normaliseForCompare(await readComposer(composerLocator)) !== "") {
    await clearComposer(page, composerLocator);
  }
  await composerLocator.click();
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]) await page.keyboard.insertText(lines[index]);
    if (index < lines.length - 1) await page.keyboard.press("Shift+Enter");
  }
}

/**
 * Takes the keyboard focus away from the composer.
 *
 * Typing clicks the composer, and on macOS the browser window often has the
 * system focus: an Enter meant for the terminal would then reach the composer
 * and send the message behind the session's back. With the composer blurred,
 * that stray Enter lands on nothing. `sendFromComposer` focuses it again.
 */
export async function blurComposer(composerLocator) {
  try {
    await composerLocator.blur?.();
  } catch {
    // Gone or not focusable: nothing holds the focus then either.
  }
}

/**
 * True when the composer the conversation was opened with is no longer in the
 * page (the chat window closed, the thread re-rendered). Composers that cannot
 * tell (plain locators) are assumed present.
 */
export async function composerDetached(composerLocator) {
  if (typeof composerLocator?.attached !== "function") return false;
  try {
    return !(await composerLocator.attached());
  } catch {
    return true;
  }
}

/**
 * Types the message and checks it landed intact; retries once from an empty
 * composer if not (a dropped character, focus briefly elsewhere). The
 * composer is blurred afterwards (see blurComposer).
 * Returns true when the composer matches the message.
 */
export async function typeAndVerify(page, composerLocator, text) {
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await clearComposer(page, composerLocator);
      await typeIntoComposer(page, composerLocator, text);
      if (composerMatches(await readComposer(composerLocator), text)) return true;
    }
    return false;
  } finally {
    await blurComposer(composerLocator);
  }
}

/**
 * Sends what the composer holds: Enter, pressed on the composer itself (which
 * focuses that very element first). Nothing else.
 */
export async function sendFromComposer(_page, composerLocator) {
  await composerLocator.press("Enter");
}
