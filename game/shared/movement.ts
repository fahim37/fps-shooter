import type RAPIER_NS from "@dimforge/rapier3d-compat";
import type { Rapier, World } from "./physics";
import { GROUP_CHARACTER, QUERY_WORLD } from "./physics";
import {
  PLAYER_RADIUS, PLAYER_HEIGHT, WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED, ADS_SPEED_MULT,
  GROUND_ACCEL, AIR_ACCEL, FRICTION, JUMP_VELOCITY, GRAVITY,
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
}

export function newMoveState(x: number, y: number, z: number): MoveState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, airTime: 0, landSpeed: 0, sprinting: false };
}

const HALF = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;
const CENTER = PLAYER_HEIGHT / 2;

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
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
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
    s.grounded = s.sprinting = false;
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

    s.sprinting = inp.sprint && inp.forward > 0.5 && !inp.crouch && inp.ads < 0.3 && s.grounded;
    let speed = inp.crouch ? CROUCH_SPEED : s.sprinting ? SPRINT_SPEED : WALK_SPEED;
    speed *= 1 - (1 - ADS_SPEED_MULT) * inp.ads;
    speed *= inp.speedMult;

    const targetX = wx * speed, targetZ = wz * speed;
    if (s.grounded) {
      // Friction then acceleration toward the wish velocity.
      const hv = Math.hypot(s.vx, s.vz);
      if (hv > 0) {
        const drop = Math.max(hv - FRICTION * dt * Math.max(hv, 2), 0) / hv;
        if (len < 0.01) { s.vx *= drop; s.vz *= drop; }
      }
      accelerate(s, targetX, targetZ, GROUND_ACCEL * dt);
    } else {
      accelerate(s, targetX, targetZ, AIR_ACCEL * dt);
    }

    s.vy -= GRAVITY * dt;
    if (inp.jump && (s.grounded || s.airTime < 0.12) && s.vy <= 0.5) {
      s.vy = JUMP_VELOCITY;
      s.grounded = false;
      s.airTime = 1;
    }

    const desired = { x: s.vx * dt, y: s.vy * dt, z: s.vz * dt };
    this.collider.setTranslation({ x: s.x, y: s.y + CENTER, z: s.z });
    this.kcc.computeColliderMovement(this.collider, desired, this.R.QueryFilterFlags.EXCLUDE_SENSORS, QUERY_WORLD);
    const m = this.kcc.computedMovement();
    const wasGrounded = s.grounded;
    s.grounded = this.kcc.computedGrounded();

    s.x += m.x; s.y += m.y; s.z += m.z;
    this.collider.setTranslation({ x: s.x, y: s.y + CENTER, z: s.z });

    // Blocked horizontally: bleed velocity so we don't keep pushing into walls.
    if (Math.abs(m.x) < Math.abs(desired.x) - 1e-4) s.vx = m.x / dt;
    if (Math.abs(m.z) < Math.abs(desired.z) - 1e-4) s.vz = m.z / dt;
    // Bumped a ceiling.
    if (s.vy > 0 && m.y < desired.y - 1e-4) s.vy = 0;

    if (s.grounded) {
      if (!wasGrounded) s.landSpeed = Math.max(s.landSpeed, -s.vy);
      s.vy = Math.max(s.vy, -1);
      s.airTime = 0;
    } else {
      s.airTime += dt;
    }
    // Safety net: never fall out of the world.
    if (s.y < -20) this.teleport(s, 0, 2, 0);
  }
}

function accelerate(s: MoveState, tx: number, tz: number, maxDelta: number) {
  const dx = tx - s.vx, dz = tz - s.vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d === 0) { s.vx = tx; s.vz = tz; return; }
  s.vx += (dx / d) * maxDelta;
  s.vz += (dz / d) * maxDelta;
}
