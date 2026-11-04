import { describe, expect, it } from "vitest";
import { GRENADE } from "./weapons";
import { SPRINT_SPEED } from "./constants";
import { blastDistance, grenadeFlight, grenadeVelocity, impactSpeed } from "./grenade";

type V3 = [number, number, number];
/** Flat ground at y = 0. */
const ground = (from: V3, dir: V3, distance: number) => {
  if (dir[1] >= 0) return null;
  const t = -from[1] / dir[1];
  return t <= distance ? { distance: t, normal: [0, 1, 0] as V3 } : null;
};

describe("grenade throws", () => {
  it("leaves the hand at full or lob speed", () => {
    expect(grenadeVelocity([1, 0, 0], 1, [0, 0, 0])).toEqual([GRENADE.throwSpeed, 2, 0]);
    // Strength is clamped between a lob and a full throw.
    expect(grenadeVelocity([0, 0, -1], 5, [0, 0, 0])[2]).toBeCloseTo(-GRENADE.throwSpeed);
    expect(grenadeVelocity([0, 0, -1], 0.1, [0, 0, 0])[2]).toBeCloseTo(-GRENADE.throwSpeed * GRENADE.lobPower);
  });

  it("goes where the mouse points, whichever way the thrower moves", () => {
    const heading = (v: V3) => Math.atan2(v[2], v[0]);
    const dir: V3 = [0.6, 0.2, -0.77];
    const still = grenadeVelocity(dir, 1, [0, 0, 0]);
    for (const vel of [[8, 0, 0], [-8, 0, 0], [0, 0, 8], [5.6, 6.4, 5.6], [-5.6, -3, -5.6]] as V3[]) {
      for (const airborne of [false, true]) expect(heading(grenadeVelocity(dir, 1, vel, airborne))).toBeCloseTo(heading(still), 10);
    }
    // Pure strafing and backing away add nothing.
    expect(grenadeVelocity([0, 0, -1], 1, [SPRINT_SPEED, 0, 0])).toEqual(grenadeVelocity([0, 0, -1], 1, [0, 0, 0]));
    expect(grenadeVelocity([0, 0, -1], 1, [0, 0, SPRINT_SPEED])).toEqual(grenadeVelocity([0, 0, -1], 1, [0, 0, 0]));
  });

  it("carries a little farther sprinting and jumping, and no farther than that", () => {
    const aim: V3 = [0.8, 0.6, 0];
    const range = (vel: V3, airborne = false) => grenadeFlight([0, 1.5, 0], grenadeVelocity(aim, 1, vel, airborne), 3, ground).points.find((p) => p[1] < 0.1)![0];
    const still = range([0, 0, 0]), sprint = range([SPRINT_SPEED, 0, 0]), jump = range([0, 0, 0], true), both = range([SPRINT_SPEED, 0, 0], true);
    expect(sprint / still).toBeGreaterThan(1.1);
    expect(jump / still).toBeGreaterThan(1.05);
    expect(both).toBeGreaterThan(sprint);
    expect(both / still).toBeLessThan(1.45);
    // Clients report their own speed: a faked one gains nothing past a sprint.
    expect(grenadeVelocity(aim, 1, [500, 0, 0])).toEqual(grenadeVelocity(aim, 1, [SPRINT_SPEED, 0, 0]));
  });

  it("drops a grenade that cooked off in the hand, carrying only the thrower's motion", () => {
    expect(grenadeVelocity([0, 0, -1], 0, [2, 0, 4])).toEqual([1.8, 0, 3.6]);
    expect(Math.hypot(...grenadeVelocity([0, 0, -1], 0, [500, 0, 0]))).toBeCloseTo(SPRINT_SPEED * 0.9);
  });

  it("reaches the nearest body part that isn't behind cover", () => {
    const head: V3 = [3, 1.6, 0], chest: V3 = [3, 1.1, 0], feet: V3 = [3, 0.3, 0];
    // Behind a low wall: only the head shows.
    expect(blastDistance([0, 0, 0], [head, chest, feet], (p) => p === head)).toBeCloseTo(Math.hypot(3, 1.6));
    expect(blastDistance([0, 0, 0], [head, chest, feet], () => true)).toBeCloseTo(Math.hypot(3, 0.3));
    expect(blastDistance([0, 0, 0], [head, chest, feet], () => false)).toBeNull();
    expect(blastDistance([GRENADE.radius + 3, 0, 0], [[0, 1, 0]], () => true)).toBeNull();
  });

  it("tells a hit from falling", () => {
    expect(impactSpeed([5, 0, 0], [5, -20 / 30, 0], 1 / 30)).toBeLessThan(0.5);
    expect(impactSpeed([5, -9, 0], [3, 2, 0], 1 / 30)).toBeGreaterThan(5);
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
