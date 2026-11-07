import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRoomWorld, initWorldData, RAPIER } from "./world";
import { getMap } from "../game/shared/map/maps";
import { buildBlockade } from "../game/shared/map/blockade";
import { lineOfSight, type World } from "../game/shared/physics";
import { Mover, newMoveState, type MoveInput } from "../game/shared/movement";
import { EYE_HEIGHT } from "../game/shared/constants";

const map = getMap("blockade");
let world: World;
beforeAll(async () => { await initWorldData(); world = createRoomWorld(map); }, 60_000);
afterAll(() => world?.free());

describe("blockade", () => {
  it("is deterministic, so server and clients build the same world", () => {
    expect(JSON.stringify(buildBlockade())).toBe(JSON.stringify(buildBlockade()));
  });

  it("gives each team ten spawns at its end, none in sight of the other team's", () => {
    const eye = (s: { x: number; y: number; z: number }): [number, number, number] => [s.x, s.y + EYE_HEIGHT, s.z];
    const blue = map.spawns.filter((s) => s.team === 1), red = map.spawns.filter((s) => s.team === 2);
    expect(blue).toHaveLength(10);
    expect(red).toHaveLength(10);
    for (const s of blue) expect(s.z).toBeLessThan(-45);
    for (const s of red) expect(s.z).toBeGreaterThan(45);
    for (const b of blue) for (const r of red) expect(lineOfSight(RAPIER, world, eye(b), eye(r)), `${b.x},${b.z} sees ${r.x},${r.z}`).toBe(false);
  });

  it("keeps sprinting, jumping players inside the walls", () => {
    const mover = new Mover(RAPIER, world), s = newMoveState(0, 0, 0);
    const input: MoveInput = { forward: 1, right: 0, yaw: 0, jump: false, sprint: true, crouch: false, ads: 0, speedMult: 1 };
    try {
      for (const spawn of map.spawns.filter((_, i) => i % 3 === 0)) for (let d = 0; d < 8; d++) {
        mover.teleport(s, spawn.x, spawn.y, spawn.z);
        input.yaw = (d * Math.PI) / 4;
        for (let i = 0; i < 60 * 15; i++) {
          input.jump = i % 40 === 0;
          mover.step(s, input, 1 / 60);
        }
        expect(Math.abs(s.x), `left the east or west side from ${spawn.x},${spawn.z}`).toBeLessThan(32.5);
        expect(Math.abs(s.z), `left an end from ${spawn.x},${spawn.z}`).toBeLessThan(76.5);
      }
    } finally { mover.dispose(); }
  }, 120_000);
});
