import type RAPIER_NS from "@dimforge/rapier3d-compat";
import type { Rapier, World } from "./physics";
import { GROUP_CHARACTER, QUERY_MOVE } from "./physics";
import {
  PLAYER_RADIUS, PLAYER_HEIGHT, WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED, ADS_SPEED_MULT,
  GROUND_ACCEL, AIR_ACCEL, FRICTION, JUMP_VELOCITY, GRAVITY,
  SLIDE_SPEED, SLIDE_FRICTION, SLIDE_END_SPEED, SLIDE_MIN_ENTRY, SLIDE_MAX_SECONDS, SLIDE_COOLDOWN, SLIDE_STEER,
} from "./constants";

export interface MoveInput {
  /** -1..1 forward/back and right/left relative to `yaw`. */
  forward: number;
  right: number;
  /** Radians; 0 looks toward -Z. */
  yaw: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  /** 0..1 aim-down-sights amount. */
  ads: number;
  /** Weapon handling multiplier on speed. */
  speedMult: number;
}

export interface MoveState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  grounded: boolean;
  /** Seconds since last on the ground (coyote time for jumps). */
  airTime: number;
  /** Impact speed of the most recent landing (for fall damage and camera dip), cleared by the caller. */
  landSpeed: number;
  sprinting: boolean;
  /** Sliding on the ground out of a sprint, for how long, and the wait left before the next (s). */
  sliding: boolean;
  slideTime: number;
  slideCooldown: number;
  /** Crouch was held last step (a slide starts on the press), or pressed in the air to slide on landing. */
  crouchHeld: boolean;
  slideQueued: boolean;
}

export function newMoveState(x: number, y: number, z: number): MoveState {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, airTime: 0, landSpeed: 0, sprinting: false,
    sliding: false, slideTime: 0, slideCooldown: 0, crouchHeld: false, slideQueued: false,
  };
}

const HALF = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;
const CENTER = PLAYER_HEIGHT / 2;
const MAX_SLOPE = (50 * Math.PI) / 180;
/** Contact normals at least this upright are floor (the climbable slope limit). */
const WALKABLE_NORMAL_Y = Math.cos(MAX_SLOPE) - 1e-3;
/** How far ahead a blocked move probes for a step: a 30 Hz tick at walking speed, as bots move. */
const STEP_PROBE = 0.17;

/**
 * Kinematic character movement on top of Rapier's character controller. Shared by the
 * client (local player) and the server (bots), so both move identically.
 */
export class Mover {
  readonly collider: RAPIER_NS.Collider;
  private kcc: RAPIER_NS.KinematicCharacterController;

  constructor(private R: Rapier, private world: World) {
    this.collider = world.createCollider(
      R.ColliderDesc.capsule(HALF, PLAYER_RADIUS).setCollisionGroups(GROUP_CHARACTER),
    );
    this.kcc = world.createCharacterController(0.02);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setMaxSlopeClimbAngle(MAX_SLOPE);
    this.kcc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.kcc.enableAutostep(0.42, 0.15, false);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setSlideEnabled(true);
  }

  dispose() {
    this.world.removeCharacterController(this.kcc);
    this.world.removeCollider(this.collider, false);
  }

  teleport(s: MoveState, x: number, y: number, z: number) {
    s.x = x; s.y = y; s.z = z;
    s.vx = s.vy = s.vz = 0;
    s.grounded = s.sprinting = s.sliding = s.slideQueued = false;
    s.slideTime = s.slideCooldown = 0;
    s.airTime = 1;
    s.landSpeed = 0;
    this.collider.setTranslation({ x, y: y + CENTER, z });
  }

  step(s: MoveState, inp: MoveInput, dt: number) {
    const sin = Math.sin(inp.yaw), cos = Math.cos(inp.yaw);
    // Forward is -Z at yaw 0; right is +X.
    let wx = -sin * inp.forward + cos * inp.right;
    let wz = -cos * inp.forward - sin * inp.right;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }

    // Crouching out of a sprint slides. Pressed in the air, it slides on landing instead.
    const pressedCrouch = inp.crouch && !s.crouchHeld;
    s.crouchHeld = inp.crouch;
    if (pressedCrouch && s.sprinting && !s.grounded) s.slideQueued = true;
    if (!inp.crouch) s.slideQueued = false;
    s.slideCooldown = Math.max(0, s.slideCooldown - dt);
    const entry = Math.hypot(s.vx, s.vz);
    if (!s.sliding && s.grounded && s.slideCooldown <= 0 && entry > SLIDE_MIN_ENTRY && (s.slideQueued || pressedCrouch && s.sprinting)) {
      s.sliding = true;
      s.slideTime = 0;
      const k = Math.max(entry, SLIDE_SPEED * inp.speedMult) / entry;
      s.vx *= k; s.vz *= k;
    }
    if (s.grounded) s.slideQueued = false;

