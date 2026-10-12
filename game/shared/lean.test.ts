import { describe, expect, it } from "vitest";
import { clampLean, leanOffset } from "./lean";
import { hitboxes, rayVsPose } from "./hitboxes";
import { PoseHistory } from "./lagcomp";

describe("peeking", () => {
  it("tilts toward the character's own right and left for any facing", () => {
    // Facing -Z, right is +X.
    expect(leanOffset(1, 0, 0, 1.64)[0]).toBeGreaterThan(0.3);
    expect(leanOffset(-1, 0, 0, 1.64)[0]).toBeLessThan(-0.3);
    // Facing +X (yaw -π/2), right is +Z.
    const turned = leanOffset(1, -Math.PI / 2, 0, 1.64);
    expect(turned[2]).toBeGreaterThan(0.3);
    expect(Math.abs(turned[0])).toBeLessThan(1e-9);
    // Hips stay put; the head drops slightly as it swings out.
    expect(Math.hypot(...leanOffset(1, 0, 0, 0.5))).toBe(0);
    expect(leanOffset(1, 0, 0, 1.64)[1]).toBeLessThan(0);
  });

  it("moves the head hitbox out from behind cover", () => {
    const upright = { x: 0, y: 0, z: 0, crouch: false };
    const peeking = { ...upright, yaw: 0, lean: 1 };
    expect(hitboxes(peeking).head.c[0]).toBeCloseTo(hitboxes(upright).head.c[0] + leanOffset(1, 0, 0, 1.64)[0]);
    expect(hitboxes(peeking).legs).toEqual(hitboxes(upright).legs);
    // A shot down the line beside the player only connects while they peek.
    const x = hitboxes(peeking).head.c[0], y = hitboxes(peeking).head.c[1];
    expect(rayVsPose([x, y, 10], [0, 0, -1], 50, upright)).toBeNull();
    expect(rayVsPose([x, y, 10], [0, 0, -1], 50, peeking)?.part).toBe("head");
  });

  it("stops the head short of a wall instead of passing through it", () => {
    const open = clampLean(1, 0, 0, 0, 0, 0, () => null);
    const wall = clampLean(1, 0, 0, 0, 0, 0, () => 0.4);
    const touching = clampLean(-1, 0, 0, 0, 0, 0, () => 0.1);
    expect(open).toBe(1);
    expect(wall).toBeGreaterThan(0);
    expect(wall).toBeLessThan(1);
    expect(Math.abs(touching)).toBe(0);
    expect(clampLean(0.3, 0, 0, 0, 0, 0, () => 2)).toBe(0.3);
  });

  it("rewinds the peek with the rest of the pose", () => {
    const history = new PoseHistory();
    history.push(0, { x: 0, y: 0, z: 0, crouch: false, yaw: 0, lean: 0 });
    history.push(100, { x: 0, y: 0, z: 0, crouch: false, yaw: 0, lean: 1 });
    expect(history.sample(50)?.lean).toBeCloseTo(0.5);
  });
});
