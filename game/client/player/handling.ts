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
  /** 0..1 of the way the scabbard (and the hand on it) has gone off the sword to the hip. */
  sheathPark: number;
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
  sheathPark?: Keys<number>;
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
const KNIFE_POSE: GunOffset = [0.135, -0.04, 0.06, 0.36, 1.45, 0.19];
/**
 * The katana at rest, as in the reference: in the left fist just behind the guard, held low on the
 * right with the hilt rising up and left out of the fist and the blade reaching forward, right and down.
 * The right hand keeps the scabbard at the hip, out of view.
 */
const KATANA_POSE: GunOffset = [0.06, 0.06, -0.06, -0.35, -1.35, 1.0];
/** Sheathed and held across the body in both hands: where the inspect and the equip draw from. */
const SHEATHED: GunOffset = [-0.085, 0.053, -0.105, -0.23, -1.24, -2.45];
const PINCH: HandKey<RightPose> = { pose: "pinch" };
const TURN = 2 * Math.PI;
export type BladeCue = "clack" | "latch" | "air";

/**
 * Where the knife is shown off: raised right of centre, a hand's length from the eye, its flat to
 * the camera and the tip up and left. Here the pin axis points away from the eye, so handle swings
 * and twirls about the fingers turn in the plane of the screen, where they read best.
 */
const SHOW: GunOffset = [0.045, 0.102, 0.056, 0.63, 1.23, -0.63];

/** A clip keyed in seconds, scaled to 0..1 over `seconds`. */
function timed(seconds: number, c: Clip): { clip: Clip; seconds: number } {
  const k = <T>(keys?: Keys<T>) => keys?.map(([t, v]): [number, T] => [t / seconds, v]);
  return { seconds, clip: { contact: c.contact && c.contact / seconds, gun: k(c.gun), right: k(c.right), safe: k(c.safe), bite: k(c.bite), spin: k(c.spin), release: k(c.release),
    flight: c.flight && [c.flight[0] / seconds, c.flight[1] / seconds], cues: k(c.cues) } };
}

/** The knife upright in the fist at the show spot, tip to the sky and its flat to the camera. */
const UPRIGHT: GunOffset = nudge(SHOW, 0.01, -0.015, 0.06, 0.48, -0.21, 0.36);
const up = (...d: number[]) => nudge(UPRIGHT, ...d);
/** Palm down with the knife flat, pointing left: between the upright flips and the fan. */
const PALM_DOWN: GunOffset = nudge(KNIFE_POSE, -0.03, 0.035, 0.015, -0.15, 0.05, -0.2);
/** Palm up, fingers out: the knife lies over them and turns nearly flat. */
const PALM_UP: GunOffset = up(-0.02, -0.03, 0, -0.3, 0, 0.35);
/** Palm to the left, fingers forward: the splayed knife spins like a propeller facing the camera. */
const PROP: GunOffset = up(-0.005, 0.005, 0, 0, 0, 0.3);
const DIP: GunOffset = up(0.03, -0.085, 0.01, -0.35, 0, 0.6);
/** Shut in the fist, the handles hanging below it. */
const HANG: GunOffset = up(0.008, -0.022, 0, 0, 0, -0.05);
/** Turns about the fingers; `tilt` lays the knife back under them so the spin is seen from above. */
const splay = (turns: number, tilt = 0): GunOffset => [0, 0, 0, -turns * TURN, -tilt, 0];

/**
 * The equip: up from below with a flip on the way, the knife flat for a beat, two more flips as the
 * hand climbs right, then held upright to show it off before it tips over into the hold. The tail
 * past the equip time is looks only: any attack or inspect cuts it short.
 */
