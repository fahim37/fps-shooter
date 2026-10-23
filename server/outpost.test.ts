import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRoomWorld, getNav, initWorldData, RAPIER } from "./world";
import { getMap } from "../game/shared/map/maps";
import { buildOutpost } from "../game/shared/map/outpost";
import { lineOfSight, type World } from "../game/shared/physics";
import { Mover, newMoveState, type MoveInput } from "../game/shared/movement";
import { EYE_HEIGHT } from "../game/shared/constants";

const map = getMap("outpost");
let world: World;
beforeAll(async () => { await initWorldData(); world = createRoomWorld(map); }, 60_000);
afterAll(() => world?.free());

describe("outpost", () => {
  it("is deterministic, so server and clients build the same world", () => {
    expect(JSON.stringify(buildOutpost())).toBe(JSON.stringify(buildOutpost()));
  });

  it("is sized for 6v6: a walled compound of about 34 x 66 m", () => {
    const area = map.overview.plazas[0];
    expect(area.sx).toBeGreaterThan(30);
    expect(area.sz).toBeGreaterThan(60);
    expect(map.spawns.filter((s) => s.team === 1)).toHaveLength(10);
    expect(map.spawns.filter((s) => s.team === 2)).toHaveLength(10);
  });

  it("keeps every Blue spawn out of sight of every Red spawn", () => {
    const eye = (s: { x: number; y: number; z: number }): [number, number, number] => [s.x, s.y + EYE_HEIGHT, s.z];
    const red = map.spawns.filter((s) => s.team === 2);
    for (const b of map.spawns.filter((s) => s.team === 1))
      for (const r of red) expect(lineOfSight(RAPIER, world, eye(b), eye(r)), `${b.x},${b.z} sees ${r.x},${r.z}`).toBe(false);
  });

  it.each([[-9, 4.2, -28.5], [0, 4.2, 27]])("lets a player walk from the field up onto the platform at %d,%d,%d", (x, y, z) => {
    // Follow the bots' path with the real player movement.
    const nav = getNav("outpost");
    const start = { x: 0, y: 0, z: Math.sign(z) * 18 };
    const path = nav.computePath(start, { x, y, z }, { halfExtents: { x: 2, y: 3, z: 2 } }).path;
    const mover = new Mover(RAPIER, world), s = newMoveState(0, 0, 0);
    mover.teleport(s, start.x, 0.1, start.z);
    const input: MoveInput = { forward: 1, right: 0, yaw: 0, jump: false, sprint: false, crouch: false, ads: 0, speedMult: 1 };
    try {
      let k = 1;
      for (let i = 0; i < 120 * 20 && k < path.length; i++) {
        const target = path[k];
        if (Math.hypot(target.x - s.x, target.z - s.z) < 0.5) { k++; continue; }
        input.yaw = Math.atan2(-(target.x - s.x), -(target.z - s.z));
        mover.step(s, input, 1 / 120);
      }
      expect(Math.hypot(s.x - x, s.z - z), `stopped at ${s.x},${s.y},${s.z}`).toBeLessThan(1);
      expect(s.y).toBeGreaterThan(y - 0.3);
    } finally { mover.dispose(); }
  });
});
