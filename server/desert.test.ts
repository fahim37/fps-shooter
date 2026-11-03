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
