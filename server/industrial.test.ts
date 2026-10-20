import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRoomWorld, getNav, initWorldData, RAPIER } from "./world";
import { getMap } from "../game/shared/map/maps";
import { buildIndustrial } from "../game/shared/map/industrial";
import { lineOfSight, type World } from "../game/shared/physics";
import { Mover, newMoveState, type MoveInput } from "../game/shared/movement";
import { EYE_HEIGHT } from "../game/shared/constants";

const map = getMap("industrial");
/** Trailer roofs are 3.67 m up; the stairs' collision ramp tops out at 3.6 m against them. */
const ROOF = 3.67;
const stairs = map.pieces.filter((p) => p.name === "Stairs_Steel");

let world: World;
beforeAll(async () => { await initWorldData(); world = createRoomWorld(map); }, 60_000);
afterAll(() => world?.free());

describe("freight yard", () => {
  it("is deterministic, so server and clients build the same world", () => {
    expect(JSON.stringify(buildIndustrial())).toBe(JSON.stringify(buildIndustrial()));
  });

  it("gives both teams mirror-image spawns and pieces", () => {
    const red = map.spawns.filter((s) => s.team === 2);
    for (const s of map.spawns.filter((sp) => sp.team === 1)) {
      expect(red.some((r) => Math.abs(r.x + s.x) < 1e-6 && Math.abs(r.z - s.z) < 1e-6)).toBe(true);
    }
    // Every off-center piece has a mirrored twin (x → -x, same z).
    const key = (name: string, x: number, z: number) => `${name}|${x.toFixed(2)}|${z.toFixed(2)}`;
    const placed = new Set(map.pieces.map((p) => key(p.name, p.x, p.z)));
    for (const p of map.pieces) {
      if (Math.abs(p.x) < 0.01 || Math.abs(p.x) > map.half || Math.abs(p.z) > map.half) continue;
      expect(placed.has(key(p.name, -p.x, p.z)), `${p.name} at ${p.x},${p.z}`).toBe(true);
    }
  });

  it("keeps every Blue spawn out of sight of every Red spawn", () => {
    const eye = (s: { x: number; y: number; z: number }): [number, number, number] => [s.x, s.y + EYE_HEIGHT, s.z];
    const red = map.spawns.filter((s) => s.team === 2);
    for (const b of map.spawns.filter((s) => s.team === 1))
      for (const r of red) expect(lineOfSight(RAPIER, world, eye(b), eye(r)), `${b.x},${b.z} sees ${r.x},${r.z}`).toBe(false);
  });

  it("has two trailer-top overlooks per team that bots can reach by the stairs", () => {
    expect(stairs).toHaveLength(4);
    const nav = getNav("industrial");
    const start = map.spawns[0];
    for (const p of stairs) {
      // One meter past the stairs' top edge, on the trailer roof.
      const target = { x: p.x - Math.sin(p.ry), y: ROOF, z: p.z - Math.cos(p.ry) };
      const res = nav.computePath({ x: start.x, y: start.y, z: start.z }, target, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
      const end = res.path[res.path.length - 1];
      expect(res.success && Math.hypot(end.x - target.x, end.z - target.z) < 1 && end.y > ROOF - 0.4, `overlook at ${p.x},${p.z}`).toBe(true);
    }
  });
});

describe.each([30, 120])("steel stairs at %i Hz", (rate) => {
  for (const p of stairs) {
    it.each([false, true])(`climbs onto the trailer roof at ${p.x},${p.z} and back down, crouched=%s`, (crouch) => {
      const mover = new Mover(RAPIER, world);
      const s = newMoveState(0, 0, 0), dx = Math.sin(p.ry), dz = Math.cos(p.ry);
      const input: MoveInput = { forward: 0, right: 0, yaw: p.ry, jump: false, sprint: false, crouch, ads: 0, speedMult: 1 };
      // The foot of the flight is 5.16 m out along the piece's +Z; start a little beyond it.
      const start = { x: p.x + dx * 6.5, z: p.z + dz * 6.5 };
      mover.teleport(s, start.x, 0.1, start.z);
      try {
        for (let i = 0; i < rate; i++) mover.step(s, input, 1 / rate);
        input.forward = 1;
        let reached = false;
        for (let i = 0; i < rate * 12; i++) {
          mover.step(s, input, 1 / rate);
          const progress = (start.x - s.x) * dx + (start.z - s.z) * dz;
          if (progress > 7 && s.y > ROOF - 0.1 && s.grounded) { reached = true; break; }
        }
        expect(reached, `stopped at ${s.x},${s.y},${s.z}`).toBe(true);
        input.forward = -1;
        for (let i = 0; i < rate * 12; i++) {
          mover.step(s, input, 1 / rate);
          if ((start.x - s.x) * dx + (start.z - s.z) * dz < -0.5 && s.grounded) break;
        }
        expect(s.y).toBeLessThan(0.1);
        expect(s.grounded).toBe(true);
      } finally { mover.dispose(); }
    });
  }
});
