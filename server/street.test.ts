import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRoomWorld, getNav, initWorldData, RAPIER } from "./world";
import { getMap } from "../game/shared/map/maps";
import { buildStreet } from "../game/shared/map/street";
import { lineOfSight, PIECES, QUERY_MOVE, raycastWorld, type World } from "../game/shared/physics";
import { Mover, newMoveState, type MoveInput } from "../game/shared/movement";
import { EYE_HEIGHT, SPRINT_SPEED } from "../game/shared/constants";

const map = getMap("street");
let world: World;
beforeAll(async () => { await initWorldData(); world = createRoomWorld(map); }, 60_000);
afterAll(() => world?.free());

/** Height of the first surface straight down from the sky over (x, z). */
function top(x: number, z: number, from = 60) {
  return from - raycastWorld(RAPIER, world, [x, from, z], [0, -1, 0], from + 1)!.distance;
}

describe("boulevard", () => {
  it("is deterministic, so server and clients build the same world", () => {
    expect(JSON.stringify(buildStreet())).toBe(JSON.stringify(buildStreet()));
  });

  it("gives each team ten spawns at its end, none in sight of the other team's", () => {
    const eye = (s: { x: number; y: number; z: number }): [number, number, number] => [s.x, s.y + EYE_HEIGHT, s.z];
    const blue = map.spawns.filter((s) => s.team === 1), red = map.spawns.filter((s) => s.team === 2);
    expect(blue).toHaveLength(10);
    expect(red).toHaveLength(10);
    for (const s of blue) expect(s.z).toBeLessThan(-28);
    for (const s of red) expect(s.z).toBeGreaterThan(45);
    for (const b of blue) for (const r of red) expect(lineOfSight(RAPIER, world, eye(b), eye(r)), `${b.x},${b.z} sees ${r.x},${r.z}`).toBe(false);
  });

  // Both sides of a thin surface once went through the simplifier together and collapsed: the
  // palace's walls and the terraces lost their collision while every other test still passed.
  it("keeps the source's floors in the collision", () => {
    expect(top(-9, -10)).toBeGreaterThan(1.7); // a terrace
    expect(top(-13, -10)).toBeGreaterThan(2.3); // the top walk
    expect(top(9, 40)).toBeGreaterThan(1); // stairs
    expect(top(-16, 0)).toBeGreaterThan(8); // a roof
  });

  it.each([[-12], [-6], [6], [12]])("stops bullets and players at the palace front at x %d", (x) => {
    const from: [number, number, number] = [x, 10, -40];
    const shot = raycastWorld(RAPIER, world, from, [0, 0, -1], 40)?.distance ?? Infinity;
    expect(shot).toBeLessThan(33);
    const ray = new RAPIER.Ray({ x, y: 1, z: -40 }, { x: 0, y: 0, z: -1 });
    expect(world.castRay(ray, 40, true, undefined, QUERY_MOVE)?.timeOfImpact ?? Infinity).toBeLessThan(33);
  });

  // The stairs are dozens of 7 cm risers, and the step-up used to stall a runner on nearly every
  // one: on the flight at z 16.5, 18 ticks of 40 ran under 85% of sprint speed.
  it.each([[16.5], [-35]])("lets a runner glide up the terrace stairs at z %d", (z) => {
    const mover = new Mover(RAPIER, world), s = newMoveState(0, 0, 0);
    mover.teleport(s, -2, 0.05, z);
    const input: MoveInput = { forward: 1, right: 0, yaw: Math.PI / 2, jump: false, sprint: true, crouch: false, ads: 0, speedMult: 1 };
    for (let i = 0; i < 40; i++) mover.step(s, input, 1 / 60);
    const y0 = s.y;
    let slow = 0, ticks = 0;
    while (s.x > -11 && ticks < 120) {
      const x = s.x;
      mover.step(s, input, 1 / 60);
      ticks++;
      // Along a 30-degree ramp, full sprint is 87% of it level.
      if (Math.abs(s.x - x) * 60 < SPRINT_SPEED * 0.8) slow++;
    }
    expect(s.y - y0, "climbed the flight").toBeGreaterThan(0.4);
    expect(slow, `ticks stalled of ${ticks}`).toBeLessThanOrEqual(2);
  });

  it("hangs the flags down to the floor, as cover that stops bullets", () => {
    // The row at x -6.4 has four flags, z -16.9 to -10.4, with cloth from 1.2 m above the foot.
    // The one at z -10.4 now hangs to the floor.
    for (const x of [-6.3, -6.4, -6.5]) for (const y of [1.1, 1.6, 2.5]) {
      const shot = raycastWorld(RAPIER, world, [x, y, -6], [0, 0, -1], 10)?.distance ?? Infinity;
      expect(Math.abs(-6 - shot + 10.4), `open at x ${x}, y ${y}`).toBeLessThan(0.2);
    }
  });

  it("lets bots walk the length of the road", () => {
    const nav = getNav("street");
    const res = nav.computePath({ x: 0, y: 0, z: -24 }, { x: 0, y: 0, z: 68 }, { halfExtents: { x: 2, y: 3, z: 2 } });
    expect(res.success).toBe(true);
    const end = res.path[res.path.length - 1];
    expect(Math.hypot(end.x, end.z - 68)).toBeLessThan(1.5);
  });

  it("closes every side: clips stand on the wall line", () => {
    const col = PIECES.street.pieces.Clip_Street;
    expect(col.col).toBeDefined();
    for (const [x, z, dir] of [[0, 60, [0, 0, 1]], [14, 60, [0, 0, 1]], [0, 23, [1, 0, 0]], [0, 23, [-1, 0, 0]], [0, -50, [0, 0, -1]], [14, -40, [1, 0, 0]], [-14, -40, [-1, 0, 0]]] as const) {
      const ray = new RAPIER.Ray({ x, y: 3.5, z }, { x: dir[0], y: dir[1], z: dir[2] });
      expect(world.castRay(ray, 80, true, undefined, QUERY_MOVE), `open from ${x},${z}`).not.toBeNull();
    }
  });

  // Facades are ladders of sills, and Rapier reports ground beside a wall: with both, a player
  // holding sprint and jump went 23 m up the palace and out over the clips.
  it.each([
    ["the palace front", 8, 0.1, -48, 0.1, -1],
    ["the plinth corner", 15, 0.1, -50, 0.5, -1],
    ["a terrace bank", -2, 0.05, -10, -1, 0.1],
    ["a building front", -9, 2.5, 0, -1, 0.2],
    ["the gate wall", 12, 2.6, 70, 0.2, 1],
    ["the long wall", 21.8, 0.1, -40, 0.15, 1],
  ])("stops a player climbing %s by jumping", (_, x, y, z, dx, dz) => {
    const mover = new Mover(RAPIER, world), s = newMoveState(0, 0, 0);
    mover.teleport(s, x, y, z);
    const input: MoveInput = { forward: 1, right: 0, yaw: Math.atan2(-dx, -dz), jump: false, sprint: true, crouch: false, ads: 0, speedMult: 1 };
    let top = 0;
    for (let i = 0; i < 60 * 30; i++) {
      input.jump = s.grounded;
      mover.step(s, input, 1 / 60);
      top = Math.max(top, s.y);
    }
    // The terraces top out at 2.5, and a jump adds 1.
    expect(top).toBeLessThan(3.8);
    expect(Math.abs(s.x)).toBeLessThan(22.6);
    expect(Math.abs(s.z)).toBeLessThan(73.2);
  });

  it.each([[-9, -10], [9, 40]])("lets a player walk from the road up onto the terrace at %d,%d", (x, z) => {
    // Follow the bots' path with the real player movement.
    const nav = getNav("street");
    const start = { x: 0, y: 0, z: z + 1 };
    const y = top(x, z, 6);
    const path = nav.computePath(start, { x, y, z }, { halfExtents: { x: 2, y: 3, z: 2 } }).path;
    const mover = new Mover(RAPIER, world), s = newMoveState(0, 0, 0);
    mover.teleport(s, start.x, 0.1, start.z);
    const input: MoveInput = { forward: 1, right: 0, yaw: 0, jump: false, sprint: false, crouch: false, ads: 0, speedMult: 1 };
    let k = 1;
    for (let i = 0; i < 120 * 30 && k < path.length; i++) {
      const target = path[k];
      if (Math.hypot(target.x - s.x, target.z - s.z) < 0.5) { k++; continue; }
      input.yaw = Math.atan2(-(target.x - s.x), -(target.z - s.z));
      mover.step(s, input, 1 / 120);
    }
    expect(Math.hypot(s.x - x, s.z - z), `stopped at ${s.x},${s.y},${s.z}`).toBeLessThan(1.5);
    expect(s.y).toBeGreaterThan(y - 0.5);
  });
});
