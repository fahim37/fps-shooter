import { describe, expect, it } from "vitest";
import { GRENADE, grenadeArc, grenadeVelocity } from "./weapons";

/** Flat ground at y = 0. */
const ground = (from: [number, number, number], dir: [number, number, number], distance: number) => {
  if (dir[1] >= 0) return null;
  const t = -from[1] / dir[1];
  return t <= distance ? { distance: t, normal: [0, 1, 0] as [number, number, number] } : null;
};

describe("grenade throws", () => {
  it("leaves the hand at full or lob speed plus some of the thrower's motion", () => {
    expect(grenadeVelocity([1, 0, 0], 1, [0, 0, 0])).toEqual([GRENADE.throwSpeed, 2, 0]);
    expect(grenadeVelocity([2, 0, 0], GRENADE.lobPower, [4, 0, 0])[0]).toBeCloseTo(GRENADE.throwSpeed * GRENADE.lobPower + 2);
    // Strength is clamped between a lob and a full throw.
    expect(grenadeVelocity([0, 0, -1], 5, [0, 0, 0])[2]).toBeCloseTo(-GRENADE.throwSpeed);
    expect(grenadeVelocity([0, 0, -1], 0, [0, 0, 0])[2]).toBeCloseTo(-GRENADE.throwSpeed * GRENADE.lobPower);
  });

  it("traces the arc to the first surface it hits", () => {
    const { points, end, normal } = grenadeArc([0, 1.5, 0], grenadeVelocity([0.8, 0.6, 0], 1, [0, 0, 0]), ground);
    expect(end[1]).toBeCloseTo(0, 5);
    expect(normal).toEqual([0, 1, 0]);
    // A full throw at ~37° lands well down range, and a lob lands much shorter.
    expect(end[0]).toBeGreaterThan(18);
    const lob = grenadeArc([0, 1.5, 0], grenadeVelocity([0.8, 0.6, 0], GRENADE.lobPower, [0, 0, 0]), ground);
    expect(lob.end[0]).toBeLessThan(end[0] * 0.45);
    // The path rises, then falls.
    const top = Math.max(...points.map((p) => p[1]));
    expect(top).toBeGreaterThan(1.5);
    expect(points.every((p, i) => i === 0 || p[0] > points[i - 1][0])).toBe(true);
  });
});