const KNIFE_DRAW = timed(1.35, {
  gun: [[0, nudge(KNIFE_POSE, 0.03, -0.16, 0.04, -0.5, -0.1, 0.7)], [0.08, up(0.01, -0.07, 0, -0.2, 0, 0.35)],
    [0.15, nudge(PALM_DOWN, 0.01, -0.02)], [0.21, PALM_DOWN], [0.31, up(0.006, -0.025, 0, 0, 0, -0.3)],
    [0.41, up(-0.008, -0.01, 0, 0, 0, 0.3)], [0.5, up(0.004, 0.006, 0, 0, 0, -0.1)], [0.57, UPRIGHT],
    [0.88, up(-0.002, 0.004, 0, 0, 0, 0.04)], [1.1, nudge(KNIFE_POSE, -0.01, 0.025, 0, 0.18, 0.05, -0.35)], [1.35, KNIFE_POSE]],
  right: [[0, PINCH], [0.5, PINCH], [0.58, GRIP]],
  safe: [[0, 1], [0.03, 1], [0.1, 0], [0.24, 0], [0.33, 1], [0.44, 0]],
  bite: [[0, 1], [0.06, 1], [0.13, 0], [0.27, 0], [0.37, 1], [0.48, 0]],
  cues: [[0.1, "clack"], [0.13, "clack"], [0.33, "clack"], [0.44, "clack"], [0.48, "latch"]],
});

/**
 * The inspect, about five seconds: flips with the knife upright and the wrist rocking under it, a
 * flick open palm down, a fan over the open palm, a spin under the palm and a dip, two runs of
 * propeller spins with the handles splayed either side of another dip, then shut and held hanging
 * from the fist before it flicks open into the hold.
 */
const FLOURISH = timed(5.05, {
  gun: [[0, KNIFE_POSE], [0.12, up(0, -0.012, 0, 0, 0, 0.12)],
    [0.21, up(-0.012, -0.03, 0, 0, 0, 0.34)], [0.31, up(0.004, 0.008, 0, 0, 0, -0.1)],
    [0.43, up(0.014, -0.022, 0, 0, 0, -0.36)], [0.53, up(0, 0.01, 0, 0, 0, 0.04)],
    [0.63, up(-0.014, -0.04, 0.01, -0.25, 0, 0.45)], [0.7, PALM_DOWN], [0.76, nudge(PALM_DOWN, 0, -0.005)],
    [0.88, up(-0.01, -0.005, 0, 0, 0, 0.5)],
    [1.02, PALM_UP], [1.25, nudge(PALM_UP, 0.006, 0.01, 0, 0.08)], [1.45, nudge(PALM_UP, -0.004, -0.004)],
    [1.56, nudge(HANG, 0.01, -0.03, 0, -0.2, 0, 0.3)], [1.68, nudge(PALM_DOWN, 0.01, -0.01)],
    [1.8, nudge(PALM_UP, 0.012, -0.012, 0, -0.08)], [1.98, nudge(PALM_UP, 0.004, -0.004, 0, -0.04)],
    [2.12, nudge(PALM_DOWN, 0.03, -0.045, 0, -0.15)], [2.26, nudge(PALM_DOWN, 0.03, -0.05, 0, -0.15)],
    [2.42, PROP], [2.72, nudge(PROP, 0.008, 0.012, 0, 0.06, 0, -0.1)], [3.0, PROP], [3.12, DIP], [3.3, DIP],
    [3.45, PROP], [3.65, nudge(PROP, -0.008, 0.012, 0, 0.05, 0, 0.1)], [3.84, PROP],
    [3.92, nudge(HANG, 0, 0.01)], [4.0, HANG], [4.6, nudge(HANG, 0.002, -0.006)],
    [4.86, nudge(KNIFE_POSE, 0.012, -0.012, 0, 0.25, -0.1, 0.45)], [5.05, KNIFE_POSE]],
  right: [[0, GRIP], [0.1, PINCH], [3.9, PINCH], [4.02, GRIP]],
  safe: [[0.12, 0], [0.2, 1], [0.3, 0], [0.42, 1], [0.52, 0], [0.62, 1], [0.78, 1], [0.86, 0],
    [0.95, 0], [1.02, 0.5], [1.45, 0.5], [1.52, 1], [1.7, 1], [1.77, 0.5], [1.99, 0.5], [2.06, 1],
    [2.28, 1], [2.38, 0.5], [3.0, 0.5], [3.08, 1], [3.32, 1], [3.42, 0.5], [3.82, 0.5], [3.92, 1], [4.86, 1], [4.98, 0]],
  bite: [[0.16, 0], [0.25, 1], [0.36, 0], [0.47, 1], [0.58, 0], [0.66, 1], [0.8, 1], [0.88, 0],
    [0.97, 0], [1.04, 0.55], [1.45, 0.55], [1.54, 1], [1.72, 1], [1.79, 0.55], [2.0, 0.55], [2.08, 1],
    [2.3, 1], [2.4, 0.55], [3.02, 0.55], [3.1, 1], [3.34, 1], [3.44, 0.55], [3.84, 0.55], [3.94, 1], [4.9, 1], [5.02, 0]],
  spin: [[0.98, REST], [1.06, splay(0.08, 1)], [1.45, splay(2, 1)], [1.55, splay(2)], [1.7, splay(2)], [1.78, splay(2.08, 1)], [2.0, splay(3, 1)],
    [2.08, splay(3)], [2.38, splay(3)], [3.0, splay(5)], [3.4, splay(5)], [3.84, splay(7)]],
  cues: [[0.2, "clack"], [0.3, "clack"], [0.42, "clack"], [0.52, "clack"], [0.66, "clack"], [0.86, "latch"],
    [1.05, "air"], [1.53, "clack"], [1.78, "clack"], [1.82, "air"], [2.07, "clack"], [2.39, "clack"], [2.45, "air"],
    [3.09, "clack"], [3.43, "clack"], [3.48, "air"], [3.92, "clack"], [3.94, "latch"], [4.98, "clack"], [5.02, "latch"]],
});



