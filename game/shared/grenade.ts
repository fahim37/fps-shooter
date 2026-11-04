import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { GRAVITY, SPRINT_SPEED } from "./constants";
import { GRENADE } from "./weapons";
import { GROUP_GRENADE, type Rapier, type World } from "./physics";

type Vec3 = [number, number, number];

/** The server's grenade body. The map's colliders keep Rapier's defaults (friction 0.5, no bounce). */
export const GRENADE_BODY = { radius: 0.07, restitution: 0.38, friction: 0.7, angularDamping: 1.5, density: 3 };
/** Share of the thrower's speed along the aim added to a full throw, and what being off the ground adds (m/s). */
const RUN_CARRY = 0.25;
const AIR_BONUS = 1.2;
/** Share of the thrower's motion a dropped grenade keeps. */
const DROP_CARRY = 0.9;
/** Physics steps per second for grenades (Rapier's default step). */
export const GRENADE_STEP_HZ = 60;

/**
 * Launch velocity of a grenade thrown along `dir` at `power` (lob..1) by a player moving at `vel`.
 * The grenade always goes where the mouse points: movement only changes how hard it's thrown.
 * Running toward the aim and being off the ground each add a little range; strafing or backing
 * away adds nothing and never bends the path. Speeds are capped, since clients report their own.
 * Power 0 drops it, with the thrower's motion: a grenade cooked too long goes off in the hand.
 */
export function grenadeVelocity(dir: Vec3, power: number, vel: Vec3, airborne = false): Vec3 {
  if (power <= 0) {
    const keep = DROP_CARRY * Math.min(1, SPRINT_SPEED / (Math.hypot(vel[0], vel[2]) || 1));
    return [vel[0] * keep, 0, vel[2] * keep];
  }
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const flat = Math.hypot(dir[0], dir[2]) || 1;
  const strength = Math.min(1, Math.max(GRENADE.lobPower, power));
  const forward = Math.min(SPRINT_SPEED, Math.max(0, (vel[0] * dir[0] + vel[2] * dir[2]) / flat));
  const speed = (GRENADE.throwSpeed + forward * RUN_CARRY + (airborne ? AIR_BONUS : 0)) * strength;
  return [dir[0] / len * speed, dir[1] / len * speed + 2, dir[2] / len * speed];
}

/** How far from the blast at `at` the nearest of `points` it can reach is, or null if it reaches none. */
export function blastDistance(at: Vec3, points: Vec3[], reaches: (point: Vec3) => boolean): number | null {
  let nearest: number | null = null;
  for (const p of points) {
    const d = Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]);
    if (d <= GRENADE.radius && (nearest === null || d < nearest) && reaches(p)) nearest = d;
  }
  return nearest;
}

/** Speed (m/s) a body lost to something other than gravity over `seconds`: how hard it hit. */
export function impactSpeed(before: Vec3, after: Vec3, seconds: number) {
  return Math.hypot(after[0] - before[0], after[1] - before[1] + GRAVITY * seconds, after[2] - before[2]);
}

/** The grenade as the server simulates it: a small, heavy ball that bounces a little and rolls. */
export function createGrenadeBody(R: Rapier, world: World, origin: Vec3, vel: Vec3): RAPIER_NS.RigidBody {
  const body = world.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(...origin)
      .setLinvel(...vel)
      .setAngularDamping(GRENADE_BODY.angularDamping)
      .setLinearDamping(GRENADE.linearDamping)
      .setCcdEnabled(true),
  );
  world.createCollider(
    R.ColliderDesc.ball(GRENADE_BODY.radius).setRestitution(GRENADE_BODY.restitution).setFriction(GRENADE_BODY.friction)
      .setDensity(GRENADE_BODY.density).setCollisionGroups(GROUP_GRENADE),
    body,
  );
  return body;
}

export type SurfaceCast = (from: Vec3, dir: Vec3, distance: number) => { distance: number; normal: Vec3 } | null;

