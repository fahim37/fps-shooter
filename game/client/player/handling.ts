import { REVOLVER_ROUNDS, REVOLVER_ROUND_SEAT, WEAPONS, type WeaponId } from "../../shared/weapons";
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
  /** Metres out to the left of the gun (negative: to its right), to pass around it. */
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
  /** Bolt pulled back (0..1): the sniper is a straight-pull action. */
  boltPull: number;
  /** Charging handle pulled back (m). */
  charge: number;
  /** Revolver hammer: 0 cocked, 1 fallen. Its cylinder turning to the next chamber (0..1). */
  hammer: number; cylinder: number;
  /** Shell distance below the loading port (m); held = shown in the left hand. */
  shell: number; shellHeld: boolean;
  /** The balisong's handles: 0 open in the hand .. 1 folded shut over the blade. */
  safe: number; bite: number;
  /** Knife rotation about its contact in the pinch, and flight progress (0..1). */
  spin: GunOffset; flight: number; release: number;
  /** Distance from the sword guard to the scabbard mouth during the reveal (m). */
  sheathPull: number;
}

type Keys<T> = [number, T][];
interface Clip {
  /** Normalized time at the end of the fast cut, also used by sound, camera roll and the trail. */
  contact?: number;
  gun?: Keys<GunOffset>;
  /** Continuous velocity at each gun key, in pose units per normalized clip. */
  tangents?: GunOffset[];
  left?: Keys<HandKey<LeftPose>>;
  right?: Keys<HandKey<RightPose>>;
  mag?: Keys<number>; magHeld?: Keys<boolean>; magVisible?: Keys<boolean>;
  pump?: Keys<number>;
  boltPull?: Keys<number>;
  charge?: Keys<number>;
  hammer?: Keys<number>; cylinder?: Keys<number>;
  shell?: Keys<number>; shellHeld?: Keys<boolean>;
  safe?: Keys<number>; bite?: Keys<number>;
  spin?: Keys<GunOffset>; flight?: [number, number]; release?: Keys<number>;
  sheathPull?: Keys<number>;
  cues?: [number, BladeCue][];
}

const REST: GunOffset = [0, 0, 0, 0, 0, 0];
const SUPPORT: HandKey<LeftPose> = { pose: "support" };
const GRIP: HandKey<RightPose> = { pose: "grip" };
const MAG: HandKey<LeftPose> = { pose: "mag" };
const POUCH: HandKey<LeftPose> = { pose: "mag", pouch: 1 };
/** Past the end of the magazine, down its slope: fingers around it slide off, not through it. */
const OFF_MAG: HandKey<LeftPose> = { pose: "mag", drop: 0.11, pull: -0.02 };
/** The same for a straight magazine, further down: the thumb rides up behind it. */
const OFF_STRAIGHT_MAG: HandKey<LeftPose> = { pose: "mag", drop: 0.14 };
const SHELL: HandKey<LeftPose> = { pose: "shell" };
const SHELL_POUCH: HandKey<LeftPose> = { pose: "shell", pouch: 1 };
const BOLT: HandKey<RightPose> = { pose: "bolt" };
/**
 * Between the grip and the bolt: first off the bottom of the grip along its slant, then out to the right.
 * Fingers round the grip slide off its end; a straight line would take them through it and the receiver.
 */
const GRIP_DOWN: HandKey<RightPose> = { pose: "grip", drop: 0.1, pull: 0.066 };
const GRIP_OUT: HandKey<RightPose> = { pose: "grip", clear: -0.06, drop: 0.1, pull: 0.066 };
const BOLT_OUT: HandKey<RightPose> = { pose: "bolt", clear: -0.05 };

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

/** The six-shooter's rounds go in one at a time (shared: each one seated adds to the count). */
const ROUNDS = REVOLVER_ROUNDS;
const ROUND_SEAT = REVOLVER_ROUND_SEAT;

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

/**
 * After each shot the thumb rolls the hammer back, turning the cylinder, as the muzzle comes down
 * from its kick (recoil.ts): the gun only tips a little toward the thumb doing the work.
 */
