import { WEAPONS, type WeaponId } from "../../shared/weapons";
import type { LeftPose, RightPose } from "./grip";

/**
 * Keyframed weapon handling: reloads, pump / bolt cycling after a shot and drawing the gun.
 * A clip moves the gun relative to where it is held, sends each hand between the grip poses
 * in grip.ts (or to the belt pouch), and drives the moving parts. Times are 0..1 of the clip.
 */

/** [x, y, z, pitch, yaw, roll] in view space: +pitch raises the muzzle, +yaw swings it left, +roll tips the top left. */
export type GunOffset = [number, number, number, number, number, number];

export interface HandKey<P extends string> {
  pose: P;
  /** 0..1 toward the belt pouch (fetching a magazine or shell). */
  pouch?: number;
  /** Metres pulled back along the gun (racking a charging handle). */
  pull?: number;
}

export interface HandBlend<P extends string> { a: HandKey<P>; b: HandKey<P>; k: number }

export interface Handling {
  gun: GunOffset;
  left: HandBlend<LeftPose>;
  right: HandBlend<RightPose>;
  /** Magazine slide out of its well (m); held = travels with the left hand. */
  mag: number; magHeld: boolean; magVisible: boolean;
  /** Pump slide back (m). */
  pump: number;
  /** Bolt handle lift (0..1) and pull back (0..1). */
  boltLift: number; boltPull: number;
  /** Shell distance below the loading port (m); held = shown in the left hand. */
  shell: number; shellHeld: boolean;
}

type Keys<T> = [number, T][];
interface Clip {
  gun?: Keys<GunOffset>;
  left?: Keys<HandKey<LeftPose>>;
  right?: Keys<HandKey<RightPose>>;
  mag?: Keys<number>; magHeld?: Keys<boolean>; magVisible?: Keys<boolean>;
  pump?: Keys<number>;
  boltLift?: Keys<number>; boltPull?: Keys<number>;
  shell?: Keys<number>; shellHeld?: Keys<boolean>;
}

const REST: GunOffset = [0, 0, 0, 0, 0, 0];
const SUPPORT: HandKey<LeftPose> = { pose: "support" };
const GRIP: HandKey<RightPose> = { pose: "grip" };
const MAG: HandKey<LeftPose> = { pose: "mag" };
const POUCH: HandKey<LeftPose> = { pose: "mag", pouch: 1 };
const SHELL: HandKey<LeftPose> = { pose: "shell" };
const SHELL_POUCH: HandKey<LeftPose> = { pose: "shell", pouch: 1 };
const BOLT: HandKey<RightPose> = { pose: "bolt" };

/** `base` nudged by `d` (same layout as GunOffset, missing entries are 0). */
const nudge = (base: GunOffset, ...d: number[]): GunOffset => base.map((v, i) => v + (d[i] ?? 0)) as GunOffset;

/** Box-magazine swap: tilt, drop the mag, fetch another from the belt, seat it, optionally rack. */
function magReload(charge: boolean): Clip {
  // Raised toward the centre of the view, muzzle up and the magazine well turned toward the eye.
  const tilt: GunOffset = [-0.08, 0.09, 0.05, 0.3, 0.3, -0.3];
  const rack: GunOffset = [-0.05, 0.05, 0.03, 0.12, 0.12, 0.3];
  return {
    gun: [
      [0, REST], [0.12, tilt], [0.14, tilt], [0.19, nudge(tilt, 0, -0.012, 0, -0.03)], [0.26, tilt],
      [0.6, tilt], [0.645, nudge(tilt, 0, 0.012, 0, 0.06)], [0.7, tilt],
      ...(charge
        ? [[0.76, rack], [0.8, rack], [0.83, nudge(rack, 0, 0, 0.014)], [0.855, nudge(rack, 0, 0, -0.004, 0.045)], [0.95, REST]] as Keys<GunOffset>
        : [[0.85, REST]] as Keys<GunOffset>),
    ],
    left: [
      [0, SUPPORT], [0.1, MAG], [0.24, MAG], [0.35, POUCH], [0.45, POUCH], [0.56, MAG], [0.67, MAG],
      ...(charge
        ? [[0.76, { pose: "charge" }], [0.8, { pose: "charge" }], [0.83, { pose: "charge", pull: 0.06 }], [0.85, { pose: "charge", pull: 0.06 }], [0.95, SUPPORT]] as Keys<HandKey<LeftPose>>
        : [[0.8, SUPPORT]] as Keys<HandKey<LeftPose>>),
    ],
    mag: [[0.14, 0], [0.24, 0.16], [0.5, 0.16], [0.56, 0.06], [0.64, 0]],
    magHeld: [[0, false], [0.14, true], [0.66, false]],
  };
}

