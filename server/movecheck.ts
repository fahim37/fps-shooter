import { GRAVITY, JUMP_VELOCITY, SPRINT_SPEED } from "../game/shared/constants";

type V3 = [number, number, number];

/** Distance to the first map surface along a unit ray (player clips included), or null. */
export type MoveCast = (origin: V3, dir: V3, maxDist: number) => number | null;

/**
 * Sustained ground speed a client may report (m/s): a sprint with the lightest gun (x1.05), and
 * slack for air control and frame-paced poses. A dash spends its own allowance on top.
 */
export const MOVE_RATE = SPRINT_SPEED * 1.25;
/**
 * The most unspent allowance kept (s of MOVE_RATE). Poses delayed by a network stall arrive
 * together; they still covered the time they were sent in, so a second of travel is honoured.
 */
export const MOVE_BURST_S = 1;
/** Rise above the last floor a jump reaches (JUMP_VELOCITY^2 / 2g ~ 1.02 m), with slack. */
export const JUMP_RISE = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY) + 0.45;
/** Extra rise each dash may add (it lifts about 1.6 m at the steepest look that counts)... */
export const DASH_RISE = 2.1;
/** ...for this long after it starts (ms): its climb, the rest of the rise and the way down. */
export const DASH_LIFT_MS = 1500;
/** Off the ground longer than this, a player must be falling (ms). */
export const HOVER_MS = 1500;
/** Over each HOVER_STEP_MS while hovering-age, a falling body drops well over this much (m). */
export const HOVER_STEP_MS = 500;
export const HOVER_MIN_DROP = 1;
/** The wall check runs at this height above the feet: over any step the mover climbs (0.42 m). */
const WALL_RAY_Y = 0.5;
/** Ground probes start this far above the feet and reach this far below them. */
const PROBE_UP = 0.3, PROBE_DOWN = 0.4;
/** Ground probes: the centre, then a ring inside the capsule's 0.35 m radius. */
const PROBES: [number, number][] = [[0, 0], ...Array.from({ length: 8 }, (_, i): [number, number] => [Math.cos(i * Math.PI / 4) * 0.3, Math.sin(i * Math.PI / 4) * 0.3])];

export type MoveVerdict =
  | { ok: true; /** Landing impact speed (m/s) when this pose touched down, else 0. */ impact: number; /** Dash allowance spent (m). */ dashUsed: number }
  | { ok: false; reason: "speed" | "wall" | "height" | "hover"; /** Where to put the player back. */ to: V3 };

/**
 * Server-side checks on client-reported movement. The client still simulates its own movement
 * (with the same Mover the server runs for bots); these make the reported path physically
 * possible: no faster than a sprint over time, never through map geometry, no higher than a
 * jump (and dashes) over the last floor stood on, and no hanging in the air.
 */
export class MoveGuard {
  /** Metres of travel still allowed. */
  budget = MOVE_RATE * MOVE_BURST_S;
  private at: number;
  /** Last pose stood on the ground, and its height. */
  ground: V3;
  /** When the player left the ground (0: on it), and the highest point since. */
  private airSince = 0;
  private peakY: number;
  /** When recent dashes started: each lifts the height limit for a while, and keeps one aloft. */
  private dashes: number[] = [];
  private checkAt = 0;
  private checkY = 0;

  constructor(at: V3, t: number) {
    this.at = t;
    this.ground = [...at];
    this.peakY = at[1];
  }

  /** A fresh start at a spawn or server correction. */
  reset(at: V3, t: number) {
    this.budget = MOVE_RATE * MOVE_BURST_S;
    this.at = t;
    this.ground = [...at];
    this.peakY = at[1];
    this.airSince = 0;
    this.dashes = [];
  }

  /** A dash started at `t` (ms): it may lift the player DASH_RISE higher, and keep them in the air. */
  dashed(t: number) {
    this.dashes.push(t);
  }

  get airborne() {
    return this.airSince !== 0;
  }

  /**
   * Checks a move from the last accepted pose `from` to the reported `to` at time `t` (ms).
   * `dashExtra` is how much past the usual limit a dash in progress may still carry (m).
   */
  check(from: V3, to: V3, t: number, dashExtra: number, cast: MoveCast): MoveVerdict {
    const elapsed = Math.max(0, Math.min(MOVE_BURST_S, (t - this.at) / 1000));
    if (this.dashes.length && t - this.dashes[0] > DASH_LIFT_MS) this.dashes = this.dashes.filter((at) => t - at <= DASH_LIFT_MS);
    this.at = t;
    this.budget = Math.min(MOVE_RATE * MOVE_BURST_S, this.budget + MOVE_RATE * elapsed);

    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const flat = Math.hypot(dx, dz);
    if (flat > this.budget + dashExtra) return { ok: false, reason: "speed", to: [...from] };

    // Through a wall: the body's path at knee height between the two reported positions.
    const len = Math.hypot(dx, dy, dz);
    if (len > 0.02) {
      const dir: V3 = [dx / len, dy / len, dz / len];
      const hit = cast([from[0], from[1] + WALL_RAY_Y, from[2]], dir, len);
      if (hit !== null && hit < len - 0.01) return { ok: false, reason: "wall", to: [...from] };
    }

    const dashUsed = Math.max(0, flat - this.budget);
    this.budget = Math.max(0, this.budget - flat);

    const floor = this.floorUnder(to, cast);
    if (floor !== null) {
      // Landing: the speed of a fall from the highest point reached to the floor met (the probes
      // find it a little before the feet touch).
      const fall = this.airborne ? Math.max(0, this.peakY - Math.min(to[1], floor)) : 0;
      this.ground = [...to];
      this.peakY = to[1];
      this.airSince = 0;
      return { ok: true, impact: Math.sqrt(2 * GRAVITY * fall), dashUsed };
    }

    // A dash in the air starts the time aloft over: it climbs again.
    const lastDash = this.dashes.at(-1) ?? 0;
    if (!this.airborne || lastDash > this.airSince) {
      this.airSince = this.checkAt = Math.max(t, lastDash);
      this.checkY = to[1];
    }
    this.peakY = Math.max(this.peakY, to[1]);
    if (to[1] > this.ground[1] + JUMP_RISE + DASH_RISE * this.dashes.length) return this.putBack("height", t);
    if (t - this.checkAt >= HOVER_STEP_MS) {
      if (t - this.airSince > HOVER_MS && this.checkY - to[1] < HOVER_MIN_DROP) return this.putBack("hover", t);
      this.checkAt = t;
      this.checkY = to[1];
    }
    return { ok: true, impact: 0, dashUsed };
  }

  private putBack(reason: "height" | "hover", t: number): MoveVerdict {
    const to = [...this.ground] as V3;
    this.reset(to, t);
    return { ok: false, reason, to };
  }

  /** Height of the highest floor just under the feet, or null when the player is off the ground. */
  private floorUnder([x, y, z]: V3, cast: MoveCast) {
    let best: number | null = null;
    for (const [ox, oz] of PROBES) {
      const d = cast([x + ox, y + PROBE_UP, z + oz], [0, -1, 0], PROBE_UP + PROBE_DOWN);
      if (d !== null && (best === null || y + PROBE_UP - d > best)) best = y + PROBE_UP - d;
    }
    return best;
  }
}