/** Wrist poses at anticipation, contact and follow-through. Each cut settles before the next input. */
function cut(rest: GunOffset, wind: GunOffset, strike: GunOffset, through: GunOffset, contact = 0.32): Clip {
  return { contact, gun: [[0, rest], [contact - 0.17, nudge(rest, ...wind)], [contact, nudge(rest, ...strike)],
    [contact + 0.18, nudge(rest, ...through)], [1, rest]] };
}
/** The first cut: pulled back off the right of the screen, then driven in low toward the centre, point first. */
const KNIFE_THRUST = cut(KNIFE_POSE, [0.12, -0.08, 0.06, -0.15, -0.3, 0.2], [-0.1, 0.0, -0.18, -0.3, -0.45, 0], [-0.08, -0.01, -0.14, -0.28, -0.4, 0], 0.45);
/** The second: the knife snaps upright low in the middle, then the arm sweeps it out to the left. */
const KNIFE_SWEEP = timed(0.55, { contact: 0.24, gun: [[0, KNIFE_POSE], [0.12, [-0.08, -0.06, 0.04, 1.1, 1.0, -0.2]],
  [0.24, [-0.48, 0.04, -0.12, 0.05, 1.55, 0.2]], [0.32, [-0.6, -0.02, -0.06, 0.0, 1.6, 0.25]],
  [0.43, nudge(KNIFE_POSE, 0.02, -0.04)], [0.55, KNIFE_POSE]] });
const KNIFE_BACKHAND = cut(KNIFE_POSE, [-0.09, -0.028, 0.025, -0.3, 0.52, 0.59], [0.045, 0.018, -0.09, 0.2, -0.78, -0.5], [0.09, 0.035, -0.04, 0.34, -1, -0.76]);
/** The heavy's follow-through: the arm across the bottom of the view, the fist far left, the blade standing up out of it. */
const FOLLOW: GunOffset = [-0.24, -0.02, 0.06, 1.0, 1.1, -0.1];
/**
 * The heavy: a short pull back, a whip up to the left, and the follow-through held across the body
 * before the hand swings back, the knife falls shut, flips open in an X and flicks into the hold.
 * Only the first 0.75 s (the heavy's interval) is needed for the blow; the rest is looks, and the
 * next attack cuts it short.
 */