const PISTOL_RELOAD: Clip = (() => {
  const tilt: GunOffset = [-0.06, 0.07, 0.03, 0.25, 0.25, 0.28];
  return {
    gun: [[0, REST], [0.12, tilt], [0.6, tilt], [0.66, nudge(tilt, 0, 0.01, 0, 0.06)], [0.72, tilt],
      [0.8, tilt], [0.83, nudge(tilt, 0, 0, 0, 0.05)], [0.95, REST]],
    // The empty magazine drops free while the support hand already reaches for a full one.
    left: [[0, SUPPORT], [0.16, POUCH], [0.4, POUCH], [0.54, MAG], [0.68, MAG], [0.86, SUPPORT]],
    mag: [[0.1, 0], [0.24, 0.28], [0.42, 0.28], [0.54, 0.07], [0.66, 0]],
    magVisible: [[0, true], [0.24, false], [0.32, true]],
    magHeld: [[0, false], [0.3, true], [0.68, false]],
  };
})();

const SHOTGUN_RELOAD: Clip = (() => {
  const tilt: GunOffset = [-0.08, 0.09, 0.04, 0.28, 0.25, -0.55];
  const gun: Keys<GunOffset> = [[0, REST], [0.1, tilt]];
  const left: Keys<HandKey<LeftPose>> = [[0, SUPPORT]];
  const shell: Keys<number> = [];
  const shellHeld: Keys<boolean> = [[0, false]];
  // Four shells, each fetched from the belt and thumbed up into the loading port.
  for (const s of [0.1, 0.28, 0.46, 0.64]) {
    left.push([s, SHELL_POUCH], [s + 0.07, SHELL], [s + 0.12, SHELL]);
    shell.push([s, 0.06], [s + 0.07, 0.06], [s + 0.12, 0]);
    shellHeld.push([s, true], [s + 0.125, false]);
    gun.push([s + 0.12, nudge(tilt, 0, 0.006, 0, 0.025)], [s + 0.15, tilt]);
  }
  left.push([0.82, SHELL_POUCH], [0.9, SUPPORT]);
  shell.push([0.82, 0.06]);
  gun.push([0.84, tilt], [0.9, [0, 0, 0, 0, 0, -0.1]], [0.94, [0, 0, 0.015, 0.03, 0, -0.06]], [1, REST]);
  return { gun, left, shell, shellHeld, pump: [[0.9, 0], [0.94, 0.085], [0.98, 0]] };
})();

const SHOTGUN_PUMP: Clip = {
  pump: [[0.25, 0], [0.5, 0.085], [0.75, 0]],
  gun: [[0, REST], [0.3, [0, -0.01, 0.005, 0.03, 0, -0.1]], [0.5, [0, -0.012, 0.015, 0.02, 0, -0.12]],
    [0.75, [0, -0.005, 0, 0.035, 0, -0.05]], [1, REST]],
};

const SNIPER_RELOAD: Clip = (() => {
  const tilt: GunOffset = [-0.05, 0.0, -0.1, 0.15, 0.15, 0.4];
  return {
    gun: [[0, REST], [0.08, tilt], [0.15, nudge(tilt, 0, 0, 0.008)], [0.2, tilt], [0.6, tilt],
      [0.64, nudge(tilt, 0, 0.01, 0, 0.05)], [0.68, tilt], [0.78, nudge(tilt, 0, 0, -0.006)], [0.9, tilt], [1, REST]],
    right: [[0, GRIP], [0.07, BOLT], [0.17, BOLT], [0.25, GRIP], [0.66, GRIP], [0.72, BOLT], [0.84, BOLT], [0.93, GRIP]],
    boltLift: [[0.07, 0], [0.11, 1], [0.8, 1], [0.84, 0]],
    boltPull: [[0.11, 0], [0.17, 1], [0.74, 1], [0.8, 0]],
    left: [[0, SUPPORT], [0.2, MAG], [0.24, MAG], [0.34, POUCH], [0.44, POUCH], [0.55, MAG], [0.62, MAG], [0.75, SUPPORT]],
    mag: [[0.24, 0], [0.31, 0.1], [0.48, 0.1], [0.55, 0.05], [0.61, 0]],
    magHeld: [[0, false], [0.24, true], [0.62, false]],
  };
})();

const SNIPER_BOLT: Clip = (() => {
  const work: GunOffset = [-0.02, -0.03, -0.09, 0.05, 0.08, 0.3];
  return {
    gun: [[0, REST], [0.3, work], [0.5, nudge(work, 0, 0, 0.01)], [0.56, nudge(work, 0, 0, 0.01)], [0.76, work], [1, REST]],
    right: [[0.18, GRIP], [0.32, BOLT], [0.76, BOLT], [0.92, GRIP]],
    boltLift: [[0.32, 0], [0.4, 1], [0.64, 1], [0.72, 0]],
    boltPull: [[0.4, 0], [0.5, 1], [0.56, 1], [0.64, 0]],
  };
})();

