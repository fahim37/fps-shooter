import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRoomWorld, initWorldData, RAPIER } from "./world";
import { getMap, MAP_IDS } from "../game/shared/map/maps";
import { Mover, newMoveState, type MoveInput } from "../game/shared/movement";
import { QUERY_MOVE, raycastWorld, type World } from "../game/shared/physics";
import { DASH_SECONDS, DASH_SPEED, GRAVITY, SPRINT_SPEED } from "../game/shared/constants";
import { MoveGuard, MOVE_RATE, type MoveCast, type MoveVerdict } from "./movecheck";

type V3 = [number, number, number];

/**
 * A flat test world: the ground at y = 0, a 10 m high platform for x < 0, and a wall across
 * x = 5 for z in -3..3 (to 3 m high). Ray casts against those boxes.
 */
const flatCast: MoveCast = (o, d, max) => {
  let best: number | null = null;
  const take = (t: number) => { if (t >= 0 && t <= max && (best === null || t < best)) best = t; };
  // Ground (y = 0 for x >= 0) and platform top (y = 10 for x < 0).
  if (d[1] < 0) {
    for (const [h, inside] of [[0, (x: number) => x >= 0], [10, (x: number) => x < 0]] as const) {
      const t = (h - o[1]) / d[1];
      if (inside(o[0] + d[0] * t)) take(t);
    }
  }
  // The platform's side wall at x = 0 (up to y = 10) and the wall at x = 5.
  for (const [wx, top, zmin, zmax] of [[0, 10, -Infinity, Infinity], [5, 3, -3, 3]]) {
    if (Math.abs(d[0]) < 1e-9) continue;
    const t = (wx - o[0]) / d[0];
    const y = o[1] + d[1] * t, z = o[2] + d[2] * t;
    if (y <= top && y >= 0 && z >= zmin && z <= zmax) take(t);
  }
  return best;
};

/** Feeds a path of poses (one per 1/30 s unless `dts` says otherwise) through a guard. */
function run(path: V3[], { dash = 0, cast = flatCast, dts }: { dash?: number; cast?: MoveCast; dts?: number[] } = {}) {
  const guard = new MoveGuard(path[0], 1000);
  let t = 1000, last = path[0];
  const verdicts: MoveVerdict[] = [];
  path.slice(1).forEach((to, i) => {
    t += dts?.[i] ?? 1000 / 30;
    const v = guard.check(last, to, t, dash, cast);
    verdicts.push(v);
    if (v.ok) last = to;
  });
  return { verdicts, refused: verdicts.filter((v) => !v.ok) as Extract<MoveVerdict, { ok: false }>[] };
}

const line = (from: V3, step: V3, n: number): V3[] => Array.from({ length: n + 1 }, (_, i) => [from[0] + step[0] * i, from[1] + step[1] * i, from[2] + step[2] * i]);

