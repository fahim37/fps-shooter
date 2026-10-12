/**
 * Per-frame optic motion, written by the game loop and read by the HUD sight
 * overlays without React renders. x / y are fractions of the optic's size
 * (screen axes: +x right, +y down); kick is the recoil impulse (0..1).
 */
export const sightMotion = { x: 0, y: 0, kick: 0 };

export interface SightMotionInput {
  /** Viewmodel sway / bob in view space (+y up), as produced by LocalPlayer. */
  swayX: number; swayY: number; bobX: number; bobY: number;
  /** Velocity across and along the view, m/s. */
  strafe: number; vy: number;
  recoil: number;
  time: number;
}

const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));

/** Eases the eyepiece toward where the gun's lag puts it, like the scope shadow in PUBG. */
export function updateSightMotion(dt: number, i: SightMotionInput, out = sightMotion) {
  // ADS sway peaks around 0.009 m; bob is mostly damped while aiming.
  const breathe = Math.sin(i.time * 1.3) * 0.004;
  const tx = clamp(i.swayX * 7 + i.bobX * 14 - i.strafe * 0.012, 0.12);
  const ty = clamp(-i.swayY * 7 - i.bobY * 14 + i.vy * 0.008 + breathe - i.recoil * 0.05, 0.12);
  const k = Math.min(1, dt * 9);
  out.x += (tx - out.x) * k;
  out.y += (ty - out.y) * k;
  out.kick = Math.min(1, i.recoil / 0.65);
  return out;
}

export function resetSightMotion(out = sightMotion) {
  out.x = out.y = out.kick = 0;
}
