import { describe, expect, it } from "vitest";
import { shouldReload } from "./updateCheck";

describe("shouldReload", () => {
  it("reloads when the server runs a different build", () => {
    expect(shouldReload("aaa", "bbb", null)).toBe(true);
  });
  it("stays put on the same build", () => {
    expect(shouldReload("aaa", "aaa", null)).toBe(false);
  });
  it("reloads only once for a build, so stale pages cannot loop", () => {
    expect(shouldReload("aaa", "bbb", "bbb")).toBe(false);
    expect(shouldReload("aaa", "ccc", "bbb")).toBe(true);
  });
  it("ignores unknown or missing builds", () => {
    expect(shouldReload("", "bbb", null)).toBe(false);
    expect(shouldReload("aaa", "", null)).toBe(false);
    expect(shouldReload("aaa", undefined, null)).toBe(false);
  });
});