describe("movement checks on reported poses", () => {
  it("takes a sprint, and puts back a speed hack once its allowance runs out", () => {
    expect(run(line([10, 0, 0], [SPRINT_SPEED / 30, 0, 0], 300)).refused).toEqual([]);
    // Twice sprint speed: the stored second of travel runs out, then most poses go back.
    const fast = run(line([10, 0, -50], [0, 0, (SPRINT_SPEED * 2) / 30], 300));
    expect(fast.refused.length).toBeGreaterThan(100);
    expect(fast.refused.every((v) => v.reason === "speed")).toBe(true);
  });
  it("gains nothing by spamming poses: travel is limited per second, not per message", () => {
    // 600 poses in 1 s, 0.3 m apart: 180 m.
    const spam = run(line([10, 0, -80], [0, 0, 0.3], 600), { dts: Array(600).fill(1000 / 600) });
    const moved = spam.verdicts.filter((v) => v.ok).length * 0.3;
    expect(moved).toBeLessThan(MOVE_RATE * 2.1);
  });
  it("honours a second of poses delivered at once after a network stall", () => {
    const path = line([10, 0, 0], [SPRINT_SPEED / 30, 0, 0], 60);
    // Nothing arrives for a second, then the 30 poses sent meanwhile come in together.
    const dts = [...Array(30).fill(1000 / 30), 1000, ...Array(29).fill(0)];
    expect(run(path, { dts }).refused).toEqual([]);
  });
  it("lets a dash go as far as its allowance", () => {
    const dashPath = line([10, 0, -20], [0, 0, DASH_SPEED / 30], Math.round(DASH_SECONDS * 30));
    expect(run(dashPath, { dash: DASH_SPEED * DASH_SECONDS * 1.25 }).refused).toEqual([]);
  });
  it("puts back a step through a wall", () => {
    const through = run(line([4, 0, 0], [0.12, 0, 0], 20));
    expect(through.refused.length).toBeGreaterThan(0);
    expect(through.refused[0]).toMatchObject({ reason: "wall", to: [expect.closeTo(4.96, 1), 0, 0] });
  });
  it("puts a flying player back on the last floor, and a hovering one too", () => {
    const fly = run(line([10, 0, 0], [0, 0.15, 0], 40));
    // Back to the last pose that stood on the floor (the probes still reach it 0.4 m up).
    expect(fly.refused[0]).toMatchObject({ reason: "height", to: [10, expect.toBeOneOf([0, 0.15, 0.3]), 0] });
    // Jumped to a metre and stays there.
    const hover = run([[10, 0, 0], ...line([10, 1, 0], [0.01, 0, 0], 90)]);
    expect(hover.refused[0]?.reason).toBe("hover");
  });
  it("finds the landing speed of a fall from the height seen, not the client's word", () => {
    // Walk off the 10 m platform and fall.
    const path: V3[] = [[-1, 10, 0]];
    let x = -1, y = 10, vy = 0;
    for (let i = 0; i < 60 && y > 0; i++) {
      x += 0.15;
      if (x > 0) { vy -= GRAVITY / 30; y = Math.max(0, y + vy / 30); }
      path.push([x, y, 0]);
    }
    const { verdicts, refused } = run(path);
    expect(refused).toEqual([]);
    // Once, on the pose that touches down.
    const impacts = verdicts.map((v) => v.ok ? v.impact : 0).filter((v) => v > 0);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toBeCloseTo(Math.sqrt(2 * GRAVITY * 10), 0);
  });
});

/**
 * No false alarms: real movement through every map's geometry (sprinting into walls, up stairs,
 * jumping, dashing level and upward) reported at 30 Hz is never put back.
 */
describe.each(MAP_IDS)("real movement on %s is never put back", (id) => {
  const map = getMap(id);
  let world: World;
  beforeAll(async () => { await initWorldData(); world = createRoomWorld(map); }, 60_000);
  afterAll(() => world?.free());

  it("wanders, jumps and dashes from every spawn", () => {
    const cast: MoveCast = (o, d, max) => raycastWorld(RAPIER, world, o, d, max, QUERY_MOVE)?.distance ?? null;
    const mover = new Mover(RAPIER, world);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const failures: string[] = [];
    try {
      for (const sp of map.spawns.filter((_, i) => i % 3 === 0)) {
        const s = newMoveState(sp.x, sp.y, sp.z);
        mover.teleport(s, sp.x, sp.y, sp.z);
        const input: MoveInput = { forward: 1, right: 0, yaw: sp.yaw, jump: false, sprint: true, crouch: false, ads: 0, speedMult: 1.05 };
        const step = 1 / 120;
        // Settle onto the floor first, as a spawn does before its first pose counts.
        for (let i = 0; i < 60; i++) mover.step(s, { ...input, forward: 0 }, step);
        const guard = new MoveGuard([s.x, s.y, s.z], 0);
        let last: V3 = [s.x, s.y, s.z], t = 0, dash = 0, dashUntil = 0, charges = 2;
        for (let frame = 0; frame < 120 * 12; frame++) {
          if (frame % 90 === 0) input.yaw += (rand() - 0.5) * 2.5;
          input.jump = rand() < 0.02;
          input.pitch = rand() < 0.5 ? 0.6 : 0;
          input.dash = false;
          if (charges > 0 && rand() < 0.004) { input.dash = true; charges--; dash = DASH_SPEED * DASH_SECONDS * 1.25; dashUntil = t + 1500; guard.dashed(t); }
          mover.step(s, input, step);
          t += step * 1000;
          if (frame % 4 !== 3) continue; // poses at 30 Hz
          const to: V3 = [s.x, s.y, s.z];
          const v = guard.check(last, to, t, t < dashUntil ? dash : 0, cast);
          if (!v.ok) { failures.push(`${v.reason} at ${to.map((n) => n.toFixed(2))} from ${last.map((n) => n.toFixed(2))} (spawn ${sp.x},${sp.z})`); break; }
          dash = Math.max(0, dash - v.dashUsed);
          last = to;
        }
      }
    } finally { mover.dispose(); }
    expect(failures).toEqual([]);
  }, 60_000);
});