const REVOLVER_COCK: Clip = {
  gun: [[0, REST], [0.4, [0, 0, 0, 0.03, 0, 0.06]], [0.9, REST]],
  // The thumb lands on the fallen spur, then rides it back as the hammer rolls to full cock.
  right: [[0, GRIP], [0.18, { pose: "cock" }], [0.3, { pose: "cock" }], [0.62, { pose: "cocked" }], [0.7, { pose: "cocked" }], [1, GRIP]],
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
    right: [[0, GRIP], [0.02, GRIP_DOWN], [0.04, GRIP_OUT], [0.055, BOLT_OUT], [0.07, BOLT], [0.17, BOLT], [0.195, BOLT_OUT], [0.21, GRIP_OUT], [0.23, GRIP_DOWN], [0.25, GRIP],
      [0.66, GRIP], [0.675, GRIP_DOWN], [0.69, GRIP_OUT], [0.705, BOLT_OUT], [0.72, BOLT], [0.84, BOLT], [0.865, BOLT_OUT], [0.88, GRIP_OUT], [0.905, GRIP_DOWN], [0.93, GRIP]],
    boltPull: [[0.11, 0], [0.17, 1], [0.74, 1], [0.8, 0]],
    // Off the foregrip down and away, then up the magazine from below: never through the gun.
    left: [[0, SUPPORT], [0.1, { ...SUPPORT, drop: 0.14 }], [0.17, OFF_STRAIGHT_MAG], [0.2, MAG], [0.24, MAG], [0.34, POUCH], [0.44, POUCH], [0.55, MAG], [0.62, MAG],
      [0.66, OFF_STRAIGHT_MAG], [0.71, { ...SUPPORT, drop: 0.14 }], [0.76, SUPPORT]],
    mag: [[0.24, 0], [0.31, 0.1], [0.48, 0.1], [0.55, 0.05], [0.61, 0]],
    magHeld: [[0, false], [0.24, true], [0.62, false]],
  };
})();

const SNIPER_BOLT: Clip = (() => {
  const work: GunOffset = [-0.02, -0.03, -0.09, 0.05, 0.08, 0.3];
  // The shot's kick (recoil.ts) is ridden out before the bolt is worked.
  return {
    gun: [[0, REST], [0.12, REST], [0.3, work], [0.5, nudge(work, 0, 0, 0.01)], [0.56, nudge(work, 0, 0, 0.01)], [0.76, work], [1, REST]],
    right: [[0.18, GRIP], [0.22, GRIP_DOWN], [0.25, GRIP_OUT], [0.28, BOLT_OUT], [0.32, BOLT], [0.76, BOLT], [0.84, BOLT_OUT], [0.87, GRIP_OUT], [0.895, GRIP_DOWN], [0.92, GRIP]],
    boltPull: [[0.4, 0], [0.5, 1], [0.56, 1], [0.64, 0]],
  };
})();

/** Gun raised from below the frame (weapon switch, spawn). */
const DRAW: Keys<GunOffset> = [[0, [0.03, -0.16, 0.06, -0.8, 0.25, 0.45]], [1, REST]];

/** A pump or bolt cycle: `strokes` are where the action hits the back and front of its travel (0..1). */
interface Cycle { clip: Clip; seconds: number; strokes: readonly [number, number] }

// The wrist follows the gun track. During an inspect the knife has a second
// transform about its contact in the fingers, independent of the camera and arm.
const KNIFE_POSE: GunOffset = [0.08, 0.035, -0.04, 0.29, 1.04, 0.19];
const KATANA_POSE: GunOffset = [-0.085, 0.053, -0.105, -0.23, -1.24, -2.45];
const PINCH: HandKey<RightPose> = { pose: "pinch" };
const TURN = 2 * Math.PI;
export type BladeCue = "clack" | "latch" | "air";

/**
 * Where the knife is shown off: raised right of centre, a hand's length from the eye, its flat to
 * the camera and the tip up and left. Here the pin axis points away from the eye, so handle swings
 * and twirls about the fingers turn in the plane of the screen, where they read best.
 */
const SHOW: GunOffset = [0.045, 0.102, 0.056, 0.63, 1.23, -0.63];
const sh = (...d: number[]) => nudge(SHOW, ...d);

const KNIFE_DRAW: Clip = {
  gun: [[0, nudge(KNIFE_POSE, 0.05, -0.13, 0.04, -0.6, -0.22, 0.86)],
    [0.36, nudge(KNIFE_POSE, 0.013, 0.028, -0.03, 0.34, 0.05, 0.32)],
    [0.74, nudge(KNIFE_POSE, -0.012, 0, 0, -0.15, 0.14, -0.15)], [1, KNIFE_POSE]],
  right: [[0, PINCH], [0.76, PINCH], [1, GRIP]],
  safe: [[0, 1], [0.12, 1], [0.57, 0]], bite: [[0, 1], [0.32, 1], [0.8, 0]],
  cues: [[0.57, "clack"], [0.8, "latch"]],
};