    // A sprint starts on the ground but carries through the air: dropping off a curb or
    // jumping must not fall back to walking speed and then have to build the sprint again.
    s.sprinting = inp.sprint && len > 0.12 && inp.forward >= 0 && !inp.crouch && inp.ads < 0.3 && (s.grounded || s.sprinting);
    let speed = inp.crouch ? CROUCH_SPEED : s.sprinting ? SPRINT_SPEED : WALK_SPEED;
    speed *= 1 - (1 - ADS_SPEED_MULT) * inp.ads;
    speed *= inp.speedMult;

    const jumping = inp.jump && (s.grounded || s.airTime < 0.12) && s.vy <= 0.5;
    const slideJump = s.sliding && jumping;
    if (s.sliding) {
      s.slideTime += dt;
      const hv = Math.hypot(s.vx, s.vz);
      // Standing up, running out of speed or time, leaving the ground or jumping ends it. The jump
      // keeps the slide's speed: the air neither brakes nor adds to it.
      if (!inp.crouch || jumping || hv < SLIDE_END_SPEED || s.slideTime > SLIDE_MAX_SECONDS || !s.grounded && s.airTime > 0.15) {
        s.sliding = false;
        s.slideCooldown = SLIDE_COOLDOWN;
      } else if (s.grounded) {
        slide(s, wx, wz, hv, dt);
      }
    }
    if (!s.sliding && !slideJump) {
      if (s.grounded) {
        // Friction then acceleration toward the wish velocity.
        const hv = Math.hypot(s.vx, s.vz);
        if (hv > 0) {
          const drop = Math.max(hv - FRICTION * dt * Math.max(hv, 2), 0) / hv;
          if (len < 0.01) { s.vx *= drop; s.vz *= drop; }
        }
        accelerate(s, wx * speed, wz * speed, GROUND_ACCEL * dt, s.sprinting);
      } else {
        airAccelerate(s, wx, wz, speed, AIR_ACCEL * dt);
      }
    }

    s.vy -= GRAVITY * dt;
    if (jumping) {
      s.vy = JUMP_VELOCITY;
      s.grounded = false;
      s.airTime = 1;
    }

    const desired = { x: s.vx * dt, y: s.vy * dt, z: s.vz * dt };
    this.collider.setTranslation({ x: s.x, y: s.y + CENTER, z: s.z });
    this.kcc.computeColliderMovement(this.collider, desired, this.R.QueryFilterFlags.EXCLUDE_SENSORS, QUERY_MOVE);
    let m = this.kcc.computedMovement();
    const wasGrounded = s.grounded;
    // Rapier also reports ground for a capsule brushing a vertical wall in the air. Believed, each
    // such moment is a fresh jump and any wall is a ladder, so landing takes a walkable contact.
    s.grounded = this.kcc.computedGrounded() && (wasGrounded || this.touchedFloor());
    let wall = this.touchedWall();
    if (wasGrounded && !wall && desired.y <= 0 && Math.hypot(m.x, m.z) < Math.hypot(desired.x, desired.z) * 0.5) {
      // Rapier now and then stops a step dead on flat floor when it carries gravity's small
      // downward pull, instead of sliding along it; the same move made level goes through.
      this.kcc.computeColliderMovement(this.collider, { x: desired.x, y: 0, z: desired.z }, this.R.QueryFilterFlags.EXCLUDE_SENSORS, QUERY_MOVE);
      m = this.kcc.computedMovement();
      s.grounded ||= this.kcc.computedGrounded();
      wall = this.touchedWall();
    }
    if (wasGrounded && wall && desired.y <= 0) {
      // Rapier's autostep only takes a step when one move carries the capsule far enough past its
      // edge: at the client's 120 Hz a tick's few centimeters stop dead at anything over 0.25 m.
      // Probe the same way further, and if that climbs a step, rise onto it and go this tick's
      // distance.
      const want = Math.hypot(desired.x, desired.z), got = Math.hypot(m.x, m.z);
      if (want > 1e-4 && got < want * 0.9) {
        const k = Math.max(1, STEP_PROBE / want);
        this.kcc.computeColliderMovement(this.collider, { x: desired.x * k, y: 0, z: desired.z * k }, this.R.QueryFilterFlags.EXCLUDE_SENSORS, QUERY_MOVE);
        const probe = this.kcc.computedMovement();
        if (probe.y > 0.02 && Math.hypot(probe.x, probe.z) > want) {
          m = { x: desired.x, y: probe.y, z: desired.z };
          s.grounded = true;
          wall = false;
        }
      }
    }