const KNIFE_HEAVY = timed(2.1, {
  contact: 0.22,
  gun: [[0, KNIFE_POSE], [0.12, nudge(KNIFE_POSE, 0.1, -0.1, 0.06, -0.2, -0.35, 0.3)],
    [0.22, [-0.34, 0.16, -0.18, 0.6, 1.3, 0.2]], [0.36, FOLLOW], [0.62, nudge(FOLLOW, 0.01, 0.006)],
    [1.13, nudge(FOLLOW, 0.006, -0.004)], [1.3, nudge(HANG, -0.02, -0.06, 0, -0.1, 0, 0.2)],
    [1.48, nudge(HANG, -0.02, -0.055, 0, -0.1, 0, 0.2)],
    [1.6, up(0, -0.03, 0, 0, 0, 0.3)], [1.72, up(0.01, -0.02, 0, 0, 0, -0.3)], [1.84, nudge(PALM_DOWN, 0, 0.01)],
    [1.96, nudge(KNIFE_POSE, -0.01, 0.02, 0, 0.15, 0.05, -0.3)], [2.1, KNIFE_POSE]],
  right: [[0, GRIP], [1.18, GRIP], [1.28, PINCH], [1.88, PINCH], [2.0, GRIP]],
  safe: [[1.18, 0], [1.3, 1], [1.56, 1], [1.66, 0.45], [1.76, 1], [1.9, 0]],
  bite: [[1.2, 0], [1.32, 1], [1.58, 1], [1.68, 0.55], [1.78, 1], [1.94, 0]],
});
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

/** On the way back from a cut the sword comes up hilt first out of the lower left, then drops to rest. */
const KATANA_LIFT: GunOffset = [-0.08, 0.02, -0.06, 1.15, 0.2, 0.3];
/**
 * The reference cut, one hand throughout: a small lift to the right, one fast sweep from right to left
 * across the view on the contact beat, the arm carried on out of view on the left and held there, then
 * the sword brought back up hilt first and dropped to rest.
 */
function arc(wind: GunOffset, strike: GunOffset, through: GunOffset, hold: GunOffset): Clip {
  return swordClip([[0, KATANA_POSE], [0.14, wind], [0.3, strike], [0.42, through], [0.62, hold], [0.84, KATANA_LIFT], [1, KATANA_POSE]], 0.3);
}
/** Flat across the middle. */
const KATANA_SLASH = arc([0.07, 0.085, -0.05, 0.12, -1.5, 1.2], [-0.08, 0.15, -0.16, 0.02, 0.55, 1.3],
  [-0.3, 0.1, -0.09, -0.05, 1.35, 1.3], [-0.36, -0.08, 0.0, -0.2, 1.5, 1.2]);
/** Down and across, from high on the right to low on the left. */
const KATANA_SWEEP = arc([0.06, 0.09, -0.05, 0.62, -1.4, 1.0], [-0.08, 0.12, -0.16, -0.15, 0.55, 1.1],
  [-0.28, 0.01, -0.09, -0.45, 1.25, 1.1], [-0.34, -0.14, 0.0, -0.5, 1.4, 1.0]);
/** Up and across, from low on the right to high on the left. */
const KATANA_RISING = arc([0.1, 0.04, -0.05, -0.4, -1.4, 1.5], [-0.08, 0.15, -0.16, 0.2, 0.55, 1.5],
  [-0.28, 0.2, -0.09, 0.4, 1.3, 1.5], [-0.36, -0.06, 0.0, -0.1, 1.5, 1.3]);
/** The flat cut again, higher, near eye level. */
const KATANA_OVERHEAD = arc([0.06, 0.1, -0.06, 0.3, -1.5, 1.2], [-0.07, 0.2, -0.17, 0.1, 0.55, 1.3],
  [-0.29, 0.17, -0.1, 0.0, 1.35, 1.3], [-0.36, -0.06, 0.0, -0.2, 1.5, 1.2]);
/**
 * The heavy: raised high on the right with the tip up and back, held a beat, then one big diagonal cut
 * down across the view to the lower left, held there, and brought back up to rest like the light cuts.
 */
const KATANA_HEAVY = swordClip([
  [0, KATANA_POSE], [0.2, [0.06, 0.09, -0.05, 1.15, -0.9, 1.3]], [0.36, [0.055, 0.085, -0.05, 1.22, -0.85, 1.3]],
  [0.5, [-0.06, 0.06, -0.16, -0.1, 0.5, 1.2]], [0.6, [-0.26, -0.1, -0.08, -0.6, 1.1, 1.1]],
  [0.76, [-0.32, -0.16, 0.0, -0.65, 1.3, 1.0]], [0.9, KATANA_LIFT], [1, KATANA_POSE],
], 0.5);

