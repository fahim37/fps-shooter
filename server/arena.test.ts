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

  it("puts cover between every team spawn and the fight", () => {
    for (const s of map.spawns.filter((p) => p.team !== 0)) {
      for (const turn of [-0.5, 0, 0.5]) {
        const yaw = s.yaw + turn;
        const { shot } = hitAlong(s.x, s.y + EYE_HEIGHT, s.z, [-Math.sin(yaw), 0, -Math.cos(yaw)]);
        expect(shot, `spawn ${s.x},${s.z} is open ${turn} rad off its facing`).toBeLessThan(3.6);
      }
    }
  });

  it("stands every free-for-all spawn next to cover", () => {
    for (const s of map.spawns.filter((p) => p.team === 0)) {
      let sides = 0;
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        if (hitAlong(s.x, s.y + 1.1, s.z, [-Math.sin(a), 0, -Math.cos(a)]).shot < 3.6) sides++;
      }
      expect(sides, `spawn ${s.x},${s.y},${s.z}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("stops a walking player at the crowd barriers but lets bullets through the railings", () => {
    // The barrier ring crosses the north end at z ≈ -39, with gaps to walk through (looking
    // from just past the cover in front of the course).
    let blocked = 0;
    for (let x = -20; x <= 20; x += 1) {
      const { moving, shot } = hitAlong(x, 0.5, -36.5, [0, 0, -1]);
      if (moving > 4) continue;
      blocked++;
      expect(shot, `bullet stopped at the barrier at x ${x}`).toBeGreaterThan(moving + 0.5);
    }
    expect(blocked).toBeGreaterThan(10);
    expect(blocked).toBeLessThan(41);
  });

  it.each([
    ["out of the ring", -37, 0, -40.5],
    ["back into it", -41, Math.PI, -37.5],
  ])("lets a player jump the crowd barriers %s, but not walk through them", (_, startZ, yaw, pastZ) => {
    // At x = -1 the rail runs at z ≈ -39, clear of the cover on both sides.
    const way = Math.sign(pastZ - startZ);
    const railZ = startZ + way * hitAlong(-1, 0.5, startZ, [0, 0, way]).moving;
    expect(Math.abs(railZ + 39)).toBeLessThan(1);
    /** Runs at the rail, jumping within `takeoff` m of it; true once past it. */
    const crosses = (takeoff: number, dt: number, sprint: boolean) => {
      const mover = new Mover(RAPIER, world), s = newMoveState(0, 0, 0);
      mover.teleport(s, -1, 0.1, startZ);
      const input: MoveInput = { forward: 1, right: 0, yaw, jump: false, sprint, crouch: false, ads: 0, speedMult: 1 };
      try {
        for (let t = 0; t < 4; t += dt) {
          input.jump = Math.abs(s.z - railZ) < takeoff;
          mover.step(s, input, dt);
          if ((s.z - pastZ) * way > 0) return true;
        }
        return false;
      } finally { mover.dispose(); }
    };
    expect(crosses(0, 1 / 120, true)).toBe(false);
    // From a run-up at any distance, or pressed right against the rail, on any frame rate.
    for (const takeoff of [0.4, 0.7, 1, 1.3]) for (const dt of [1 / 120, 1 / 60, 1 / 30]) for (const sprint of [false, true]) {
      expect(crosses(takeoff, dt, sprint), `takeoff ${takeoff} m, step ${dt}, sprint ${sprint}`).toBe(true);
    }
  });

  it("leaves a way out of every spawn", () => {
    const nav = getNav("arena");
    for (const s of map.spawns) {
      const { path, success } = nav.computePath(s, { x: 0, y: 0, z: s.z < 0 ? -22 : 29 }, { halfExtents: { x: 2, y: 3, z: 2 } });
      expect(success, `spawn ${s.x},${s.y},${s.z}`).toBe(true);
      expect(Math.hypot(path[0].x - s.x, path[0].z - s.z), `spawn ${s.x},${s.y},${s.z} is off the navmesh`).toBeLessThan(1.5);
    }
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
