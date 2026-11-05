import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRoomWorld, getNav, initWorldData, RAPIER } from "./world";
import { getMap } from "../game/shared/map/maps";
import { buildDesert } from "../game/shared/map/desert";
import { lineOfSight, QUERY_MOVE, raycastWorld, type World } from "../game/shared/physics";
import { Mover, newMoveState, type MoveInput } from "../game/shared/movement";
import { EYE_HEIGHT } from "../game/shared/constants";
import desertPieces from "../game/shared/generated/desert-pieces.json";

const map = getMap("desert");
let world: World;
beforeAll(async () => { await initWorldData(); world = createRoomWorld(map); }, 60_000);
afterAll(() => world?.free());

const { sites } = desertPieces as unknown as { sites: Record<"A" | "B", [number, number, number]> };

describe("desert city", () => {
  it("is deterministic, so server and clients build the same world", () => {
    expect(JSON.stringify(buildDesert())).toBe(JSON.stringify(buildDesert()));
  });

  it("gives each team ten spawns, none in sight of the other team's", () => {
    const eye = (s: { x: number; y: number; z: number }): [number, number, number] => [s.x, s.y + EYE_HEIGHT, s.z];
    const blue = map.spawns.filter((s) => s.team === 1), red = map.spawns.filter((s) => s.team === 2);
    expect(blue).toHaveLength(10);
    expect(red).toHaveLength(10);
    for (const b of blue) for (const r of red) expect(lineOfSight(RAPIER, world, eye(b), eye(r)), `${b.x},${b.z} sees ${r.x},${r.z}`).toBe(false);
  });

  it.each([
    // Walls that importing once lost: stairs' ramps took everything under a roof with them.
    ["a hall's outer wall", [-8, 5, -26], [1, 0, 0]],
    // A thin metal panel that a coarse simplification flattened away.
    ["a thin door panel", [62.3, 3.5, 32.5], [-1, 0, 0]],
    // The hall's retaining wall, where the terrain used to heap a walkable sand bank.
    ["the courtyard's retaining wall", [-16.5, 1.6, 16], [1, 0, 0]],
    // The south flank is closed: its door off the street and its passage into the hall.
    ["the wall where the courtyard door was", [-16.6, 1.2, 6], [0, 0, 1]],
    ["the hall's wall where the passage was", [-11, 4.8, 18.65], [-1, 0, 0]],
  ] as const)("keeps %s solid", (_, [x, y, z], [dx, dy, dz]) => {
    const hit = world.castRay(new RAPIER.Ray({ x, y, z }, { x: dx, y: dy, z: dz }), 7, true, undefined, QUERY_MOVE);
    expect(hit).not.toBeNull();
  });

  it("has no hole at the top of the ramp up to site A", () => {
    for (const [x, z] of [[-30, 30.6], [-29.5, 31], [-29, 31.5], [-28.5, 31], [-30, 30.2]]) {
      const hit = world.castRay(new RAPIER.Ray({ x, y: 5, z }, { x: 0, y: -1, z: 0 }), 5, true, undefined, QUERY_MOVE);
      expect(5 - hit!.timeOfImpact, `at ${x},${z}`).toBeGreaterThan(3);
    }
  });

  it("keeps the hall stair's landing under foot", () => {
    for (const z of [24.8, 25.5, 26.2]) {
      const hit = world.castRay(new RAPIER.Ray({ x: -3, y: 3, z }, { x: 0, y: -1, z: 0 }), 3, true, undefined, QUERY_MOVE);
      expect(3 - hit!.timeOfImpact, `at z ${z}`).toBeGreaterThan(1.9);
    }
  });

  it.each([
    ["the courtyard behind Blue's arcade", { x: -16.6, y: 0.1, z: 12 }],
    ["the western sand", { x: -45, y: 1, z: 24 }],
    ["the north-west corner", { x: -37, y: 3, z: -33 }],
    ["the sand behind the plaza", { x: 28, y: 2, z: -28 }],
    ["the sand south of the courtyard", { x: -19, y: 2, z: 25 }],
    ["the strip beside the hall stair", { x: -7, y: 0.3, z: 18 }],
    ["the sand against the southern cliff", { x: -3, y: 4.5, z: 39 }],
  ])("walls off %s", (_, point) => {
    const start = map.spawns.find((s) => s.team === 1)!;
    const path = getNav("desert").computePath(start, point, { halfExtents: { x: 1.5, y: 3, z: 1.5 }, maxPathPolys: 4096 }).path;
    const last = path[path.length - 1];
    // A path may end on a floor above the spot, which isn't reaching it.
    expect(!last || Math.hypot(last.x - point.x, last.z - point.z) > 2 || Math.abs(last.y - point.y) > 2).toBe(true);
  });

  it("stops players at the source's player clips but lets bullets through them", () => {
    // The clip lid over the town (8.4 to 13.4 m) keeps players off the roofs.
    const { x, z } = map.spawns.find((s) => s.team === 1)!;
    const down = new RAPIER.Ray({ x, y: 30, z }, { x: 0, y: -1, z: 0 });
    const moving = world.castRay(down, 40, true, undefined, QUERY_MOVE);
    expect(30 - moving!.timeOfImpact).toBeCloseTo(13.4, 0);
    const shot = raycastWorld(RAPIER, world, [x, 30, z], [0, -1, 0], 40);
    expect(shot!.point[1]).toBeLessThan(1);
  });

  it.each([
    // North: the yard north of Blue's spawn up onto the B side's ledge.
    ["north", [-27, 1.6, -15], [[-24.5, -15], [-21.5, -15], [-19.5, -15]], [-19.5, 3.8, -15]],
    // North of Red's spawn: the paved way from the street up to the plaza.
    ["north-east", [33, 3.4, -19], [[30, -22.1], [27, -22.1], [23, -22.3]], [23, 5.05, -22.3]],
    // The hall's own stair, down its landing to the room under the hall.
    ["hall", [-3, 0.7, 21.5], [[-3, 23], [-3, 26], [-3, 29]], [-3, 3.3, 29]],
  ] as const)("climbs the %s flank stair smoothly, and bots take it", (_, [sx, sy, sz], waypoints, [ex, ey, ez]) => {
    const mover = new Mover(RAPIER, world), s = newMoveState(0, 0, 0);
    mover.teleport(s, sx, sy, sz);
    const input: MoveInput = { forward: 1, right: 0, yaw: 0, jump: false, sprint: false, crouch: false, ads: 0, speedMult: 1 };
    let worst = 0;
    try {
      let k = 0;
      for (let i = 0; i < 120 * 10 && k < waypoints.length; i++) {
        const [tx, tz] = waypoints[k];
        if (Math.hypot(tx - s.x, tz - s.z) < 0.35) { k++; continue; }
        input.yaw = Math.atan2(-(tx - s.x), -(tz - s.z));
        const { x, y, z } = s;
        mover.step(s, input, 1 / 120);
        // Height may change no faster than a 50° slope over the tick's travel, plus a little.
        if (i > 12) worst = Math.max(worst, Math.abs(s.y - y) - 1.2 * Math.hypot(s.x - x, s.z - z));
      }
      expect(k, `stopped at ${s.x},${s.y},${s.z}`).toBe(waypoints.length);
      expect(Math.abs(s.y - ey)).toBeLessThan(0.2);
      expect(worst).toBeLessThan(0.12);
    } finally { mover.dispose(); }
    // The bots' navmesh goes the same way, not around.
    const path = getNav("desert").computePath({ x: sx, y: sy, z: sz }, { x: ex, y: ey, z: ez }, { halfExtents: { x: 1, y: 2, z: 1 }, maxPathPolys: 4096 }).path;
    let length = 0;
    for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    expect(length).toBeLessThan(25);
  });

  it.each([
    ["the Red spawn", map.spawns.find((s) => s.team === 2)!],
    ["site A", { x: sites.A[0], y: sites.A[1], z: sites.A[2] }],
    ["site B", { x: sites.B[0], y: sites.B[1], z: sites.B[2] }],
  ])("lets a player walk from the Blue spawn to %s", (_, goal) => {
    // Follow the bots' path with the real player movement: every stair, ramp and sill on the way
    // has to be climbable.
    const nav = getNav("desert");
    const start = map.spawns.find((s) => s.team === 1)!;
    const end = nav.findClosestPoint(goal, { halfExtents: { x: 2, y: 4, z: 2 } }).point;
    const path = nav.computePath(start, end, { halfExtents: { x: 2, y: 3, z: 2 } }).path;
    const mover = new Mover(RAPIER, world), s = newMoveState(0, 0, 0);
    mover.teleport(s, start.x, start.y, start.z);
    const input: MoveInput = { forward: 1, right: 0, yaw: 0, jump: false, sprint: false, crouch: false, ads: 0, speedMult: 1 };
    try {
      let k = 1;
      for (let i = 0; i < 120 * 60 && k < path.length; i++) {
        const target = path[k];
        if (Math.hypot(target.x - s.x, target.z - s.z) < 0.5) { k++; continue; }
        input.yaw = Math.atan2(-(target.x - s.x), -(target.z - s.z));
        mover.step(s, input, 1 / 120);
      }
      expect(Math.hypot(s.x - end.x, s.z - end.z), `stopped at ${s.x},${s.y},${s.z}`).toBeLessThan(1);
      expect(Math.abs(s.y - end.y)).toBeLessThan(0.6);
    } finally { mover.dispose(); }
  });
});
