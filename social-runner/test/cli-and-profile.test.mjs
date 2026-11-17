import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArgError, parseArgs } from "../src/args.mjs";
import { lockOwnerPid, prepareProfileDir, profileDir, PROFILES_ROOT } from "../src/profile.mjs";

describe("parseArgs", () => {
  it("parses send with defaults", () => {
    expect(parseArgs(["send", "--business", "biz_bloomy", "--network", "instagram", "--max", "20"])).toEqual({
      command: "send",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      network: "instagram",
      max: 20,
      channel: undefined,
      help: false
    });
  });

  it("accepts --flag=value, --workspace and --chrome", () => {
    expect(parseArgs(["inbox", "--business=biz_x", "--network=facebook", "--workspace", "ws_2", "--chrome"])).toMatchObject({
      command: "inbox",
      workspaceId: "ws_2",
      businessId: "biz_x",
      network: "facebook",
      channel: "chrome"
    });
  });

  it("returns help without validating the rest", () => {
    expect(parseArgs(["--help"])).toEqual({ help: true });
  });

  it.each([
    [[], /Commande attendue/],
    [["post", "--business", "b", "--network", "instagram"], /Commande attendue/],
    [["send", "--network", "instagram"], /--business est obligatoire/],
    [["send", "--business", "../etc", "--network", "instagram"], /identifiant invalide/],
    [["send", "--business", "b"], /--network est obligatoire/],
    [["send", "--business", "b", "--network", "tiktok"], /instagram ou facebook/],
    [["send", "--business", "b", "--network", "instagram", "--max", "0"], /--max/],
    [["send", "--business", "b", "--network", "instagram", "--max", "3.5"], /--max/],
    [["inbox", "--business", "b", "--network", "instagram", "--max", "3"], /qu'avec send/],
    [["send", "--business", "--network", "instagram"], /attend une valeur/],
    [["send", "--business", "b", "--network", "instagram", "--proxy", "x"], /Option inconnue/],
    [["send", "--business", "b", "--network", "instagram", "--chrome=yes"], /ne prend pas de valeur/]
  ])("rejects %j", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(ArgError);
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe("profile folder", () => {
  const dirs = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });

  async function tempRoot() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "social-runner-test-"));
    dirs.push(dir);
    return dir;
  }

  it("is per business and per browser, outside the repo", () => {
    expect(profileDir("biz_a", undefined)).toBe(path.join(PROFILES_ROOT, "biz_a", "chromium"));
    expect(profileDir("biz_a", "chrome")).toBe(path.join(PROFILES_ROOT, "biz_a", "chrome"));
    expect(PROFILES_ROOT.startsWith(os.homedir())).toBe(true);
    expect(PROFILES_ROOT).not.toContain("devcomm_os");
  });

  it("rejects ids that could escape the profiles folder", () => {
    expect(() => profileDir("../other", undefined)).toThrow(/invalide/);
    expect(() => profileDir("a/b", undefined)).toThrow(/invalide/);
  });

  it("reads the pid from Chromium's lock link", () => {
    expect(lockOwnerPid("MacBook-Pro.local-4242")).toBe(4242);
    expect(lockOwnerPid("garbage")).toBeNull();
  });

  it("creates the folder owner-only", async () => {
    const dir = path.join(await tempRoot(), "biz", "chromium");
    await prepareProfileDir(dir);
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
  });

  it("clears a stale lock left by a crashed run", async () => {
    const dir = await tempRoot();
    await fs.symlink("host-999999", path.join(dir, "SingletonLock"));
    await fs.symlink("/nonexistent/socket", path.join(dir, "SingletonSocket"));
    await prepareProfileDir(dir, { isAlive: () => false });
    await expect(fs.lstat(path.join(dir, "SingletonLock"))).rejects.toThrow();
    await expect(fs.lstat(path.join(dir, "SingletonSocket"))).rejects.toThrow();
  });

  it("refuses when the profile is open in a live process", async () => {
    const dir = await tempRoot();
    await fs.symlink("host-4242", path.join(dir, "SingletonLock"));
    await expect(prepareProfileDir(dir, { isAlive: (pid) => pid === 4242 })).rejects.toThrow(/déjà ouvert \(processus 4242\)/);
    await expect(fs.lstat(path.join(dir, "SingletonLock"))).resolves.toBeTruthy();
  });
});