/** A clip keyed in seconds, scaled to 0..1 over `seconds`. */
function timed(seconds: number, c: Clip): { clip: Clip; seconds: number } {
  const k = <T>(keys?: Keys<T>) => keys?.map(([t, v]): [number, T] => [t / seconds, v]);
  return { seconds, clip: { gun: k(c.gun), right: k(c.right), safe: k(c.safe), bite: k(c.bite), spin: k(c.spin), release: k(c.release),
    flight: c.flight && [c.flight[0] / seconds, c.flight[1] / seconds], cues: k(c.cues) } };
}

/** Fingers move from the fist to the pinch as the knife comes up, and back as it goes down. */
const pinchFor = (seconds: number): Keys<HandKey<RightPose>> => [[0, GRIP], [0.16, PINCH], [seconds - 0.2, PINCH], [seconds, GRIP]];
/** Up into view with a little overshoot, and back down to the hold. */
const raise: Keys<GunOffset> = [[0, KNIFE_POSE], [0.2, sh(0.004, 0.012, 0, 0.12)], [0.3, SHOW]];
const lower = (seconds: number): Keys<GunOffset> => [[seconds - 0.24, SHOW], [seconds, KNIFE_POSE]];

/**
 * The long one: a rollover shut and open again, a twirl round the index finger, and the blade
 * turned to the light before it goes down. Each handle swing is a dip or flick of the wrist.
 */
const SHOWCASE = timed(2.3, {
  gun: [[0, KNIFE_POSE], [0.17, sh(0.03, -0.055, -0.02, -0.48, 0, -0.38)],
    [0.4, sh(-0.016, 0.024, 0.025, 0.24)], [0.67, sh(0.018, -0.018, 0, -0.22)],
    [0.94, sh(-0.026, 0.04, 0.018, 0.32, 0.12)], [1.18, sh(0.018, -0.01, 0, -0.2)],
    [1.47, sh(0.025, 0.01, 0, 0.46, -0.2, 0.32)], [1.83, sh(0.025, 0.016, 0, 0.5, -0.23, 0.41)],
    ...lower(2.3)],
  right: [[0, GRIP], [0.17, PINCH], [1.26, PINCH], [1.47, GRIP], [2.3, GRIP]],
  bite: [[0, 0], [0.34, 0.91], [0.49, 0.84], [0.72, 0.08], [0.93, 0.68], [1.19, 0.53], [1.43, 0]],
  safe: [[0.18, 0], [0.42, 0.88], [0.61, 0.74], [0.86, 0]],
  spin: [[0.38, REST], [0.72, [0, 0, 0, -2.6, 0.12, 0.22]], [1.26, [0, 0, 0, -TURN, 0, 0]]],
  cues: [[0.42, "clack"], [0.86, "clack"], [1.43, "latch"]],
});

/** Two reverse twirls round the index finger, the loose handle swinging out on each turn. */
const TWIRLS = timed(1.55, {
  gun: [...raise, [0.62, sh(0.01, 0.012, 0, 0.08, 0.06, 0.05)], [0.95, sh(-0.006, -0.008, 0, -0.06, -0.04)], [1.24, SHOW], ...lower(1.55)],
  right: pinchFor(1.55),
  bite: [[0.3, 0], [0.38, 0.86], [1.1, 0.86], [1.2, 0]],
  spin: [[0.32, REST], [1.18, [0, 0, 0, -2 * TURN, 0, 0]]],
  cues: [[0.75, "clack"], [1.2, "latch"]],
});

/** The knife corkscrews: a turn about the finger and a roll about its own length at once. */
const HELIX = timed(1.7, {
  gun: [...raise, [0.78, sh(0.016, 0.014, -0.006, 0.12, -0.1, 0.2)], [1.2, sh(-0.01, -0.004, 0, -0.08, 0.08, -0.1)], [1.42, SHOW], ...lower(1.7)],
  right: pinchFor(1.7),
  spin: [[0.3, REST], [0.8, [0, 0, 0, Math.PI, -0.8, 1]], [1.36, [0, 0, 0, TURN, 0, -TURN]]],
  safe: [[0.36, 0], [0.74, 0.8], [1.1, 0]], bite: [[0.5, 0], [0.9, 1], [1.3, 0]],
  cues: [[0.9, "clack"], [1.1, "clack"], [1.36, "latch"]],
});