    s.x += m.x; s.y += m.y; s.z += m.z;
    this.collider.setTranslation({ x: s.x, y: s.y + CENTER, z: s.z });

    // Blocked horizontally: bleed velocity so we don't keep pushing into walls. Only a wall
    // can block; a step cut short by the floor alone must not throw away a sprint's momentum.
    if (wall) {
      if (Math.abs(m.x) < Math.abs(desired.x) - 1e-4) s.vx = m.x / dt;
      if (Math.abs(m.z) < Math.abs(desired.z) - 1e-4) s.vz = m.z / dt;
    }
    // Bumped a ceiling.
    if (s.vy > 0 && m.y < desired.y - 1e-4) s.vy = 0;

    if (s.grounded) {
      if (!wasGrounded) s.landSpeed = Math.max(s.landSpeed, -s.vy);
      // Ground contact cancels gravity. Carrying downward velocity into the next
      // tick projects it against stair edges and cancels a slow uphill start.
      s.vy = 0;
      s.airTime = 0;
    } else {
      s.airTime += dt;
    }
    // Safety net: never fall out of the world.
    if (s.y < -20) this.teleport(s, 0, 2, 0);
  }

  /** Whether the last move hit anything a player can stand on. */
  private touchedFloor() {
    for (let i = this.kcc.numComputedCollisions() - 1; i >= 0; i--) {
      const hit = this.kcc.computedCollision(i);
      if (hit && hit.normal1.y >= WALKABLE_NORMAL_Y) return true;
    }
    return false;
  }

  /** Whether the last move hit anything too steep to walk on. */
  private touchedWall() {
    for (let i = this.kcc.numComputedCollisions() - 1; i >= 0; i--) {
      const hit = this.kcc.computedCollision(i);
      if (hit && hit.normal1.y < WALKABLE_NORMAL_Y) return true;
    }
    return false;
  }
}

function accelerate(s: MoveState, tx: number, tz: number, maxDelta: number, preserveTurningSpeed = false) {
  // Blending velocity vectors cuts through a shorter diagonal while steering.
  // Keep sprint momentum through turns, while allowing braking for a reversal.
  const speedFloor = preserveTurningSpeed && s.vx * tx + s.vz * tz >= -1e-8
    ? Math.min(Math.hypot(s.vx, s.vz), Math.hypot(tx, tz)) : 0;
  const dx = tx - s.vx, dz = tz - s.vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d === 0) { s.vx = tx; s.vz = tz; return; }
  s.vx += (dx / d) * maxDelta;
  s.vz += (dz / d) * maxDelta;
  const speed = Math.hypot(s.vx, s.vz);
  if (speed > 0 && speed < speedFloor) {
    s.vx *= speedFloor / speed;
    s.vz *= speedFloor / speed;
  }
}

/**
 * In the air nothing brakes: a jump keeps the speed it left the ground with. The keys steer that
 * speed around and can build up to `wishSpeed` from less, or push against it to slow down, but
 * never add to a speed already past it (no gaining speed by strafing through the air).
 */
function airAccelerate(s: MoveState, wx: number, wz: number, wishSpeed: number, maxDelta: number) {
  const len = Math.hypot(wx, wz);
  if (len < 0.01) return;
  const dx = wx / len, dz = wz / len;
  const before = Math.hypot(s.vx, s.vz);
  const target = wishSpeed * Math.min(1, len);
  const add = Math.min(maxDelta, target - (s.vx * dx + s.vz * dz));
  if (add <= 0) return;
  s.vx += dx * add; s.vz += dz * add;
  const cap = Math.max(before, target), now = Math.hypot(s.vx, s.vz);
  if (now > cap) { s.vx *= cap / now; s.vz *= cap / now; }
}

/** One step of a slide at speed `hv`: the ground drags it down, and the keys bend its direction a little. */
function slide(s: MoveState, wx: number, wz: number, hv: number, dt: number) {
  if (hv <= 0) return;
  let dx = s.vx / hv, dz = s.vz / hv;
  const turn = (dx * wz - dz * wx) * SLIDE_STEER * dt;
  if (Math.abs(turn) > 1e-6) {
    const c = Math.cos(turn), sn = Math.sin(turn);
    [dx, dz] = [dx * c - dz * sn, dx * sn + dz * c];
  }
  const next = Math.max(0, hv - SLIDE_FRICTION * dt);
  s.vx = dx * next; s.vz = dz * next;
}
