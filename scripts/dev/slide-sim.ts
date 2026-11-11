// Sprints, slides and slide-jumps across a real map with the real mover and prints what each does.
// Usage: npx tsx scripts/dev/slide-sim.ts [map] [x] [z] [yaw] [hz]
import { createRoomWorld, initWorldData, RAPIER } from "../../server/world";
import { getMap } from "../../game/shared/map/maps";
import { Mover, newMoveState, type MoveInput } from "../../game/shared/movement";
import type { MapId } from "../../game/shared/map/types";

async function main() {
  const [mapId = "outpost", x = "12", z = "19", yaw = "0", hz = "120"] = process.argv.slice(2);
  await initWorldData();
  const world = createRoomWorld(getMap(mapId as MapId));
  const rate = Number(hz), dt = 1 / rate;
  for (const [slide, jump] of [[false, false], [true, false], [true, true]]) {
    const mover = new Mover(RAPIER, world), s = newMoveState(0, 0, 0);
    mover.teleport(s, Number(x), 0.5, Number(z));
    const input: MoveInput = { forward: 1, right: 0, yaw: Number(yaw), jump: false, sprint: true, crouch: false, ads: 0, speedMult: 0.95 };
    const line: string[] = [];
    let started = -1, ended = -1, from = 0;
    for (let i = 0; i < rate * 2.6; i++) {
      const t = i * dt;
      input.crouch = slide && t >= 1.2 && !(jump && t >= 1.4);
      input.jump = jump && t >= 1.35 && t < 1.4;
      const was = s.sliding;
      mover.step(s, input, dt);
      if (s.sliding && !was) { started = t; from = Math.hypot(s.x, s.z); }
      if (!s.sliding && was) ended = t;
      if (i % Math.round(rate / 12) === 0) line.push(`${s.sliding ? "S" : s.sprinting ? "R" : "-"}${Math.hypot(s.vx, s.vz).toFixed(1)}${s.grounded ? "" : "^"}@${s.z.toFixed(1)},${s.y.toFixed(2)}`);
    }
    console.log(jump ? "slide-jump" : slide ? "slide " : "sprint", line.join(" "));
    if (slide && !jump) console.log(`slide started ${started.toFixed(2)} s, lasted ${(ended - started).toFixed(2)} s, ${Math.abs(Math.hypot(s.x, s.z) - from).toFixed(1)} m from its start to the end of the run`);
    mover.dispose();
  }
  world.free();
}

main().catch((e) => { console.error(e); process.exit(1); });