/** Tossed up spinning over the hand, which opens to let it go and closes on the catch. */
const AERIAL = timed(1.65, {
  gun: [...raise, [0.42, sh(0, -0.05, 0, -0.26)], [0.5, sh(0, -0.01, 0, 0.05)], [0.62, sh(0, -0.03)],
    [1.08, sh(0, -0.03)], [1.17, sh(0, -0.058, 0, -0.16)], [1.32, SHOW], ...lower(1.65)],
  right: pinchFor(1.65), release: [[0.46, 0], [0.56, 1], [1.02, 1], [1.12, 0]],
  flight: [0.5, 1.12], bite: [[0.45, 0], [0.66, 0.7], [0.98, 0.84], [1.12, 0]],
  cues: [[0.5, "air"], [1.13, "latch"]],
});

/** The handles splayed into a cross and the whole knife spun round the finger like a propeller. */
const FAN = timed(1.55, {
  gun: [...raise, [0.7, sh(0.008, 0.01, 0, 0.06, 0.05)], [1.0, sh(-0.006, 0.006, 0, -0.05)], [1.3, SHOW], ...lower(1.55)],
  right: pinchFor(1.55),
  safe: [[0.3, 0], [0.42, 0.5], [1.12, 0.5], [1.24, 0]],
  bite: [[0.34, 0], [0.46, 0.55], [1.12, 0.55], [1.26, 0]],
  spin: [[0.42, REST], [1.12, [0, 0, 0, -2 * TURN, 0, 0]]],
  cues: [[1.24, "clack"], [1.26, "latch"]],
});

/** Wrist poses at anticipation, contact and follow-through. Each cut settles before the next input. */
function cut(rest: GunOffset, wind: GunOffset, strike: GunOffset, through: GunOffset, contact = 0.32): Clip {
  return { contact, gun: [[0, rest], [contact - 0.17, nudge(rest, ...wind)], [contact, nudge(rest, ...strike)],
    [contact + 0.18, nudge(rest, ...through)], [1, rest]] };
}
const KNIFE_SLASH = cut(KNIFE_POSE, [0.045, 0.025, 0.035, 0.24, -0.48, -0.35], [-0.16, 0.006, -0.095, -0.36, 0.86, 0.94], [-0.19, -0.045, -0.04, -0.49, 1.15, 1.14]);
const KNIFE_BACKHAND = cut(KNIFE_POSE, [-0.09, -0.028, 0.025, -0.3, 0.52, 0.59], [0.045, 0.018, -0.09, 0.2, -0.78, -0.5], [0.09, 0.035, -0.04, 0.34, -1, -0.76]);
const KNIFE_STAB = cut(KNIFE_POSE, [0.025, -0.025, 0.05, -0.32, 0.03, -0.4], [-0.07, 0.045, -0.15, -0.51, -0.24, -0.58], [-0.064, 0.038, -0.13, -0.48, -0.18, -0.5]);
const KNIFE_HEAVY = cut(KNIFE_POSE, [0.05, -0.065, 0.08, -0.25, -0.26, -0.75], [-0.105, 0.065, -0.18, -0.46, -0.22, -0.93], [-0.087, 0.025, -0.145, -0.57, -0.11, -1.12], 0.41);
/** Carry speed through the middle of an arc. At a reversal or a held pose,
 * that channel comes to rest. Limit the tangent to avoid overshooting the keys. */
function swordClip(gun: Keys<GunOffset>, contact?: number): Clip {
  const tangents = gun.map(([time, pose], i): GunOffset => {
    const prev = gun[i - 1], next = gun[i + 1];
    if (!prev || !next) return REST;
    return pose.map((value, axis) => {
      const incoming = (value - prev[1][axis]) / (time - prev[0]);
      const outgoing = (next[1][axis] - value) / (next[0] - time);
      return incoming * outgoing > 0 ? Math.sign(incoming) * Math.min(Math.abs(incoming), Math.abs(outgoing)) : 0;
    }) as GunOffset;
  });
  return { gun, tangents, contact };
}

