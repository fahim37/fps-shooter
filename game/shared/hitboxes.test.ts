import { describe, expect, it } from "vitest";
import { rayCapsule, rayVsPose, slideYaw, SLIDE_LEG_YAW } from "./hitboxes";

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
  it("lays a sliding player back along the ground, legs leading", () => {
    // Sliding toward -Z from z = -5, shot at from ahead (the shooter at z = -12 looks along +Z).
    const pose = { x: 0, y: 0, z: -5, crouch: true, yaw: 0, slide: 0 };
    const from = (y: number, x = 0) => rayVsPose([x, y, -12], [0, 0, 1], 20, pose);
    expect(from(0.75)?.part).toBe("head");
    expect(from(0.42)?.part).toBe("body");
    expect(from(0.12)?.part).toBe("legs");
    // The feet are met first, well ahead of where the player stands.
    expect(from(0.12)!.distance).toBeLessThan(6.2);
    // Nothing is left standing where a crouched head and chest would be.
    expect(from(1.1)).toBeNull();
    expect(rayVsPose([0, 1.1, -12], [0, 0, 1], 20, { ...pose, slide: null })?.part).toBe("head");
    // From the side, the legs reach out along the travel and the head sits behind the hips.
    const side = (z: number, y: number) => rayVsPose([-6, y, z], [1, 0, 0], 20, pose)?.part;
    expect(side(-5.7, 0.16)).toBe("legs");
    expect(side(-4.67, 0.69)).toBe("head");
  });

  it("leads a slide's legs along the travel, no further than the drawn character turns them", () => {
    expect(slideYaw(0.3, 0, -8)).toBeCloseTo(0);
    expect(slideYaw(0, 8, 0)).toBeCloseTo(-SLIDE_LEG_YAW);
    expect(slideYaw(0.5, 0, 0)).toBe(0.5);
  });

  it("handles overlapping players at point-blank range", () => {
    expect(rayCapsule([0, 1, 0], [1, 0, 0], [0, 0, 0], [0, 2, 0], 0.5)).toBe(0);
    expect(rayVsPose([0, 1.2, 0], [1, 0, 0], 20, { x: 0, y: 0, z: 0, crouch: false })?.part).toBe("body");
  });
});
