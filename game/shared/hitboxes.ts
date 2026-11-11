import { leanOffset } from "./lean";

/**
 * Player hitboxes and ray tests, shared by the server (authoritative hits, and the check on a
 * shooter's claimed hits) and the client (for characters not drawn this frame). Pose position
 * is the feet. Clients test what they draw with hit shapes on the animated skeleton
 * (client/player/hitShapes.ts); these follow it as closely as position, stance, aim and lean
 * allow. scripts/dev/hit-accuracy.ts measures both against the skinned mesh.
 */

export interface Pose {
  x: number;
  y: number;
  z: number;
  crouch: boolean;
  /** Facing and peek (-1 left .. 1 right); the upper body tilts out from behind cover. */
  yaw?: number;
  lean?: number;
  /** Aim pitch (rad, + up): the upper body bends over a low aim and leans back for a high one. */
  pitch?: number;
  /** 0 standing still .. 1 moving: the rifle carry puts the head further forward. */
  moving?: number;
  /**
   * Sliding: the direction of travel (rad, as a yaw; see `slideYaw`). The legs lead along it and
   * the chest sits back over the hips, so the whole body is under a metre tall.
   */
  slide?: number | null;
}

export type HitPart = "head" | "body" | "legs";

export interface PoseHit {
  distance: number;
  part: HitPart;
}

/** Ground speed (m/s) from which a player counts as moving for the hitboxes. */
export const MOVING_SPEED = 0.6;

type V3 = [number, number, number];

/**
 * Where the drawn head sits, in metres from the feet: forward along the facing and up, at the
 * aim pitches of PITCH_KNOTS. Measured on both bodies across weapons and animation phases.
 */
const PITCH_KNOTS = [-1.4, -0.7, 0, 0.7, 1.4];
const HEAD_AT = {
  still: { fwd: [0.36, 0.29, 0.07, -0.19, -0.33], up: [1.35, 1.47, 1.61, 1.62, 1.56], right: 0.05 },
  moving: { fwd: [0.18, 0.18, 0.17, 0.11, 0.07], up: [1.49, 1.52, 1.58, 1.60, 1.58], right: 0.01 },
  crouch: { fwd: [0.31, 0.29, 0.16, -0.09, -0.23], up: [0.72, 0.86, 1.07, 1.19, 1.19], right: -0.07 },
};
/**
 * The head through a slide: metres along the direction of travel (behind the feet position, the
 * legs being out in front) and up, at the aim pitches of PITCH_KNOTS. Measured on the drawn
 * character; it barely moves with the gun held or how far the legs lead off the aim.
 */
const SLIDE_HEAD = { fwd: [-0.29, -0.31, -0.33, -0.37, -0.38], up: [0.65, 0.68, 0.69, 0.65, 0.61] };
/** Sliding: the hips' height, and the legs' reach along the ground ahead of them (m). */
const SLIDE_HIP = 0.2, SLIDE_LEGS = [0.15, 0.85] as const, SLIDE_LEG_HEIGHT = 0.16;
/** Sliding, the legs lead along the slide up to this far (rad) off the aim; the drawn character does the same. */
export const SLIDE_LEG_YAW = 1.2;

/** Which way a slide's legs lead: the direction of travel, no further than SLIDE_LEG_YAW off the aim `yaw`. */
export function slideYaw(yaw: number, vx: number, vz: number) {
  if (Math.hypot(vx, vz) < 0.1) return yaw;
  const rel = Math.atan2(-vx, -vz) - yaw;
  return yaw + Math.max(-SLIDE_LEG_YAW, Math.min(SLIDE_LEG_YAW, Math.atan2(Math.sin(rel), Math.cos(rel))));
}

/** The drawn peek swings the head this share of the camera's lean offset. */
const HEAD_LEAN = 0.8;
const HEAD_R = 0.15;
/** Hips, where the torso starts, and how far below the head centre it ends (m). */
const HIP = 0.95, CROUCH_HIP = 0.6, NECK_GAP = 0.32;

function knot(values: number[], pitch: number) {
  const p = Math.max(PITCH_KNOTS[0], Math.min(PITCH_KNOTS[PITCH_KNOTS.length - 1], pitch));
  let i = 0;
  while (i < PITCH_KNOTS.length - 2 && p > PITCH_KNOTS[i + 1]) i++;
  const k = (p - PITCH_KNOTS[i]) / (PITCH_KNOTS[i + 1] - PITCH_KNOTS[i]);
  return values[i] + (values[i + 1] - values[i]) * k;
}

function slideBoxes(p: Pose, travel: number) {
  const fx = -Math.sin(travel), fz = -Math.cos(travel), pitch = p.pitch ?? 0;
  const fwd = knot(SLIDE_HEAD.fwd, pitch), up = knot(SLIDE_HEAD.up, pitch);
  const head: V3 = [p.x + fx * fwd, p.y + up, p.z + fz * fwd];
  const hip: V3 = [p.x, p.y + SLIDE_HIP, p.z];
  const spine: V3 = [head[0] - hip[0], head[1] - hip[1], head[2] - hip[2]];
  const len = Math.hypot(...spine);
  const k = Math.max(0, (len - NECK_GAP) / len);
  const leg = (d: number): V3 => [p.x + fx * d, p.y + SLIDE_LEG_HEIGHT, p.z + fz * d];
  return {
    head: { c: head, r: HEAD_R },
    // Slimmer than upright: the chest is laid back, and a full-width cap would cover the face from in front.
    body: { a: hip, b: [hip[0] + spine[0] * k, hip[1] + spine[1] * k, hip[2] + spine[2] * k] as V3, r: 0.24 },
    legs: { a: leg(SLIDE_LEGS[0]), b: leg(SLIDE_LEGS[1]), r: 0.2 },
  };
}

