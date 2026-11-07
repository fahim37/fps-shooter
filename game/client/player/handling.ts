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
  /** Hanging at the hip, wherever the gun is: the free hand of a one-handed gun. */
  belt?: boolean;
  /** Metres pulled back along the gun (racking a charging handle). */
  pull?: number;
  /** Metres out to the left of the gun, to pass around it. */
  clear?: number;
  /** Metres down off the gun: fingers wrapped over a handguard have to lift clear before the hand moves aside. */
  drop?: number;
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
  /** Charging handle pulled back (m). */
  charge: number;
  /** Revolver hammer: 0 cocked, 1 fallen. Its cylinder turning to the next chamber (0..1). */
  hammer: number; cylinder: number;
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
  charge?: Keys<number>;
  hammer?: Keys<number>; cylinder?: Keys<number>;
  shell?: Keys<number>; shellHeld?: Keys<boolean>;
}

const REST: GunOffset = [0, 0, 0, 0, 0, 0];
const SUPPORT: HandKey<LeftPose> = { pose: "support" };
const GRIP: HandKey<RightPose> = { pose: "grip" };
const MAG: HandKey<LeftPose> = { pose: "mag" };
const POUCH: HandKey<LeftPose> = { pose: "mag", pouch: 1 };
/** Past the end of the magazine, down its slope: fingers around it slide off, not through it. */
const OFF_MAG: HandKey<LeftPose> = { pose: "mag", drop: 0.11, pull: -0.02 };
const SHELL: HandKey<LeftPose> = { pose: "shell" };
const SHELL_POUCH: HandKey<LeftPose> = { pose: "shell", pouch: 1 };
const BOLT: HandKey<RightPose> = { pose: "bolt" };

/** `base` nudged by `d` (same layout as GunOffset, missing entries are 0). */
const nudge = (base: GunOffset, ...d: number[]): GunOffset => base.map((v, i) => v + (d[i] ?? 0)) as GunOffset;

/** Metres a charging handle travels. */
const CHARGE_PULL = 0.06;
/** Metres out to the gun's left the support hand swings when changing hold. */
const SWING = 0.075;
const DROP = 0.075;

/** Box-magazine swap: tilt, drop the mag, fetch another from the belt, seat it, rack the handle. */
const MAG_RELOAD: Clip = (() => {
  // Kept low at the side, the view stays clear: the magazine well turned toward the eye.
  const tilt: GunOffset = [0.01, -0.02, -0.02, 0.16, -0.02, -0.3];
  // Rolled toward the support hand, so the handle shows at the back of the gun.
  const rack: GunOffset = [0.03, -0.03, -0.04, 0.12, -0.02, 0.42];
  const hold: HandKey<LeftPose> = { pose: "charge" }, pulled: HandKey<LeftPose> = { pose: "charge", pull: CHARGE_PULL };
  return {
    gun: [
      [0, REST], [0.12, tilt], [0.14, tilt], [0.19, nudge(tilt, 0, -0.012, 0, -0.03)], [0.26, tilt],
      [0.6, tilt], [0.645, nudge(tilt, 0, 0.012, 0, 0.06)], [0.7, tilt],
      [0.75, rack], [0.78, rack], [0.83, nudge(rack, 0, 0, 0.018)], [0.85, nudge(rack, 0, 0, 0.018)], [0.87, nudge(rack, 0, 0, -0.008, 0.05)], [0.96, REST],
    ],
    // Between holds the hand swings out around the gun: a straight line would cut through it.
    left: [
      [0, SUPPORT], [0.04, { ...SUPPORT, drop: DROP }], [0.08, OFF_MAG], [0.11, MAG], [0.24, MAG], [0.35, POUCH], [0.45, POUCH], [0.56, MAG], [0.66, MAG],
      [0.695, OFF_MAG], [0.725, { ...hold, clear: SWING }], [0.76, hold], [0.78, hold], [0.83, pulled], [0.85, pulled],
      [0.885, { ...pulled, clear: SWING }], [0.925, { ...SUPPORT, drop: DROP }], [0.96, SUPPORT],
    ],
    mag: [[0.14, 0], [0.24, 0.16], [0.5, 0.16], [0.56, 0.06], [0.64, 0]],
    magHeld: [[0, false], [0.14, true], [0.66, false]],
    // Follows the hand back, then springs home the moment it lets go.
    charge: [[0.78, 0], [0.83, CHARGE_PULL], [0.85, CHARGE_PULL], [0.862, 0]],
  };
})();

