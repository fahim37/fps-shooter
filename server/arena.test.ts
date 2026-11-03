import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRoomWorld, getNav, initWorldData, RAPIER } from "./world";
import { getMap } from "../game/shared/map/maps";
import { buildArena } from "../game/shared/map/arena";
import { lineOfSight, QUERY_MOVE, raycastWorld, type World } from "../game/shared/physics";
import { Mover, newMoveState, type MoveInput } from "../game/shared/movement";
import { EYE_HEIGHT } from "../game/shared/constants";

const map = getMap("arena");
let world: World;
beforeAll(async () => { await initWorldData(); world = createRoomWorld(map); }, 60_000);
afterAll(() => world?.free());

/** Distance to the first thing a horizontal ray from (x, y, z) hits going `dir`, for players (moving) and bullets. */
function hitAlong(x: number, y: number, z: number, dir: [number, number, number]) {
  const ray = new RAPIER.Ray({ x, y, z }, { x: dir[0], y: dir[1], z: dir[2] });
  return {
    moving: world.castRay(ray, 30, true, undefined, QUERY_MOVE)?.timeOfImpact ?? Infinity,
    shot: raycastWorld(RAPIER, world, [x, y, z], dir, 30)?.distance ?? Infinity,
  };
}

describe("chiba arena", () => {
  it("is deterministic, so server and clients build the same world", () => {
    expect(JSON.stringify(buildArena())).toBe(JSON.stringify(buildArena()));
  });

  it("gives each team ten spawns at its end, none in sight of the other team's", () => {
    const eye = (s: { x: number; y: number; z: number }): [number, number, number] => [s.x, s.y + EYE_HEIGHT, s.z];
    const blue = map.spawns.filter((s) => s.team === 1), red = map.spawns.filter((s) => s.team === 2);
    expect(blue).toHaveLength(10);
    expect(red).toHaveLength(10);
    for (const s of blue) expect(s.z).toBeLessThan(-30);
    for (const s of red) expect(s.z).toBeGreaterThan(30);
    for (const b of blue) for (const r of red) expect(lineOfSight(RAPIER, world, eye(b), eye(r)), `${b.x},${b.z} sees ${r.x},${r.z}`).toBe(false);
  });

  it("stops players at the crowd barriers but lets bullets through the railings", () => {
    // The barrier ring crosses the north end at z ≈ -39, with gaps to walk through (looking
    // from just past the cover in front of the course).
    let blocked = 0;
    for (let x = -20; x <= 20; x += 1) {
      const { moving, shot } = hitAlong(x, 1, -36.5, [0, 0, -1]);
      if (moving > 4) continue;
      blocked++;
      expect(shot, `bullet stopped at the barrier at x ${x}`).toBeGreaterThan(moving + 0.5);
    }
    expect(blocked).toBeGreaterThan(10);
    expect(blocked).toBeLessThan(41);
  });

  it("keeps players on the event floor, even jumping from the board", () => {
    // From outside the barrier ring at the south end, toward the board (z ≈ 46).
    for (const y of [0.5, 3]) {
      const { moving } = hitAlong(0, y, 42, [0, 0, 1]);
      expect(42 + moving).toBeGreaterThan(45);
      expect(42 + moving).toBeLessThan(46.5);
    }
  });

  it.each([
    ["the Red spawn", () => map.spawns.find((s) => s.team === 2)!],
    ["the pagoda deck", () => ({ x: -6, y: 3.2, z: 20 })],
    ["the high deck", () => ({ x: 10, y: 3.8, z: 24 })],
  ])("lets a player walk from the Blue spawn to %s", (_, goal) => {
    // Follow the bots' path with the real player movement: every ramp and step on the way has
    // to be climbable.
    const nav = getNav("arena");
    const start = map.spawns.find((s) => s.team === 1)!;
    const end = nav.findClosestPoint(goal(), { halfExtents: { x: 1, y: 0.6, z: 1 } }).point;
    expect(end.y).toBeGreaterThan(goal().y - 0.6);
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