export function hitboxes(p: Pose) {
  if (p.slide !== undefined && p.slide !== null) return slideBoxes(p, p.slide);
  const c = p.crouch;
  const yaw = p.yaw ?? 0, pitch = p.pitch ?? 0, moving = c ? 0 : Math.max(0, Math.min(1, p.moving ?? 0));
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const table = c ? [HEAD_AT.crouch] : [HEAD_AT.still, HEAD_AT.moving];
  const blend = (get: (t: typeof HEAD_AT.still) => number) => table.length === 1 ? get(table[0]) : get(table[0]) + (get(table[1]) - get(table[0])) * moving;
  const fwd = blend((t) => knot(t.fwd, pitch)), up = blend((t) => knot(t.up, pitch)), right = blend((t) => t.right);
  const lean = leanOffset(p.lean ?? 0, yaw, c ? 1 : 0, up);
  const head: V3 = [
    p.x + fx * fwd + rx * right + lean[0] * HEAD_LEAN,
    p.y + up + lean[1] * HEAD_LEAN,
    p.z + fz * fwd + rz * right + lean[2] * HEAD_LEAN,
  ];
  // The torso runs from the hips toward the head, ending below it so its rounded cap cannot
  // swallow headshots.
  const hip: V3 = [p.x, p.y + (c ? CROUCH_HIP : HIP), p.z];
  const spine: V3 = [head[0] - hip[0], head[1] - hip[1], head[2] - hip[2]];
  const len = Math.hypot(...spine);
  const k = Math.max(0, (len - NECK_GAP) / len);
  return {
    head: { c: head, r: HEAD_R },
    body: { a: [hip[0], hip[1] + 0.05, hip[2]] as V3, b: [hip[0] + spine[0] * k, hip[1] + spine[1] * k, hip[2] + spine[2] * k] as V3, r: 0.27 },
    legs: { a: [p.x, p.y + 0.12, p.z] as V3, b: [p.x, p.y + (c ? 0.55 : 0.9), p.z] as V3, r: 0.2 },
  };
}

/** Nearest hit of a ray (unit `dir`) against a player's hitboxes, within `maxDist`. */
export function rayVsPose(o: V3, dir: V3, maxDist: number, pose: Pose): PoseHit | null {
  // Cheap reject: bounding capsule around the whole body (the head reaches 0.5 m out, bent or
  // peeking; a slide's legs a metre).
  const sliding = pose.slide !== undefined && pose.slide !== null;
  const cheap = rayCapsule(o, dir, [pose.x, pose.y, pose.z], [pose.x, pose.y + (sliding ? 0.9 : 1.85), pose.z], sliding ? 1.15 : 0.75);
  if (cheap === null || cheap > maxDist) return null;
  const hb = hitboxes(pose);
  let best: PoseHit | null = null;
  const consider = (t: number | null, part: HitPart) => {
    if (t !== null && t <= maxDist && (!best || t < best.distance)) best = { distance: t, part };
  };
  consider(raySphere(o, dir, hb.head.c, hb.head.r), "head");
  consider(rayCapsule(o, dir, hb.body.a, hb.body.b, hb.body.r), "body");
  consider(rayCapsule(o, dir, hb.legs.a, hb.legs.b, hb.legs.r), "legs");
  return best;
}

export function raySphere(o: V3, d: V3, c: V3, r: number): number | null {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 >= 0) return t0;
  const t1 = -b + s;
  return t1 >= 0 ? 0 : null; // origin inside the sphere
}

/** Ray vs capsule (segment a→b with radius r). */
export function rayCapsule(o: V3, d: V3, a: V3, b: V3, r: number): number | null {
  const ba: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const oa: V3 = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const baba = dot(ba, ba), bard = dot(ba, d), baoa = dot(ba, oa), rdoa = dot(d, oa), oaoa = dot(oa, oa);
  if (baba < 1e-12) return raySphere(o, d, a, r);
  const closest = Math.max(0, Math.min(1, baoa / baba));
  const inside = oaoa - 2 * closest * baoa + closest * closest * baba;
  if (inside <= r * r) return 0;
  const aa = baba - bard * bard;
  let bb = baba * rdoa - baoa * bard;
  let cc = baba * oaoa - baoa * baoa - r * r * baba;
  let h = bb * bb - aa * cc;
  if (h >= 0 && aa > 1e-9) {
    const t = (-bb - Math.sqrt(h)) / aa;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
  }
  // Caps.
  let best: number | null = null;
  for (const cap of [a, b]) {
    const oc: V3 = [o[0] - cap[0], o[1] - cap[1], o[2] - cap[2]];
    bb = dot(d, oc);
    cc = dot(oc, oc) - r * r;
    h = bb * bb - cc;
    if (h > 0) {
      const t = -bb - Math.sqrt(h);
      if (t >= 0 && (best === null || t < best)) best = t;
    }
  }
  return best;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