/** A sword clip keyed in seconds, scaled to 0..1 over `seconds`. */
function swordTimed(seconds: number, gun: Keys<GunOffset>, c: Clip = {}): { clip: Clip; seconds: number } {
  const k = <T>(keys?: Keys<T>) => keys?.map(([t, v]): [number, T] => [t / seconds, v]);
  const clip = swordClip(k(gun)!);
  return { seconds, clip: { ...clip, sheathPull: k(c.sheathPull), sheathPark: k(c.sheathPark), cues: k(c.cues), right: k(c.right), left: k(c.left) } };
}

// Sword poses with the scabbard gone to the hip and the blade in the left hand. Turned side on
// (yaw -pi/2), pitch turns the sword in the plane of the screen and roll turns the edge to the eye.
/**
 * The finish: the arm up from the lower left, the guard high and the blade down across the view to the
 * right. Kept near enough that the elbow, where the first-person sleeve ends, stays below the screen.
 */
const PRESENT: GunOffset = [-0.13, 0.17, -0.1, -0.7, -1.2, 0.3];
const SIDE = -Math.PI / 2;
/** Fully drawn and level across the view, the tip to the right. */
const LEVEL: GunOffset = [-0.2, 0.125, -0.1, 0.03, -1.45, -2.9];

/**
 * The equip: up from below with the sword sheathed across the body, the left hand on the hilt and the
 * right on the scabbard, the scabbard pulled off to the right in one stroke and taken to the hip, the
 * sword raised to the finish and held, then lowered to rest. The tail past the equip time is looks only.
 */
const KATANA_DRAW = swordTimed(1.35, [
  [0, nudge(SHEATHED, 0.07, -0.14, 0.05, -0.24, -0.2, 0.35)], [0.22, nudge(SHEATHED, 0, -0.025)],
  [0.42, [-0.2, 0.07, -0.09, 0.02, -1.35, -2.7]], [0.58, [-0.14, 0.08, -0.11, 0.05, -1.5, -0.8]],
  [0.76, PRESENT], [1.04, nudge(PRESENT, 0.004, 0.006, 0, 0.03)], [1.2, KATANA_POSE], [1.35, KATANA_POSE],
], {
  sheathPull: [[0, 0], [0.24, 0], [0.45, 0.78]],
  sheathPark: [[0, 0], [0.44, 0], [0.6, 1]],
  cues: [[0.45, "air"], [0.7, "air"], [1.18, "latch"]],
});

/**
 * The inspect, timed to the reference footage: a slow two-handed draw across the body until the
 * scabbard drops away, the blade rolled to show its edge, dropped low and brought up hilt first into
 * a spin round the hand, swung up overhead, whipped down through a whole turn, spun the other way,
 * lowered across the bottom, then raised to the finish and snapped back to rest. Spins
 * carry on through whole turns, so later keys sit a turn or two on.
 */
