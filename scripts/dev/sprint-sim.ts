// Sprints the shared Mover across every map and reports brief speed dips (stutters) that
// recover on their own, as opposed to running into a wall and staying stopped.
// Usage: npx tsx scripts/dev/sprint-sim.ts
import { createRoomWorld, initWorldData, RAPIER } from "../../server/world";
import { getMap, MAP_IDS } from "../../game/shared/map/maps";
import { Mover, newMoveState, type MoveInput } from "../../game/shared/movement";
import { SPRINT_SPEED } from "../../game/shared/constants";
import { rng } from "../../game/shared/rng";

async function main() {
  await initWorldData();
  const rate = Number(process.argv[2] ?? 120), dt = 1 / rate;
  for (const id of MAP_IDS) {
    const map = getMap(id);
    const world = createRoomWorld(map);
    const mover = new Mover(RAPIER, world);
    const rand = rng(7).next;
    let runs = 0, stutters = 0, lost = 0;
    const examples: string[] = [];
    for (let r = 0; r < 300; r++) {
      const s = newMoveState(0, 0, 0);
      const x = (rand() * 2 - 1) * (map.half - 6), z = (rand() * 2 - 1) * (map.half - 6);
      mover.teleport(s, x, 3, z);
      const input: MoveInput = { forward: 0, right: 0, yaw: rand() * Math.PI * 2, jump: false, sprint: true, crouch: false, ads: 0, speedMult: 1 };
      for (let i = 0; i < rate; i++) mover.step(s, input, dt);
      if (!s.grounded) continue;
      input.forward = 1;
      for (let i = 0; i < rate * 0.4; i++) mover.step(s, input, dt);
      runs++;
      // Realized horizontal speed per step; a stutter dips under 75% then gets back over 95%.
      let dipStart = -1, minV = Infinity, dipY = 0;
      for (let i = 0; i < rate * 3; i++) {
        const px = s.x, pz = s.z, py = s.y;
        mover.step(s, input, dt);
        const v = Math.hypot(s.x - px, s.z - pz) / dt;
        if (dipStart < 0 && v < SPRINT_SPEED * 0.75) { dipStart = i; minV = v; dipY = s.y - py; }
        else if (dipStart >= 0) {
          minV = Math.min(minV, v);
          if (v > SPRINT_SPEED * 0.95) {
            const ms = ((i - dipStart) * 1000) / rate;
            if (ms < 400) {
              stutters++;
              lost += ms;
              if (examples.length < 8) examples.push(`  at ${px.toFixed(2)},${py.toFixed(2)},${pz.toFixed(2)} yaw=${input.yaw.toFixed(2)} for ${ms.toFixed(0)}ms min ${minV.toFixed(2)} m/s dy=${dipY.toFixed(3)} grounded=${s.grounded}`);
            }
            dipStart = -1;
          } else if (i - dipStart > rate * 0.4) dipStart = -1; // Blocked by a wall: not a stutter.
        }
      }
    }
    console.log(`${id} @${rate}Hz: runs=${runs} stutters=${stutters} (${(stutters / runs).toFixed(2)}/3s run, ${lost.toFixed(0)} ms total)`);
    for (const e of examples) console.log(e);
    mover.dispose();
    world.free();
  }
}
main();
