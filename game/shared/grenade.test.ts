import { describe, expect, it } from "vitest";
import { GRENADE } from "./weapons";
import { grenadeFlight, grenadeVelocity } from "./grenade";

type V3 = [number, number, number];
/** Flat ground at y = 0. */
const ground = (from: V3, dir: V3, distance: number) => {
  if (dir[1] >= 0) return null;
  const t = -from[1] / dir[1];
  return t <= distance ? { distance: t, normal: [0, 1, 0] as V3 } : null;
};

describe("grenade throws", () => {
  it("leaves the hand at full or lob speed plus some of the thrower's motion", () => {
    expect(grenadeVelocity([1, 0, 0], 1, [0, 0, 0])).toEqual([GRENADE.throwSpeed, 2, 0]);
    expect(grenadeVelocity([2, 0, 0], GRENADE.lobPower, [4, 0, 0])[0]).toBeCloseTo(GRENADE.throwSpeed * GRENADE.lobPower + 3.6);
    // Strength is clamped between a lob and a full throw.
    expect(grenadeVelocity([0, 0, -1], 5, [0, 0, 0])[2]).toBeCloseTo(-GRENADE.throwSpeed);
    expect(grenadeVelocity([0, 0, -1], 0.1, [0, 0, 0])[2]).toBeCloseTo(-GRENADE.throwSpeed * GRENADE.lobPower);
  });

  it("drops a grenade that cooked off in the hand, carrying only the thrower's motion", () => {
    expect(grenadeVelocity([0, 0, -1], 0, [2, 0, 4])).toEqual([1.8, 0, 3.6]);
  });

  it("flies, lands, then rolls to a stop before the fuse runs out", () => {
    const vel = grenadeVelocity([0.8, 0.6, 0], 1, [0, 0, 0]);
    const flight = grenadeFlight([0, 1.5, 0], vel, GRENADE.fuseMs / 1000, ground);
    expect(flight.impact).toBeGreaterThan(0);
    const landing = flight.points[flight.impact];
    expect(landing[0]).toBeGreaterThan(15);
    // It rolls on past the landing spot, slowing, and rests on the ground at the end.
    expect(flight.end[0]).toBeGreaterThan(landing[0]);
    expect(flight.end[1]).toBeCloseTo(0.07, 1);
    expect(flight.normal).toEqual([0, 1, 0]);
    // A lob lands much shorter.
    const lob = grenadeFlight([0, 1.5, 0], grenadeVelocity([0.8, 0.6, 0], GRENADE.lobPower, [0, 0, 0]), GRENADE.fuseMs / 1000, ground);
    expect(lob.end[0]).toBeLessThan(flight.end[0] * 0.6);
  });

  it("bursts in the air when the fuse runs out before it lands", () => {
    const flight = grenadeFlight([0, 1.5, 0], grenadeVelocity([0.6, 0.8, 0], 1, [0, 0, 0]), 0.6, ground);
    expect(flight.impact).toBe(-1);
    expect(flight.normal).toBeNull();
    expect(flight.end[1]).toBeGreaterThan(3);
  });
});