const KATANA_INSPECT = swordTimed(7.1, [
  [0, KATANA_POSE], [0.22, SHEATHED], [0.42, [-0.2, 0.124, -0.07, 0.025, -1.37, -2.6]],
  [0.98, [-0.27, 0.138, -0.07, 0.035, -1.3, -2.75]], [1.37, [-0.27, 0.14, -0.07, 0.05, -1.3, -2.85]],
  // Level, then the edge rolled up to the light.
  [1.55, LEVEL], [1.8, [-0.17, 0.14, -0.1, 0.12, SIDE, -2.1]], [2.0, [-0.12, 0.13, -0.11, 0.18, SIDE, -1.75]],
  // Dropped low, brought up hilt first, one turn round the hand, balanced, swung up and held overhead.
  [2.05, [-0.25, 0.01, -0.1, -0.9, SIDE, -0.6]], [2.12, [-0.2, 0.05, -0.12, -1.57, SIDE, 0]],
  [2.2, [-0.08, 0.015, -0.1, -1.57, SIDE, 0]], [2.3, [-0.07, 0.005, -0.1, -1.57 - TURN, SIDE, 0]],
  [2.4, [-0.07, 0.015, -0.1, -1.57 - TURN, SIDE, 0]], [2.5, [-0.05, 0.12, -0.12, 0.8 - TURN, SIDE, 0]],
  [2.65, [-0.16, 0.28, -0.06, 1.4 - TURN, -1.4, 0]], [3.1, [-0.17, 0.29, -0.06, 1.45 - TURN, -1.4, 0.05]],
  // Whipped down through a whole turn to low on the left, the tip swaying.
  [3.3, [-0.24, -0.03, -0.13, 0.9 - 2 * TURN, SIDE, 0]], [3.6, [-0.23, -0.01, -0.13, 0.65 - 2 * TURN, SIDE, 0.1]],
  [3.8, [-0.22, -0.02, -0.13, 1.0 - 2 * TURN, SIDE, 0]], [4.12, [-0.2, -0.02, -0.13, 1.2 - 2 * TURN, SIDE, 0]],
  // Turned hilt up, spun a whole turn the other way, swung up and lowered across the bottom.
  [4.25, [-0.2, 0.0, -0.13, -1.57 - 2 * TURN, SIDE, 0]], [4.5, [-0.08, 0.005, -0.1, -1.57 - TURN, SIDE, 0]],
  [4.62, [-0.07, 0.015, -0.1, -1.57 - TURN, SIDE, 0]], [4.78, [-0.1, 0.16, -0.13, -TURN, SIDE, 0]],
  [4.9, [-0.12, 0.2, -0.12, 0.8 - TURN, -1.4, 0]], [5.05, [-0.04, -0.03, -0.1, 0.05 - TURN, SIDE, 0]],
  [5.5, [-0.03, -0.025, -0.1, 0.08 - TURN, SIDE, 0]],
  // Raised to the finish and held, lowered to rest, and the grip settled.
  [5.97, nudge(PRESENT, 0, 0, 0, -TURN)], [6.4, nudge(PRESENT, 0.004, 0.006, 0, 0.03 - TURN)],
  [6.55, nudge(KATANA_POSE, 0, 0, 0, -TURN)], [6.8, nudge(KATANA_POSE, 0.01, -0.01, 0, -0.04 - TURN, 0, 0.05)],
  [7.1, nudge(KATANA_POSE, 0, 0, 0, -TURN)],
], {
  sheathPull: [[0, 0], [0.42, 0.03], [0.98, 0.4], [1.4, 0.78]],
  sheathPark: [[0, 1], [0.2, 0], [1.3, 0], [1.6, 1]],
  cues: [[1.42, "air"], [2.25, "air"], [2.52, "air"], [3.22, "air"], [4.36, "air"], [4.84, "air"], [5.8, "air"], [6.56, "latch"]],
});



interface Moves {
  reload: Clip;
  cycle?: Cycle;
  rest?: HandKey<LeftPose>;
  /** The right hand between moves (absent: GRIP) and whether the scabbard rests at the hip. */
  hold?: HandKey<RightPose>;
  parked?: boolean;
  /** A blade's held pose (absent: REST), its attacks in turn and how long each lasts (s). */
  pose?: GunOffset;
  /** Attacks in turn and how long each runs (s); `each` lets one run longer as looks, cut short by the next attack. */
  swings?: { clips: Clip[]; seconds: number; each?: (number | undefined)[] };
  /** How long the heavy's clip runs (s), when it carries on past the heavy's interval as looks only. */
  heavySeconds?: number;
  /** Played over the equip time instead of only raising it into view. */
  draw?: Clip;
  /** A blade's draw can run on past the equip time as looks only, until it attacks or inspects (s). */
  drawSeconds?: number;
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
  knife: { reload: NO_RELOAD, rest: BELT, pose: KNIFE_POSE, swings: { clips: [KNIFE_THRUST, KNIFE_SWEEP.clip, KNIFE_BACKHAND], seconds: 0.38, each: [undefined, KNIFE_SWEEP.seconds] },
    heavy: KNIFE_HEAVY.clip, heavySeconds: KNIFE_HEAVY.seconds, draw: KNIFE_DRAW.clip, drawSeconds: KNIFE_DRAW.seconds, inspect: [FLOURISH] },
  katana: { reload: NO_RELOAD, pose: KATANA_POSE, parked: true, swings: { clips: [KATANA_SLASH, KATANA_SWEEP, KATANA_RISING, KATANA_OVERHEAD], seconds: 0.62 },
    draw: KATANA_DRAW.clip, drawSeconds: KATANA_DRAW.seconds, heavy: KATANA_HEAVY, inspect: [KATANA_INSPECT] },
};

