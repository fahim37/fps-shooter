import { describe, expect, it } from "vitest";
import { canEmote, canShowoff } from "./showcase";

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

describe("in-match emote authorization", () => {
  it("lets a living, connected player emote after the cooldown and stop at any time", () => {
    expect(canEmote(true, true, "dance", 0, 1000)).toBe(true);
    expect(canEmote(true, true, "idleFoldArms", 0, 1000)).toBe(true);
    expect(canEmote(true, true, "dance", 1000, 1749)).toBe(false);
    expect(canEmote(true, true, "idle", 1000, 1001)).toBe(true);
  });
  it("rejects the dead, the disconnected and anything that is not an emote", () => {
    expect(canEmote(false, true, "dance", 0, 1000)).toBe(false);
    expect(canEmote(true, false, "dance", 0, 1000)).toBe(false);
    for (const clip of [null, undefined, {}, 1, "death", "aimNeutral", "__proto__"]) expect(canEmote(true, true, clip, 0, 1000)).toBe(false);
  });
});
