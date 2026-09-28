import { describe, expect, it } from "vitest";
import { rayCapsule, rayVsPose } from "./hitboxes";

describe("shooting visible body regions", () => {
  for (const crouch of [false, true]) {
    const pose = { x: 0, y: 0, z: -5, crouch };
    it(`registers head-center shots as headshots (${crouch ? "crouched" : "standing"})`, () => {
      expect(rayVsPose([0, crouch ? 1.15 : 1.64, 0], [0, 0, -1], 20, pose)?.part).toBe("head");
    });
    it(`keeps torso and leg hits distinct (${crouch ? "crouched" : "standing"})`, () => {
      expect(rayVsPose([0, crouch ? 0.8 : 1.2, 0], [0, 0, -1], 20, pose)?.part).toBe("body");
      expect(rayVsPose([0, 0.2, 0], [0, 0, -1], 20, pose)?.part).toBe("legs");
      expect(rayVsPose([0, 1.2, 0], [0, 0, -1], 2, pose)).toBeNull();
    });
  }
  it("handles overlapping players at point-blank range", () => {
    expect(rayCapsule([0, 1, 0], [1, 0, 0], [0, 0, 0], [0, 2, 0], 0.5)).toBe(0);
    expect(rayVsPose([0, 1.2, 0], [1, 0, 0], 20, { x: 0, y: 0, z: 0, crouch: false })?.part).toBe("body");
  });
});
