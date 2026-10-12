import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRoomWorld, initWorldData, RAPIER } from "./world";
import { getMap } from "../game/shared/map/maps";
import { Mover, newMoveState, type MoveInput } from "../game/shared/movement";
import type { World } from "../game/shared/physics";

const map = getMap("downtown");
let world: World;
beforeAll(async () => { await initWorldData(); world = createRoomWorld(map); }, 60_000);
afterAll(() => world?.free());

describe.each([30, 120])("stairs at %i Hz", (rate) => {
  for (const p of map.pieces.filter((piece) => piece.name === "Stairs_Entrance_Concrete" && piece.y === 0.15)) {
    it.each([false, true])(`walks up and down the full staircase at ${p.x},${p.z}, crouched=%s`, (crouch) => {
      const mover = new Mover(RAPIER, world);
      const s = newMoveState(0, 0, 0), dx = Math.sin(p.ry), dz = Math.cos(p.ry);
      const input: MoveInput = { forward: 0, right: 0, yaw: p.ry, jump: false, sprint: false, crouch, ads: 0, speedMult: 1 };
      const start = { x: p.x + dx * 2.7, z: p.z + dz * 2.7 };
      mover.teleport(s, start.x, 0.21, start.z);
      try {
        for (let i = 0; i < rate; i++) mover.step(s, input, 1 / rate);
        input.forward = 1;
        let reached = false;
        for (let i = 0; i < rate * 12; i++) {
          mover.step(s, input, 1 / rate);
          const progress = (start.x - s.x) * dx + (start.z - s.z) * dz;
          if (progress > 7 && s.y > 3.1 && s.grounded) { reached = true; break; }
        }
        expect(reached, `stopped at ${s.x},${s.y},${s.z}`).toBe(true);
        input.forward = -1;
        for (let i = 0; i < rate * 12; i++) {
          mover.step(s, input, 1 / rate);
          if ((start.x - s.x) * dx + (start.z - s.z) * dz < -0.5 && s.grounded) break;
        }
        // The shop's ground-floor apron is 15 cm above the street.
        expect(s.y).toBeLessThan(0.22);
        expect(s.grounded).toBe(true);
      } finally { mover.dispose(); }
    });
  }

  it("still blocks tall walls and lets the player jump and land", () => {
    const mover = new Mover(RAPIER, world), s = newMoveState(0, 0, 0);
    const input: MoveInput = { forward: 0, right: 0, yaw: 0, jump: false, sprint: false, crouch: false, ads: 0, speedMult: 1 };
    mover.teleport(s, 0, 0.1, 0);
    try {
      for (let i = 0; i < rate; i++) mover.step(s, input, 1 / rate);
      input.jump = true; mover.step(s, input, 1 / rate); input.jump = false;
      let apex = s.y;
      for (let i = 0; i < rate * 2; i++) { mover.step(s, input, 1 / rate); apex = Math.max(apex, s.y); }
      expect(apex).toBeGreaterThan(0.8);
      expect(s.grounded).toBe(true);
      mover.teleport(s, 0, 0.1, -map.half + 1);
      input.forward = 1;
      for (let i = 0; i < rate * 2; i++) mover.step(s, input, 1 / rate);
      expect(s.z).toBeGreaterThan(-map.half);
      expect(s.y).toBeLessThan(0.1);
    } finally { mover.dispose(); }
  });
});