// Each pair of hands moves as one. The blade carries past the contact beat,
// settles in a distinct finishing silhouette, then comes back to guard.
const KATANA_DRAW = swordClip([
  [0, nudge(KATANA_POSE, 0.085, -0.13, 0.055, -0.24, -0.2, 0.35)],
  [0.58, nudge(KATANA_POSE, -0.022, 0.045, -0.02, 0.15, 0.1, -0.14)],
  [1, KATANA_POSE],
]);
const KATANA_SLASH = swordClip([
  [0, KATANA_POSE], [0.18, [0.035, 0.15, -0.105, 0.99, -0.94, -0.72]],
  [0.34, [-0.05, 0.14, -0.17, 0.33, 0.38, 0.38]],
  [0.49, [-0.145, 0.087, -0.14, 0.04, 1.20, 0.90]],
  [0.64, [-0.165, 0.067, -0.11, 0.01, 1.29, 0.91]],
  [0.82, [-0.08, 0.055, -0.12, 0.25, 0.74, 0.32]], [1, KATANA_POSE],
], 0.34);
const KATANA_RISING = swordClip([
  [0, KATANA_POSE], [0.19, [-0.155, 0.092, -0.13, -0.10, 0.94, -0.70]],
  [0.36, [-0.065, 0.15, -0.155, 0.34, -0.40, -0.89]],
  [0.51, [0.015, 0.19, -0.13, 0.83, -0.93, -1.10]],
  [0.65, [0.021, 0.195, -0.115, 0.90, -1.02, -1.03]],
  [0.83, [0.04, 0.125, -0.095, 0.70, -0.55, -0.79]], [1, KATANA_POSE],
], 0.36);
const KATANA_SWEEP = swordClip([
  [0, KATANA_POSE], [0.18, [0.025, 0.12, -0.105, 0.16, -1.00, -1.08]],
  [0.36, [-0.08, 0.14, -0.155, 0.18, 0.28, -0.95]],
  [0.51, [-0.175, 0.125, -0.13, 0.21, 1.16, -0.85]],
  [0.66, [-0.18, 0.117, -0.11, 0.20, 1.25, -0.80]],
  [0.85, [-0.06, 0.078, -0.12, 0.34, 0.65, -0.71]], [1, KATANA_POSE],
], 0.36);
const KATANA_OVERHEAD = swordClip([
  [0, KATANA_POSE], [0.21, [-0.055, 0.18, -0.15, 0.98, -0.29, -0.10]],
  [0.38, [-0.085, 0.155, -0.175, 0.39, 0.12, 0.04]],
  [0.50, [-0.09, 0.10, -0.16, -0.16, 0.30, 0.12]],
  [0.65, [-0.075, 0.075, -0.13, -0.22, 0.34, 0.14]],
  [0.84, [-0.04, 0.063, -0.10, 0.24, 0.14, -0.04]], [1, KATANA_POSE],
], 0.38);
const KATANA_HEAVY = swordClip([
  [0, KATANA_POSE], [0.17, [0.025, 0.15, -0.09, 0.86, -0.78, -0.60]],
  [0.31, [-0.045, 0.19, -0.15, 0.96, -0.46, -0.42]],
  [0.38, [-0.05, 0.195, -0.15, 0.99, -0.43, -0.39]],
  [0.51, [-0.10, 0.15, -0.18, 0.24, 0.33, 0.25]],
  [0.62, [-0.16, 0.073, -0.155, -0.28, 0.78, 0.61]],
  [0.76, [-0.157, 0.066, -0.13, -0.30, 0.83, 0.64]],
  [0.91, [-0.07, 0.078, -0.10, 0.29, 0.49, 0.09]], [1, KATANA_POSE],
], 0.51);

// Lift the closed sword across the body, part the hands, roll the exposed
// flat through the light, then slide the lacquered mouth back to the guard.
const KATANA_INSPECT = swordClip([
  [0, KATANA_POSE], [0.17, [-0.22, 0.124, -0.07, 0.025, -1.37, -2.6]],
  [0.37, [-0.306, 0.138, -0.105, 0.035, -1.28, -2.75]],
  [0.54, [-0.32, 0.148, -0.115, 0.065, -1.27, -2.92]],
  [0.68, [-0.314, 0.155, -0.115, 0.10, -1.26, -2.41]],
  [0.84, [-0.22, 0.129, -0.074, 0.035, -1.36, -2.56]], [1, KATANA_POSE],
]);
KATANA_INSPECT.sheathPull = [[0, 0], [0.16, 0], [0.22, 0.042], [0.40, 0.355], [0.53, 0.44],
  [0.68, 0.44], [0.82, 0.035], [0.86, 0]];

