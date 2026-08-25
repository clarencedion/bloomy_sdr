import { describe, it, expect } from "vitest";

describe("Root Environment & Test Runner Smoke Test", () => {
  it("should execute tests with vitest", () => {
    expect(1 + 1).toBe(2);
  });

  it("should properly expose standard environment globals", () => {
    expect(typeof fetch).toBe("function");
    expect(typeof AbortController).toBe("function");
    expect(typeof URL).toBe("function");
  });

  it("should support async test promises", async () => {
    const value = await Promise.resolve("devcomm-sdr-v2");
    expect(value).toBe("devcomm-sdr-v2");
  });
});
