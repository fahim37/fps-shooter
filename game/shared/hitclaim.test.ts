import { describe, expect, it } from "vitest";
import { hitboxes, type Pose } from "./hitboxes";
import { claimFits } from "./hitclaim";

type V3 = [number, number, number];

/** A shot from 20 m in front of a player at the origin facing the shooter, aimed at `p`. */
function shotAt(p: V3) {
  const o: V3 = [0, 1.6, -20];
  const d: V3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const len = Math.hypot(...d);
  return { o, dir: [d[0] / len, d[1] / len, d[2] / len] as V3, dist: len };
}

describe("claimed hits", () => {
  // Yaw π faces +Z... the shooter stands at -Z, so face -Z (yaw 0) toward it.
  const pose: Pose = { x: 0, y: 0, z: 0, crouch: false, yaw: 0, pitch: 0 };
  const head = hitboxes(pose).head.c;

  it("takes a headshot on the drawn head, even mid-stride where it bobs below its mean", () => {
    const s = shotAt([head[0], head[1] - 0.12, head[2] - 0.1]);
    expect(claimFits(s.o, s.dir, s.dist, "head", pose, null, 200)).toBe(true);
  });

  it("refuses a headshot claimed on the chest", () => {
    const s = shotAt([head[0], head[1] - 0.45, head[2] - 0.15]);
    expect(claimFits(s.o, s.dir, s.dist, "head", pose, null, 200)).toBe(false);
    expect(claimFits(s.o, s.dir, s.dist, "body", pose, null, 200)).toBe(true);
  });

  it("takes a body hit on the hands held out on a rifle, not on empty air beside the player", () => {
    const hands = shotAt([0.1, 1.35, -0.5]);
    expect(claimFits(hands.o, hands.dir, hands.dist, "body", pose, null, 200)).toBe(true);
    const air = shotAt([1.1, 1.2, 0]);
    expect(claimFits(air.o, air.dir, air.dist, "body", pose, null, 200)).toBe(false);
  });

  it("refuses a hit behind a wall, or claimed at a distance the ray never reaches", () => {
    const s = shotAt(head);
    expect(claimFits(s.o, s.dir, s.dist, "head", pose, s.dist - 2, 200)).toBe(false);
    expect(claimFits(s.o, s.dir, s.dist, "head", pose, s.dist - 0.1, 200)).toBe(true);
    expect(claimFits(s.o, s.dir, s.dist + 3, "head", pose, null, 200)).toBe(false);
    expect(claimFits(s.o, s.dir, Number.NaN, "head", pose, null, 200)).toBe(false);
    expect(claimFits(s.o, s.dir, s.dist, "head", pose, null, 10)).toBe(false);
  });

  it("follows the head down over a low aim", () => {
    const low: Pose = { ...pose, pitch: -1.2 };
    const bent = hitboxes(low).head.c;
    expect(bent[1]).toBeLessThan(head[1] - 0.2);
    const s = shotAt(bent);
    expect(claimFits(s.o, s.dir, s.dist, "head", low, null, 200)).toBe(true);
    expect(claimFits(s.o, s.dir, s.dist, "head", pose, null, 200)).toBe(false);
  });
});
