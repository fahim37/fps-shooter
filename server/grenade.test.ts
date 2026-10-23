import { afterAll, beforeAll, expect, it } from "vitest";
import { createRoomWorld, initWorldData, RAPIER } from "./world";
import { getMap } from "../game/shared/map/maps";
import { raycastWorld, type World } from "../game/shared/physics";
import { GRENADE_STEP_HZ, createGrenadeBody, grenadeFlight, grenadeVelocity } from "../game/shared/grenade";
import { GRENADE } from "../game/shared/weapons";

type V3 = [number, number, number];
let world: World;
beforeAll(async () => { await initWorldData(); world = createRoomWorld(getMap("industrial")); }, 60_000);
afterAll(() => world?.free());

/** Where the server's Rapier body is when the fuse runs out. */
function serverBlast(origin: V3, vel: V3, seconds: number): V3 {
  const body = createGrenadeBody(RAPIER, world, origin, vel);
  for (let i = 0; i < Math.round(seconds * GRENADE_STEP_HZ); i++) world.step();
  const t = body.translation();
  world.removeRigidBody(body);
  return [t.x, t.y, t.z];
}

it("predicts where the server's grenade goes off, closely enough to aim by", () => {
  const cast = (from: V3, dir: V3, distance: number) => raycastWorld(RAPIER, world, from, dir, distance);
  const errors: number[] = [];
  for (const [x, z] of [[-40, 20], [-30, -10], [-14, -2], [12, -22]]) for (const yaw of [0, 1.3, 2.6, 4.2]) for (const pitch of [-0.2, 0.15, 0.6]) {
    for (const [power, fuse] of [[1, GRENADE.fuseMs / 1000], [GRENADE.lobPower, GRENADE.fuseMs / 1000], [1, 1.1]]) {
      const origin: V3 = [x, 1.52, z];
      const vel = grenadeVelocity([-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)], power, [0, 0, 0]);
      const real = serverBlast(origin, vel, fuse);
      const { end } = grenadeFlight(origin, vel, fuse, cast);
      errors.push(Math.hypot(real[0] - end[0], real[1] - end[1], real[2] - end[2]));
    }
  }
  errors.sort((a, b) => a - b);
  // Grazing hits on corners can differ (a ray stands in for the ball), but a typical blast lands
  // within a meter of the marker, and nearly all well inside the blast radius.
  expect(errors[errors.length >> 1]).toBeLessThan(1.2);
  expect(errors[Math.floor(errors.length * 0.9)]).toBeLessThan(GRENADE.radius * 0.35);
}, 60_000);