interface Moves {
  reload: Clip;
  cycle?: Cycle;
  rest?: HandKey<LeftPose>;
  /** A blade's held pose (absent: REST), its attacks in turn and how long each lasts (s). */
  pose?: GunOffset;
  swings?: { clips: Clip[]; seconds: number };
  /** Played over the equip time instead of only raising it into view. */
  draw?: Clip;
  inspect?: { clip: Clip; seconds: number }[];
  heavy?: Clip;
}

const NO_RELOAD: Clip = {};

const CLIPS: Record<WeaponId, Moves> = {
  ar: { reload: MAG_RELOAD },
  smg: { reload: MAG_RELOAD },
  shotgun: { reload: SHOTGUN_RELOAD, cycle: { clip: SHOTGUN_PUMP, seconds: 0.36, strokes: [0.5, 0.75] } },
  sniper: { reload: SNIPER_RELOAD, cycle: { clip: SNIPER_BOLT, seconds: 0.64, strokes: [0.5, 0.64] } },
  pistol: { reload: REVOLVER_RELOAD, cycle: { clip: REVOLVER_COCK, seconds: 0.3, strokes: [0.3, 0.62] }, rest: BELT },
  knife: { reload: NO_RELOAD, rest: BELT, pose: KNIFE_POSE, swings: { clips: [KNIFE_SLASH, KNIFE_BACKHAND, KNIFE_STAB], seconds: 0.38 },
    heavy: KNIFE_HEAVY, draw: KNIFE_DRAW, inspect: [SHOWCASE, TWIRLS, HELIX, AERIAL, FAN] },
  katana: { reload: NO_RELOAD, pose: KATANA_POSE, swings: { clips: [KATANA_SLASH, KATANA_RISING, KATANA_SWEEP, KATANA_OVERHEAD], seconds: 0.62 },
    draw: KATANA_DRAW, heavy: KATANA_HEAVY, inspect: [{ clip: KATANA_INSPECT, seconds: 3.2 }] },
};

function swingClip(weapon: WeaponId, swing: number, heavy: boolean) {
  const moves = CLIPS[weapon];
  return heavy ? moves.heavy : moves.swings?.clips[Math.max(0, swing) % moves.swings.clips.length];
}

export function swingSeconds(weapon: WeaponId, heavy: boolean) {
  return heavy ? (WEAPONS[weapon].melee?.heavy.intervalMs ?? 0) / 1000 : CLIPS[weapon].swings?.seconds ?? 0;
}

export function cutContact(weapon: WeaponId, swing: number, heavy: boolean) {
  return swingClip(weapon, swing, heavy)?.contact ?? 0;
}

function inspectMove(weapon: WeaponId, trick: number) {
  const moves = CLIPS[weapon].inspect;
  return moves?.[trick % moves.length];
}

export function inspectSeconds(weapon: WeaponId, trick = 0) {
  return inspectMove(weapon, trick)?.seconds ?? 0;
}

export function bladeCues(weapon: WeaponId, trick: number, draw = false) {
  return (draw ? CLIPS[weapon].draw : inspectMove(weapon, trick)?.clip)?.cues;
}

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
    mag: 0, magHeld: false, magVisible: true, pump: 0, boltPull: 0, charge: 0, hammer: 0, cylinder: 0, shell: 0, shellHeld: false,
    safe: 0, bite: 0, spin: [...REST], flight: 0, release: 0, sheathPull: 0,
  };
}

/** Blade timing for `sampleHandling`: how many swings so far (which one plays) and seconds since an inspect began. */
export interface MeleeTiming { swing?: number; sinceInspect?: number; trick?: number; heavy?: boolean }

/**
 * Samples the handling pose. `reload` is the reload progress (or -1); `sinceShot` and
 * `sinceDraw` are seconds since the last shot and since the gun was drawn.
 */
