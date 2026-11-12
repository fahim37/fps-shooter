import type { WeaponId } from "../../shared/weapons";

/**
 * How a held gun moves when it fires. Looks only: where shots go and how the view climbs is
 * decided elsewhere (LocalPlayer). Each shot shoves the gun back into the shoulder, lifts the
 * muzzle and twists it a little differently every time; the arms then bring it back like a
 * weight on a spring, so automatic fire piles up into a gun that sits back and chatters instead
 * of replaying one canned kick.
 */
export interface RecoilProfile {
  /** One shot from rest: metres back along the barrel and up, and radians of muzzle rise. */
  back: number; up: number; rise: number;
  /** Sideways swing and twist about the barrel (rad): a random share of this, either way, each shot. */
  yaw: number; roll: number;
  /** How quickly the hold brings the gun back (rad/s) and how little it overshoots on the way (1: not at all). */
  stiffness: number; damping: number;
  /** Share of the turning kept while aiming down the sights, where the stock is in the shoulder. */
  aimed: number;
}

export const RECOIL: Record<WeaponId, RecoilProfile> = {
  // Light, quick and snappy: a burst sits the rifle back about a centimetre and rattles it there.
  ar: { back: 0.026, up: 0.003, rise: 0.032, yaw: 0.01, roll: 0.018, stiffness: 26, damping: 0.7, aimed: 0.4 },
  smg: { back: 0.018, up: 0.002, rise: 0.022, yaw: 0.012, roll: 0.022, stiffness: 30, damping: 0.7, aimed: 0.4 },
  // One heavy shove that rocks the whole gun before the pump is worked.
  shotgun: { back: 0.075, up: 0.012, rise: 0.12, yaw: 0.02, roll: 0.035, stiffness: 17, damping: 0.62, aimed: 0.5 },
  sniper: { back: 0.065, up: 0.01, rise: 0.11, yaw: 0.012, roll: 0.025, stiffness: 15, damping: 0.7, aimed: 0.5 },
  // A plow-handled revolver rolls up in the hand; the thumb cocks it on the way back down.
  pistol: { back: 0.03, up: 0.014, rise: 0.34, yaw: 0.025, roll: 0.05, stiffness: 15, damping: 0.6, aimed: 0.75 },
};

/** Share of a kick that is there at once; the rest arrives as speed, peaking a few frames later. */
const SNAP = 0.4;
/** How fast the trigger finger lets off after a shot (1/s). */
const TRIGGER_RELEASE = 14;

interface Spring { x: number; v: number }

/** Advances a damped spring toward zero by `dt`, exactly: stable at any frame rate. */
function settle(s: Spring, stiffness: number, damping: number, dt: number) {
  const w = stiffness, z = Math.min(damping, 0.99);
  const wd = w * Math.sqrt(1 - z * z);
  const e = Math.exp(-z * w * dt), c = Math.cos(wd * dt), sn = Math.sin(wd * dt);
  const x = e * (s.x * c + ((s.v + z * w * s.x) / wd) * sn);
  s.v = e * (s.v * c - ((z * w * s.v + w * w * s.x) / wd) * sn);
  s.x = x;
}

/** Speed that carries a spring from rest out to a peak of 1. */
function launch(stiffness: number, damping: number) {
  const z = Math.min(damping, 0.99), root = Math.sqrt(1 - z * z);
  return stiffness / Math.exp((-z * Math.atan2(root, z)) / root);
}

export class Recoil {
  /** Metres back along the barrel and up; radians of muzzle rise, swing to the left and roll. */
  back = 0; up = 0; pitch = 0; yaw = 0; roll = 0;
  /** 0..1: the trigger finger squeezed. */
  trigger = 0;
  private springs: Record<"back" | "up" | "pitch" | "yaw" | "roll", Spring> = {
    back: { x: 0, v: 0 }, up: { x: 0, v: 0 }, pitch: { x: 0, v: 0 }, yaw: { x: 0, v: 0 }, roll: { x: 0, v: 0 },
  };
  private profile = RECOIL.ar;
  /** Which way the last shot twisted: the next leans the other way more often than not, as a held gun wobbles. */
  private lean = 1;

  /** A shot of `weapon` goes off. `random` is for tests. */
  kick(weapon: WeaponId, random: () => number = Math.random) {
    const p = this.profile = RECOIL[weapon];
    const speed = launch(p.stiffness, p.damping) * (1 - SNAP);
    const push = (s: Spring, amount: number) => { s.x += amount * SNAP; s.v += amount * speed; };
    const strength = 0.85 + random() * 0.3;
    this.lean = random() < 0.7 ? -this.lean : this.lean;
    push(this.springs.back, p.back * strength);
    push(this.springs.up, p.up * strength);
    push(this.springs.pitch, p.rise * strength);
    // A right-handed hold lets the muzzle wander up and to the right a little more than left.
    push(this.springs.yaw, p.yaw * (random() * 2 - 1.25));
    push(this.springs.roll, p.roll * this.lean * (0.4 + random() * 0.6));
    this.trigger = 1;
  }

  update(dt: number) {
    if (dt <= 0) return;
    const { stiffness, damping } = this.profile;
    const s = this.springs;
    settle(s.back, stiffness, damping, dt);
    settle(s.up, stiffness, damping, dt);
    // The muzzle comes down a little slower than the gun comes forward.
    settle(s.pitch, stiffness * 0.8, damping, dt);
    settle(s.yaw, stiffness * 0.8, damping, dt);
    settle(s.roll, stiffness, damping * 0.8, dt);
    this.back = s.back.x; this.up = s.up.x; this.pitch = s.pitch.x; this.yaw = s.yaw.x; this.roll = s.roll.x;
    this.trigger = Math.max(0, this.trigger - dt * TRIGGER_RELEASE);
  }

  /** A new gun in the hands: nothing left of the last one's kick. */
  reset() {
    for (const s of Object.values(this.springs)) s.x = s.v = 0;
    this.back = this.up = this.pitch = this.yaw = this.roll = this.trigger = 0;
  }

  /** Share of the turning shown at this much aim (0 hip, 1 sights up). */
  aimed(ads: number) {
    return 1 - (1 - this.profile.aimed) * ads;
  }
}