function swingClip(weapon: WeaponId, swing: number, heavy: boolean) {
  const moves = CLIPS[weapon];
  return heavy ? moves.heavy : moves.swings?.clips[Math.max(0, swing) % moves.swings.clips.length];
}

/** How long a blow's clip runs (s). A heavy's may run past its interval as looks; the next blow cuts it short. */
export function swingSeconds(weapon: WeaponId, heavy: boolean, swing = 0) {
  const swings = CLIPS[weapon].swings;
  if (heavy) return CLIPS[weapon].heavySeconds ?? (WEAPONS[weapon].melee?.heavy.intervalMs ?? 0) / 1000;
  return swings ? swings.each?.[Math.max(0, swing) % swings.clips.length] ?? swings.seconds : 0;
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

/** How long the draw animation runs (s): the equip time, or longer for a blade's flourish. */
export function drawSeconds(weapon: WeaponId) {
  return CLIPS[weapon].drawSeconds ?? WEAPONS[weapon].equipMs / 1000;
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
    safe: 0, bite: 0, spin: [...REST], flight: 0, release: 0, sheathPull: 0, sheathPark: 0,
  };
}

/** Copies a sampled pose into `out`, reusing its arrays. */
export function copyHandling(src: Handling, out: Handling) {
  for (let i = 0; i < 6; i++) { out.gun[i] = src.gun[i]; out.spin[i] = src.spin[i]; }
  out.left = { ...src.left }; out.right = { ...src.right };
  out.mag = src.mag; out.magHeld = src.magHeld; out.magVisible = src.magVisible; out.pump = src.pump; out.boltPull = src.boltPull;
  out.charge = src.charge; out.hammer = src.hammer; out.cylinder = src.cylinder; out.shell = src.shell; out.shellHeld = src.shellHeld;
  out.safe = src.safe; out.bite = src.bite; out.flight = src.flight; out.release = src.release;
  out.sheathPull = src.sheathPull; out.sheathPark = src.sheathPark;
  return out;
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
  out.right.a = out.right.b = clips.hold ?? GRIP; out.right.k = 0;
  out.mag = out.pump = out.boltPull = out.charge = out.hammer = out.cylinder = out.shell = out.safe = out.bite = out.flight = out.release = 0;
  out.spin.fill(0);
  out.sheathPull = 0;
  out.sheathPark = clips.parked ? 1 : 0;
  out.magHeld = out.shellHeld = false;
  out.magVisible = true;
  const inspect = inspectMove(weapon, melee.trick ?? 0);
  const heavy = melee.heavy ?? false;
  const duration = swingSeconds(weapon, heavy, melee.swing ?? 0);
  const sinceInspect = melee.sinceInspect ?? -1;
  let busy = true;
  if (reload >= 0) apply(clips.reload, Math.min(1, reload), out);
  else if (clips.cycle && sinceShot >= 0 && sinceShot < clips.cycle.seconds) apply(clips.cycle.clip, sinceShot / clips.cycle.seconds, out);
  else if (clips.swings && sinceShot >= 0 && sinceShot < duration) {
    apply(swingClip(weapon, melee.swing ?? 0, heavy)!, sinceShot / duration, out);
  } else if (inspect && sinceInspect >= 0 && sinceInspect < inspect.seconds) apply(inspect.clip, sinceInspect / inspect.seconds, out);
  else busy = false;
  const equip = WEAPONS[weapon].equipMs / 1000;
  const drawLength = drawSeconds(weapon);
  // A blade's flourish past the equip time gives way to any attack or inspect.
  if (clips.draw && sinceDraw >= equip && sinceDraw < drawLength && !busy) apply(clips.draw, sinceDraw / drawLength, out);
  if (sinceDraw >= 0 && sinceDraw < equip) {
    if (clips.draw) apply(clips.draw, sinceDraw / drawLength, out);
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
  if (c.sheathPark) out.sheathPark = sampleNum(c.sheathPark, t);
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