export function sampleHandling(weapon: WeaponId, reload: number, sinceShot: number, sinceDraw: number, out = createHandling(), melee: MeleeTiming = {}) {
  const clips = CLIPS[weapon];
  for (let i = 0; i < 6; i++) out.gun[i] = clips.pose?.[i] ?? 0;
  out.left.a = out.left.b = clips.rest ?? SUPPORT; out.left.k = 0;
  out.right.a = out.right.b = GRIP; out.right.k = 0;
  out.mag = out.pump = out.boltPull = out.charge = out.hammer = out.cylinder = out.shell = out.safe = out.bite = out.flight = out.release = 0;
  out.spin.fill(0);
  out.sheathPull = 0;
  out.magHeld = out.shellHeld = false;
  out.magVisible = true;
  const inspect = inspectMove(weapon, melee.trick ?? 0);
  const heavy = melee.heavy ?? false;
  const duration = swingSeconds(weapon, heavy);
  const sinceInspect = melee.sinceInspect ?? -1;
  if (reload >= 0) apply(clips.reload, Math.min(1, reload), out);
  else if (clips.cycle && sinceShot >= 0 && sinceShot < clips.cycle.seconds) apply(clips.cycle.clip, sinceShot / clips.cycle.seconds, out);
  else if (clips.swings && sinceShot >= 0 && sinceShot < duration) {
    apply(swingClip(weapon, melee.swing ?? 0, heavy)!, sinceShot / duration, out);
  } else if (inspect && sinceInspect >= 0 && sinceInspect < inspect.seconds) apply(inspect.clip, sinceInspect / inspect.seconds, out);
  const equip = WEAPONS[weapon].equipMs / 1000;
  if (sinceDraw >= 0 && sinceDraw < equip) {
    if (clips.draw) apply(clips.draw, sinceDraw / equip, out);
    if (!clips.draw?.gun) {
      const d = sampleVec(DRAW, sinceDraw / equip);
      for (let i = 0; i < 6; i++) out.gun[i] += d[i];
    }
  }
  return out;
}

function apply(c: Clip, t: number, out: Handling) {
  if (c.gun) { const g = sampleVec(c.gun, t, c.tangents); for (let i = 0; i < 6; i++) out.gun[i] = g[i]; }
  if (c.left) sampleHand(c.left, t, out.left);
  if (c.right) sampleHand(c.right, t, out.right);
  if (c.mag) out.mag = sampleNum(c.mag, t);
  if (c.magHeld) out.magHeld = sampleStep(c.magHeld, t);
  if (c.magVisible) out.magVisible = sampleStep(c.magVisible, t);
  if (c.pump) out.pump = sampleNum(c.pump, t);
  if (c.boltPull) out.boltPull = sampleNum(c.boltPull, t);
  if (c.charge) out.charge = sampleNum(c.charge, t);
  if (c.hammer) out.hammer = sampleNum(c.hammer, t);
  if (c.cylinder) out.cylinder = sampleNum(c.cylinder, t);
  if (c.shell) out.shell = sampleNum(c.shell, t);
  if (c.shellHeld) out.shellHeld = sampleStep(c.shellHeld, t);
  if (c.spin) {
    const spin = sampleVec(c.spin, t);
    for (let i = 0; i < 6; i++) out.spin[i] = spin[i];
  }
  if (c.flight) {
    const [start, end] = c.flight;
    out.flight = Math.max(0, Math.min(1, (t - start) / (end - start)));
  }
  if (c.release) out.release = sampleNum(c.release, t);
  if (c.sheathPull) out.sheathPull = sampleNum(c.sheathPull, t);
  if (c.safe) out.safe = sampleNum(c.safe, t);
  if (c.bite) out.bite = sampleNum(c.bite, t);
}

/** Index of the key segment containing t and the eased fraction across it. */
function segment<T>(keys: Keys<T>, t: number, eased = true): [number, number] {
  if (t <= keys[0][0]) return [0, 0];
  for (let i = 0; i < keys.length - 1; i++) {
    const t0 = keys[i][0], t1 = keys[i + 1][0];
    if (t < t1) {
      const u = (t - t0) / (t1 - t0);
      return [i, eased ? u * u * (3 - 2 * u) : u];
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
function sampleVec(keys: Keys<GunOffset>, t: number, tangents?: GunOffset[]) {
  const [i, k] = segment(keys, t, !tangents);
  const next = Math.min(i + 1, keys.length - 1);
  const a = keys[i][1], b = keys[next][1];
  if (tangents) {
    const blend = k * k * (3 - 2 * k);
    const tangentScale = k * (1 - k) * (keys[next][0] - keys[i][0]);
    for (let j = 0; j < 6; j++) {
      _vec[j] = a[j] + (b[j] - a[j]) * blend + tangentScale * ((1 - k) * tangents[i][j] - k * tangents[next][j]);
    }
    return _vec;
  }
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
