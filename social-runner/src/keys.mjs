/**
 * The terminal key source: one raw-mode keypress listener for the whole run.
 *
 * A key only counts if it was pressed while a prompt was waiting for it.
 * Keys pressed at any other time (while a message is being typed, during a
 * page load) are dropped, and so are keys arriving in the first moments after
 * a prompt opens, which were pressed before it. That is what stops an Enter
 * meant for one message from approving the next one.
 *
 * Ctrl+C: the first press answers the open prompt (or the next one) with "q",
 * so the session ends at its next decision point with the composer cleared;
 * the second press calls `onForceQuit`. `isInterrupted()` lets the sessions
 * stop between prompts too (before opening the next prospect or thread).
 */
import readline from "node:readline";

/** Keys arriving this soon after a prompt opens were pressed before it. */
export const DRAIN_MS = 150;

/**
 * A longer drain for a second confirmation that directly follows another key
 * (a held or double-tapped key must not answer it).
 */
export const CONFIRM_DRAIN_MS = 700;

/** Terminal key → choice name. Letters are matched case-insensitively. */
export function keyName(str, key = {}) {
  if (key.name === "return" || key.name === "enter") return "enter";
  if (typeof str === "string" && str.length === 1) return str.toLowerCase();
  return key.name ?? "";
}

/**
 * @param {{ input?: NodeJS.ReadStream, output?: NodeJS.WriteStream, onInterrupt?: () => void, onForceQuit?: () => void, now?: () => number }} [options]
 */
export function createKeyHub({ input = process.stdin, output = process.stdout, onInterrupt, onForceQuit, now = Date.now } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error(
      "Le runner doit tourner dans un vrai terminal (pas de pipe, pas de tâche de fond) : une session se confirme et s'arrête au clavier."
    );
  }

  let pending = null;
  let lineMode = false;
  let interrupts = 0;
  let closed = false;

  const setRaw = (on) => {
    try {
      input.setRawMode(on);
    } catch {
      // The terminal went away; there is nothing left to restore.
    }
  };

  function settle(value) {
    const current = pending;
    if (!current) return;
    pending = null;
    clearTimeout(current.timer);
    clearInterval(current.ticker);
    current.resolve(value);
  }

  function onKeypress(str, key = {}) {
    if (closed || lineMode) return;
    if (key.ctrl && key.name === "c") {
      interrupts += 1;
      if (interrupts === 1) {
        onInterrupt?.();
        settle("q");
      } else {
        onForceQuit?.();
      }
      return;
    }
    if (!pending || now() - pending.openedAt < pending.drainMs) return;
    const name = keyName(str, key);
    if (pending.choices.has(name)) settle(name);
  }

  readline.emitKeypressEvents(input);
  setRaw(true);
  input.on("keypress", onKeypress);
  input.resume();

  // Whatever happens, never leave the operator's terminal in raw mode.
  const restore = () => setRaw(false);
  process.once("exit", restore);

  return {
    /** True once Ctrl+C was pressed or the hub closed: the session must not start anything new. */
    isInterrupted() {
      return closed || interrupts > 0;
    },

    /**
     * Waits for one of `choices` ("enter", "s", "e", "q", "r", "n", "o").
     * With `timeoutMs`, resolves "timeout" when it elapses; `onTick` gets the
     * seconds left once per second. `drainMs` overrides how long keys are
     * ignored after the prompt opens.
     * @returns {Promise<string>}
     */
    prompt(choices, { timeoutMs, onTick, drainMs = DRAIN_MS } = {}) {
      if (closed || interrupts > 0) return Promise.resolve("q");
      // One question at a time: a second prompt would make a key ambiguous.
      if (pending) return Promise.reject(new Error("Une invite clavier est déjà ouverte."));
      return new Promise((resolve) => {
        pending = { choices: new Set(choices), resolve, openedAt: now(), drainMs, timer: undefined, ticker: undefined };
        if (timeoutMs) {
          const deadline = now() + timeoutMs;
          pending.timer = setTimeout(() => settle("timeout"), timeoutMs);
          if (onTick) {
            onTick(Math.ceil(timeoutMs / 1000));
            pending.ticker = setInterval(() => onTick(Math.max(0, Math.ceil((deadline - now()) / 1000))), 1000);
          }
        }
      });
    },

    /**
     * One line of text, prefilled with `initial` so it can be edited in place.
     * Resolves null when cancelled with Ctrl+C.
     * @returns {Promise<string | null>}
     */
    async readLine(question, initial = "") {
      if (closed || interrupts > 0) return null;
      lineMode = true;
      const rl = readline.createInterface({ input, output, terminal: true });
      try {
        return await new Promise((resolve) => {
          rl.on("SIGINT", () => resolve(null));
          rl.question(question, (answer) => resolve(answer));
          if (initial) rl.write(initial);
        });
      } finally {
        // readline leaves raw mode off and the stream paused when it closes.
        rl.close();
        lineMode = false;
        if (!closed) {
          setRaw(true);
          input.resume();
        }
      }
    },

    close() {
      if (closed) return;
      closed = true;
      settle("q");
      input.off("keypress", onKeypress);
      setRaw(false);
      input.pause();
      process.off("exit", restore);
    }
  };
}