/** Gun raised from below the frame (weapon switch, spawn). */
const DRAW: Keys<GunOffset> = [[0, [0.03, -0.16, 0.06, -0.8, 0.25, 0.45]], [1, REST]];

const CLIPS: Record<WeaponId, { reload: Clip; cycle?: { clip: Clip; seconds: number } }> = {
  ar: { reload: magReload(true) },
  smg: { reload: magReload(false) },
  shotgun: { reload: SHOTGUN_RELOAD, cycle: { clip: SHOTGUN_PUMP, seconds: 0.62 } },
  sniper: { reload: SNIPER_RELOAD, cycle: { clip: SNIPER_BOLT, seconds: 1.15 } },
  pistol: { reload: PISTOL_RELOAD },
};

export function createHandling(): Handling {
  return {
    gun: [...REST], left: { a: SUPPORT, b: SUPPORT, k: 0 }, right: { a: GRIP, b: GRIP, k: 0 },
    mag: 0, magHeld: false, magVisible: true, pump: 0, boltLift: 0, boltPull: 0, shell: 0, shellHeld: false,
  };
}

/**
 * Samples the handling pose. `reload` is the reload progress (or -1); `sinceShot` and
 * `sinceDraw` are seconds since the last shot and since the gun was drawn.
 */
export function sampleHandling(weapon: WeaponId, reload: number, sinceShot: number, sinceDraw: number, out = createHandling()) {
  out.gun.fill(0);
  out.left.a = out.left.b = SUPPORT; out.left.k = 0;
  out.right.a = out.right.b = GRIP; out.right.k = 0;
  out.mag = out.pump = out.boltLift = out.boltPull = out.shell = 0;
  out.magHeld = out.shellHeld = false;
  out.magVisible = true;
  const clips = CLIPS[weapon];
  if (reload >= 0) apply(clips.reload, Math.min(1, reload), out);
  else if (clips.cycle && sinceShot >= 0 && sinceShot < clips.cycle.seconds) apply(clips.cycle.clip, sinceShot / clips.cycle.seconds, out);
  const equip = WEAPONS[weapon].equipMs / 1000;
  if (sinceDraw >= 0 && sinceDraw < equip) {
    const d = sampleVec(DRAW, sinceDraw / equip);
    for (let i = 0; i < 6; i++) out.gun[i] += d[i];
  }
  return out;
}

function apply(c: Clip, t: number, out: Handling) {
  if (c.gun) { const g = sampleVec(c.gun, t); for (let i = 0; i < 6; i++) out.gun[i] = g[i]; }
  if (c.left) sampleHand(c.left, t, out.left);
  if (c.right) sampleHand(c.right, t, out.right);
  if (c.mag) out.mag = sampleNum(c.mag, t);
  if (c.magHeld) out.magHeld = sampleStep(c.magHeld, t);
  if (c.magVisible) out.magVisible = sampleStep(c.magVisible, t);
  if (c.pump) out.pump = sampleNum(c.pump, t);
  if (c.boltLift) out.boltLift = sampleNum(c.boltLift, t);
  if (c.boltPull) out.boltPull = sampleNum(c.boltPull, t);
  if (c.shell) out.shell = sampleNum(c.shell, t);
  if (c.shellHeld) out.shellHeld = sampleStep(c.shellHeld, t);
}

/** Index of the key segment containing t and the eased fraction across it. */
function segment<T>(keys: Keys<T>, t: number): [number, number] {
  if (t <= keys[0][0]) return [0, 0];
  for (let i = 0; i < keys.length - 1; i++) {
    const t0 = keys[i][0], t1 = keys[i + 1][0];
    if (t < t1) {
      const u = (t - t0) / (t1 - t0);
      return [i, u * u * (3 - 2 * u)];
    }
  }
  return [keys.length - 1, 0];
}

function sampleNum(keys: Keys<number>, t: number) {
  const [i, k] = segment(keys, t);
  const a = keys[i][1], b = keys[Math.min(i + 1, keys.length - 1)][1];
  return a + (b - a) * k;
}

const _vec: GunOffset = [0, 0, 0, 0, 0, 0];
function sampleVec(keys: Keys<GunOffset>, t: number) {
  const [i, k] = segment(keys, t);
  const a = keys[i][1], b = keys[Math.min(i + 1, keys.length - 1)][1];
  for (let j = 0; j < 6; j++) _vec[j] = a[j] + (b[j] - a[j]) * k;
  return _vec;
}

function sampleHand<P extends string>(keys: Keys<HandKey<P>>, t: number, out: HandBlend<P>) {
  const [i, k] = segment(keys, t);
  out.a = keys[i][1];
  out.b = keys[Math.min(i + 1, keys.length - 1)][1];
  out.k = k;
}

function sampleStep<T>(keys: Keys<T>, t: number) {
  let v = keys[0][1];
  for (const [kt, kv] of keys) if (t >= kt) v = kv;
  return v;
}