export interface GrenadeFlight {
  /** Ball centers, one per physics step, from the hand to the blast. */
  points: Vec3[];
  /** Index into `points` of the first impact, or -1 if it goes off in the air; and that surface. */
  impact: number;
  impactNormal: Vec3 | null;
  /** Where it explodes when the fuse runs out. */
  end: Vec3;
  /** Surface it rests on or last touched at the end; null when it bursts in the air. */
  normal: Vec3 | null;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

// Contact behavior measured from the server's Rapier bodies (see server/grenade.test.ts).
// Rapier averages each pair's restitution with the map's 0.
const BOUNCE = GRENADE_BODY.restitution / 2;
/** Impacts slower than this (m/s, along the normal) settle instead of bouncing. */
const BOUNCE_MIN_SPEED = 2.5;
/** Share of the speed along the surface kept through a bounce, and when settling into a roll. */
const IMPACT_KEEP = 0.65;
const SETTLE_KEEP = 0.55;
/** A rolling ball slows at this rate (1/s): air drag plus the spin's damping, through friction. */
const ROLL_DAMPING = 0.55;

/**
 * Predicts a grenade's flight until its fuse runs out: `fuseSeconds` left after it leaves the
 * hand. Simple contact rules calibrated against Rapier stand in for the physics engine (a full
 * simulation costs too much to run every frame for the aiming arc); `cast` returns the first map
 * surface along a segment.
 */
export function grenadeFlight(origin: Vec3, vel: Vec3, fuseSeconds: number, cast: SurfaceCast): GrenadeFlight {
  const dt = 1 / GRENADE_STEP_HZ, r = GRENADE_BODY.radius;
  const airDrag = 1 / (1 + dt * GRENADE.linearDamping), rollDrag = 1 / (1 + dt * ROLL_DAMPING);
  const points: Vec3[] = [origin];
  let p = origin, v = vel, rolling = false;
  let impact = -1, impactNormal: Vec3 | null = null, normal: Vec3 | null = null;

  const collide = (n: Vec3) => {
    const vn = dot(v, n);
    if (vn >= 0) return;
    const along = add(v, n, -vn);
    const ground = n[1] > 0.7;
    if (-vn > BOUNCE_MIN_SPEED) {
      v = add([along[0] * IMPACT_KEEP, along[1] * IMPACT_KEEP, along[2] * IMPACT_KEEP], n, -vn * BOUNCE);
    } else {
      const keep = ground && !rolling ? SETTLE_KEEP : 1;
      v = [along[0] * keep, along[1] * keep, along[2] * keep];
      if (ground) rolling = true;
    }
    normal = n;
    if (impact < 0) { impact = points.length; impactNormal = n; }
  };

  const steps = Math.max(1, Math.round(fuseSeconds * GRENADE_STEP_HZ));
  for (let i = 0; i < steps; i++) {
    const drag = rolling ? rollDrag : airDrag;
    v = [v[0] * drag, (v[1] - GRAVITY * dt) * drag, v[2] * drag];
    // Rolling: the ground under the ball holds it up, until it rolls off an edge.
    if (rolling) {
      const below = cast(p, [0, -1, 0], r + 0.05);
      if (below) {
        collide(below.normal);
        p = [p[0], p[1] + (r - below.distance) * Math.max(0, below.normal[1]), p[2]];
      } else rolling = false;
    }
    // Sweep along the motion, stopping at the first surface.
    let remaining = dt;
    for (let k = 0; k < 2 && remaining > 1e-6; k++) {
      const speed = Math.hypot(v[0], v[1], v[2]);
      if (speed < 1e-4) break;
      const dir: Vec3 = [v[0] / speed, v[1] / speed, v[2] / speed];
      const travel = speed * remaining;
      const hit = cast(p, dir, travel + r * 4);
      const facing = hit ? -dot(dir, hit.normal) : 0;
      // The ball touches a surface once its center is a radius from it.
      const free = hit && facing > 1e-3 ? hit.distance - r / Math.max(facing, 0.25) : Infinity;
      if (free >= travel) { p = add(p, dir, travel); break; }
      p = add(p, dir, Math.max(0, free));
      remaining -= Math.max(0, free) / speed;
      collide(hit!.normal);
    }
    points.push(p);
  }
  return { points, impact, impactNormal, end: p, normal: rolling ? normal : null };
}
