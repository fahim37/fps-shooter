import { describe, expect, it } from "vitest";
import { canShowoff } from "./showcase";

describe("lobby showoff authorization", () => {
  it("rejects malformed clips, gameplay actions and disconnected players", () => {
    for (const clip of [null, undefined, {}, 1, "death", "__proto__"]) {
      expect(canShowoff("waiting", true, clip, 0, 1000)).toBe(false);
    }
    for (const phase of ["warmup", "live", "ended"]) expect(canShowoff(phase, true, "dance", 0, 1000)).toBe(false);
    expect(canShowoff("waiting", false, "dance", 0, 1000)).toBe(false);
  });
  it("accepts a valid waiting-room showoff after the cooldown", () => {
    expect(canShowoff("waiting", true, "dance", 1000, 1749)).toBe(false);
    expect(canShowoff("waiting", true, "dance", 1000, 1750)).toBe(true);
  });
});
