import { CROUCH_EYE_HEIGHT, EYE_HEIGHT } from "./constants";

type V3 = [number, number, number];

/**
 * Peeking tilts the upper body sideways around the hips. One model drives the local camera,
 * the replicated character pose and the authoritative hitboxes, so a peek exposes exactly
 * what it lets you see. `lean` is -1 (full left) .. 1 (full right).
 */
export const LEAN_ANGLE = 0.68;
/** Camera roll at full lean; deliberately gentler than the body tilt. */
export const LEAN_ROLL = 0.2;
/** Full lean is reached in 1 / LEAN_RATE seconds. */
export const LEAN_RATE = 7;
/** Space kept between a leaning head and the wall beside it. */
export const LEAN_CLEARANCE = 0.24;
const PIVOT = 0.95;
const CROUCH_PIVOT = 0.55;

/** `crouch` blends 0 (standing) .. 1 (crouched) so the camera never jumps mid-transition. */
export function leanShift(lean: number, crouch: number, height: number) {
  const arm = Math.max(0, height - (PIVOT + (CROUCH_PIVOT - PIVOT) * crouch));
  const angle = lean * LEAN_ANGLE;
  return { side: Math.sin(angle) * arm, drop: (1 - Math.cos(angle)) * arm };
}

/** World offset of a body point `height` m above the feet. Yaw 0 faces -Z; right is +X. */
export function leanOffset(lean: number, yaw: number, crouch: number, height: number): V3 {
  if (!lean) return [0, 0, 0];
  const { side, drop } = leanShift(lean, crouch, height);
  return [Math.cos(yaw) * side, -drop, -Math.sin(yaw) * side];
}

/**
 * Largest lean toward the requested side that keeps the head out of walls. `cast` returns the
 * distance to the first world hit along a ray, or null.
 */
export function clampLean(lean: number, x: number, y: number, z: number, yaw: number, crouch: number,
  cast: (origin: V3, dir: V3, distance: number) => number | null) {
  if (Math.abs(lean) < 1e-3) return 0;
  const eyeHeight = EYE_HEIGHT + (CROUCH_EYE_HEIGHT - EYE_HEIGHT) * crouch;
  const reach = Math.abs(leanShift(1, crouch, eyeHeight).side);
  const side = Math.sign(lean);
  const hit = cast([x, y + eyeHeight, z], [Math.cos(yaw) * side, 0, -Math.sin(yaw) * side], reach + LEAN_CLEARANCE);
  if (hit === null) return Math.max(-1, Math.min(1, lean));
  const available = Math.min(1, Math.max(0, hit - LEAN_CLEARANCE) / reach);
  const limit = Math.asin(available * Math.sin(LEAN_ANGLE)) / LEAN_ANGLE;
  return side * Math.min(Math.abs(lean), 1, limit);
}
