import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { DRAIN_MS, createKeyHub, keyName } from "../src/keys.mjs";

/** A stream that passes for a terminal: isTTY plus a recorded setRawMode. */
function fakeTerminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.rawModes = [];
  input.setRawMode = (on) => {
    input.rawModes.push(on);
    return input;
  };
  return input;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("keyName", () => {
  it("maps Enter and letters", () => {
    expect(keyName("\r", { name: "return" })).toBe("enter");
    expect(keyName("S", { name: "s", shift: true })).toBe("s");
    expect(keyName(undefined, { name: "up" })).toBe("up");
  });
});

describe("createKeyHub", () => {
  const hubs = [];
  afterEach(() => {
    for (const hub of hubs.splice(0)) hub.close();
  });

  function setup(options = {}) {
    const input = fakeTerminal();
    const clock = { now: 1_000 };
    const hub = createKeyHub({ input, output: new PassThrough(), now: () => clock.now, ...options });
    hubs.push(hub);
    return { input, clock, hub };
  }

  it("refuses to run without a terminal", () => {
    const input = new PassThrough();
    expect(() => createKeyHub({ input })).toThrow(/vrai terminal/);
  });

  it("puts the terminal in raw mode and restores it on close", () => {
    const { input, hub } = setup();
    expect(input.rawModes).toEqual([true]);
    hub.close();
    expect(input.rawModes).toEqual([true, false]);
  });

  it("drops keys pressed while no prompt is open", async () => {
    const { input, clock, hub } = setup();
    input.write("\r");
    await flush();
    clock.now += 1_000;
    const answer = hub.prompt(["enter", "s"]);
    clock.now += DRAIN_MS + 1;
    input.write("s");
    await expect(answer).resolves.toBe("s");
  });

  it("drops keys arriving in the first moments after a prompt opens (pressed before it)", async () => {
    const { input, clock, hub } = setup();
    const answer = hub.prompt(["enter", "s"]);
    input.write("\r");
    await flush();
    clock.now += DRAIN_MS + 1;
    input.write("s");
    await expect(answer).resolves.toBe("s");
  });

  it("ignores keys that were not offered", async () => {
    const { input, clock, hub } = setup();
    const answer = hub.prompt(["s", "q"]);
    clock.now += DRAIN_MS + 1;
    input.write("\r");
    input.write("x");
    await flush();
    input.write("Q");
    await expect(answer).resolves.toBe("q");
  });

  it("refuses a second prompt while one is open", async () => {
    const { input, clock, hub } = setup();
    const first = hub.prompt(["s"]);
    await expect(hub.prompt(["q"])).rejects.toThrow(/déjà ouverte/);
    clock.now += DRAIN_MS + 1;
    input.write("s");
    await expect(first).resolves.toBe("s");
  });

  it("Ctrl+C answers q, then every later prompt answers q at once; a second Ctrl+C forces", async () => {
    const events = [];
    const { input, hub } = setup({ onInterrupt: () => events.push("interrupt"), onForceQuit: () => events.push("force") });
    const answer = hub.prompt(["enter", "s"]);
    input.write(String.fromCharCode(3));
    await expect(answer).resolves.toBe("q");
    await expect(hub.prompt(["enter"])).resolves.toBe("q");
    await expect(hub.readLine("?", "x")).resolves.toBeNull();
    input.write(String.fromCharCode(3));
    await flush();
    expect(events).toEqual(["interrupt", "force"]);
  });

  it("resolves 'timeout' when a timed prompt elapses, ticking down", async () => {
    const { hub } = setup({ now: Date.now });
    const ticks = [];
    await expect(hub.prompt(["s", "q"], { timeoutMs: 30, onTick: (left) => ticks.push(left) })).resolves.toBe("timeout");
    expect(ticks[0]).toBe(1);
  });

  it("closing answers an open prompt with q", async () => {
    const { hub } = setup();
    const answer = hub.prompt(["enter"]);
    hub.close();
    await expect(answer).resolves.toBe("q");
  });
});