/** The six-shooter's rounds go in one at a time: start of each (0..1) and how long it takes to seat. */
const ROUNDS = [0.1, 0.225, 0.35, 0.475, 0.6, 0.725];
const ROUND_SEAT = 0.09;
/** Sound cues in the revolver's reload, as fractions of it: each round seating. */
export const REVOLVER_ROUND_CUES = ROUNDS.map((s) => s + ROUND_SEAT);

const ROUND: HandKey<LeftPose> = { pose: "shell" };
/** Reaching back to the cartridge loops. */
const ROUND_LOOPS: HandKey<LeftPose> = { pose: "shell", pouch: 0.45, clear: 0.05 };
/** The free hand of a one-handed gun, down by the belt. */
const BELT: HandKey<LeftPose> = { pose: "support", belt: true };

const REVOLVER_RELOAD: Clip = (() => {
  // Muzzle up but low at the side of the view: both hands end up below the cylinder, so neither
  // hides it, and neither gets in the way of the fight.
  const tilt: GunOffset = [0.03, -0.035, -0.06, 0.62, -0.08, 0.15];
  const gun: Keys<GunOffset> = [[0, REST], [0.09, tilt]];
  const left: Keys<HandKey<LeftPose>> = [[0, BELT]];
  const shell: Keys<number> = [];
  const shellHeld: Keys<boolean> = [[0, false]];
  const cylinder: Keys<number> = [[0, 0]];
  for (const s of ROUNDS) {
    left.push([s, ROUND_LOOPS], [s + 0.055, ROUND], [s + ROUND_SEAT, ROUND]);
    shell.push([s, 0.05], [s + 0.055, 0.05], [s + ROUND_SEAT, 0.024]);
    shellHeld.push([s, true], [s + ROUND_SEAT + 0.002, false]);
    gun.push([s + ROUND_SEAT, nudge(tilt, 0, 0.004, 0, 0.02)], [s + 0.12, tilt]);
    // A click round to the next chamber. All six look alike, so it can then jump back unseen.
    cylinder.push([s + ROUND_SEAT, 0], [s + ROUND_SEAT + 0.03, 1], [s + ROUND_SEAT + 0.0301, 0]);
  }
  left.push([0.9, BELT]);
  gun.push([0.86, tilt], [0.95, [0, 0, 0, 0, 0, -0.08]], [1, REST]);
  // Half cock frees the cylinder; back to full cock for the first shot.
  return { gun, left, shell, shellHeld, cylinder, hammer: [[0, 0], [0.07, 0.45], [0.88, 0.45], [0.94, 0]] };
})();

/** After each shot: the muzzle kicks up, and the thumb rolls the hammer back, turning the cylinder. */
const REVOLVER_COCK: Clip = {
  gun: [[0, REST], [0.08, [0, 0.014, 0.035, 0.5, 0, 0.04]], [0.45, [0, 0.004, 0.01, 0.12, 0, 0]], [0.9, REST]],
  right: [[0, GRIP], [0.18, { pose: "cock" }], [0.62, { pose: "cock" }], [1, GRIP]],
  hammer: [[0, 1], [0.3, 1], [0.62, 0]],
  cylinder: [[0.3, 0], [0.62, 1]],
};

/** When each shell starts its trip from the belt, and how long until it seats in the port. */
const SHELLS = [0.1, 0.28, 0.46, 0.64];
const SHELL_SEAT = 0.12;
/** Where the reload's closing pump reaches the back and front of its travel. */
const RELOAD_RACK = [0.94, 0.98] as const;

/** Sound cues in the shotgun's reload, as fractions of it: each shell seating, then the pump. */
export const SHOTGUN_RELOAD_CUES = { shells: SHELLS.map((s) => s + SHELL_SEAT), rack: RELOAD_RACK };

const SHOTGUN_RELOAD: Clip = (() => {
  const tilt: GunOffset = [0.01, -0.015, -0.01, 0.17, 0.03, -0.55];
  const gun: Keys<GunOffset> = [[0, REST], [0.1, tilt]];
  const left: Keys<HandKey<LeftPose>> = [[0, SUPPORT]];
  const shell: Keys<number> = [];
  const shellHeld: Keys<boolean> = [[0, false]];
  // Four shells, each fetched from the belt and thumbed up into the loading port.
  for (const s of SHELLS) {
    left.push([s, SHELL_POUCH], [s + 0.07, SHELL], [s + SHELL_SEAT, SHELL]);
    shell.push([s, 0.06], [s + 0.07, 0.06], [s + SHELL_SEAT, 0]);
    shellHeld.push([s, true], [s + SHELL_SEAT + 0.005, false]);
    gun.push([s + SHELL_SEAT, nudge(tilt, 0, 0.006, 0, 0.025)], [s + 0.15, tilt]);
  }
  left.push([0.82, SHELL_POUCH], [0.9, SUPPORT]);
  shell.push([0.82, 0.06]);
  gun.push([0.84, tilt], [0.9, [0, 0, 0, 0, 0, -0.1]], [0.94, [0, 0, 0.015, 0.03, 0, -0.06]], [1, REST]);
  return { gun, left, shell, shellHeld, pump: [[0.9, 0], [RELOAD_RACK[0], 0.085], [RELOAD_RACK[1], 0]] };
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

/** A pump or bolt cycle: `strokes` are where the action hits the back and front of its travel (0..1). */
interface Cycle { clip: Clip; seconds: number; strokes: readonly [number, number] }

const CLIPS: Record<WeaponId, { reload: Clip; cycle?: Cycle; rest?: HandKey<LeftPose> }> = {
  ar: { reload: MAG_RELOAD },
  smg: { reload: MAG_RELOAD },
  shotgun: { reload: SHOTGUN_RELOAD, cycle: { clip: SHOTGUN_PUMP, seconds: 0.36, strokes: [0.5, 0.75] } },
  sniper: { reload: SNIPER_RELOAD, cycle: { clip: SNIPER_BOLT, seconds: 0.64, strokes: [0.5, 0.64] } },
  pistol: { reload: REVOLVER_RELOAD, cycle: { clip: REVOLVER_COCK, seconds: 0.3, strokes: [0.3, 0.62] }, rest: BELT },
};

/** How long a pump or bolt gun takes to work its action after a shot (s), or null for other guns. */
export function cycleSeconds(weapon: WeaponId) {
  return CLIPS[weapon].cycle?.seconds ?? null;
}

/** Seconds after a shot that the action opens and closes, or null for guns without one. */
export function cycleStrokes(weapon: WeaponId): readonly [number, number] | null {
  const cycle = CLIPS[weapon].cycle;
  return cycle ? [cycle.strokes[0] * cycle.seconds, cycle.strokes[1] * cycle.seconds] : null;
}

export function createHandling(): Handling {
  return {
    gun: [...REST], left: { a: SUPPORT, b: SUPPORT, k: 0 }, right: { a: GRIP, b: GRIP, k: 0 },
    mag: 0, magHeld: false, magVisible: true, pump: 0, boltLift: 0, boltPull: 0, charge: 0, hammer: 0, cylinder: 0, shell: 0, shellHeld: false,
  };
}

/**
 * Samples the handling pose. `reload` is the reload progress (or -1); `sinceShot` and
 * `sinceDraw` are seconds since the last shot and since the gun was drawn.
 */
export function sampleHandling(weapon: WeaponId, reload: number, sinceShot: number, sinceDraw: number, out = createHandling()) {
  out.gun.fill(0);
  const clips = CLIPS[weapon];
  out.left.a = out.left.b = clips.rest ?? SUPPORT; out.left.k = 0;
  out.right.a = out.right.b = GRIP; out.right.k = 0;
  out.mag = out.pump = out.boltLift = out.boltPull = out.charge = out.hammer = out.cylinder = out.shell = 0;
  out.magHeld = out.shellHeld = false;
  out.magVisible = true;
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
  if (c.charge) out.charge = sampleNum(c.charge, t);
  if (c.hammer) out.hammer = sampleNum(c.hammer, t);
  if (c.cylinder) out.cylinder = sampleNum(c.cylinder, t);
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
