export type WeaponId = "ar" | "smg" | "shotgun" | "sniper" | "pistol";
export const PRIMARIES: WeaponId[] = ["ar", "smg", "shotgun", "sniper"];

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: 0 | 1;
  auto: boolean;
  /** Rounds per minute (fire interval = 60000 / rpm). */
  rpm: number;
  damage: number;
  headMult: number;
  limbMult: number;
  pellets: number;
  /** Full damage until `falloffStart`, then linear down to `minMult` at `falloffEnd` (m). */
  falloffStart: number;
  falloffEnd: number;
  minMult: number;
  range: number;
  mag: number;
  reserve: number;
  reloadMs: number;
  equipMs: number;
  /** Cone half-angles in degrees. */
  spreadHip: number;
  spreadAds: number;
  spreadMove: number;
  spreadAir: number;
  /** Degrees of camera kick per shot. */
  recoilUp: number;
  recoilSide: number;
  adsFov: number;
  adsMs: number;
  moveMult: number;
  /** A sniper's optic: fully accurate from the moment the scope is up (see SCOPE_UP), for quick-scoping. */
  scope?: boolean;
}

/** How far into aiming (0..1) a magnified scope is up. */
export const SCOPE_UP = 0.7;

const W = (d: WeaponDef) => d;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ar: W({
    id: "ar", name: "STM-556", slot: 0, auto: true, rpm: 600, damage: 26, headMult: 2.6, limbMult: 0.85, pellets: 1,
    falloffStart: 30, falloffEnd: 65, minMult: 0.72, range: 200, mag: 35, reserve: 120, reloadMs: 1900, equipMs: 450,
    spreadHip: 1.7, spreadAds: 0.12, spreadMove: 1.1, spreadAir: 5, recoilUp: 0.4, recoilSide: 0.12,
    adsFov: 55, adsMs: 220, moveMult: 0.95,
  }),
  smg: W({
    id: "smg", name: "Honey Badger", slot: 0, auto: true, rpm: 880, damage: 19, headMult: 2.4, limbMult: 0.9, pellets: 1,
    falloffStart: 14, falloffEnd: 35, minMult: 0.6, range: 150, mag: 40, reserve: 160, reloadMs: 1650, equipMs: 350,
    spreadHip: 1.6, spreadAds: 0.22, spreadMove: 0.9, spreadAir: 3.5, recoilUp: 0.26, recoilSide: 0.15,
    adsFov: 62, adsMs: 170, moveMult: 1.05,
  }),
  shotgun: W({
    id: "shotgun", name: "Pump Shotgun", slot: 0, auto: false, rpm: 150, damage: 15, headMult: 1.4, limbMult: 0.9, pellets: 9,
    falloffStart: 9, falloffEnd: 22, minMult: 0.25, range: 60, mag: 6, reserve: 30, reloadMs: 2250, equipMs: 450,
    spreadHip: 5.5, spreadAds: 4.2, spreadMove: 1, spreadAir: 2, recoilUp: 2.2, recoilSide: 0.35,
    adsFov: 65, adsMs: 200, moveMult: 0.97,
  }),
  sniper: W({
    id: "sniper", name: "Kalamit 52B", slot: 0, auto: false, rpm: 90, damage: 120, headMult: 2, limbMult: 0.8, pellets: 1,
    falloffStart: 80, falloffEnd: 200, minMult: 1, range: 300, mag: 5, reserve: 25, reloadMs: 2500, equipMs: 600,
    spreadHip: 7, spreadAds: 0.02, spreadMove: 3, spreadAir: 9, recoilUp: 3.2, recoilSide: 0.2,
    adsFov: 18, adsMs: 170, moveMult: 0.9, scope: true,
  }),
  pistol: W({
    id: "pistol", name: "Peacemaker", slot: 1, auto: false, rpm: 190, damage: 44, headMult: 4.55, limbMult: 0.9, pellets: 1,
    falloffStart: 18, falloffEnd: 40, minMult: 0.6, range: 120, mag: 6, reserve: 36, reloadMs: 2600, equipMs: 250,
    spreadHip: 0.18, spreadAds: 0.16, spreadMove: 0.2, spreadAir: 3, recoilUp: 1.5, recoilSide: 0.2,
    adsFov: 66, adsMs: 150, moveMult: 1.05,
  }),
};

export const GRENADE = {
  fuseMs: 4000,
  throwSpeed: 21,
  /** An underhand lob (right mouse while aiming) leaves the hand at this fraction of a full throw. */
  lobPower: 0.5,
  radius: 8,
  /** At the blast; lethal through a full shield out to about 2.5 m, around 45 damage at 6 m. */
  damage: 220,
  /** Minimum damage at the edge of the radius, as a fraction. */
  edgeMult: 0.1,
  /** How sharply damage drops off from the blast to the edge (1 is linear). */
  falloffPower: 1.5,
  /** Air drag on the server's grenade body (see grenade.ts); the aiming arc integrates the same. */
  linearDamping: 0.15,
};

export function damageAt(def: WeaponDef, distance: number): number {
  if (distance <= def.falloffStart) return def.damage;
  if (distance >= def.falloffEnd) return def.damage * def.minMult;
  const t = (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return def.damage * (1 - t * (1 - def.minMult));
}

export function fireIntervalMs(def: WeaponDef) {
  return 60000 / def.rpm;
}

/** Current spread cone half-angle in degrees. */
export function currentSpread(def: WeaponDef, ads: number, moving: number, airborne: boolean, crouched: boolean) {
  const aim = def.scope ? Math.min(1, ads / SCOPE_UP) : ads;
  let s = def.spreadHip + (def.spreadAds - def.spreadHip) * aim;
  s += def.spreadMove * Math.min(1, Math.max(0, moving)) * (1 - aim * 0.8);
  if (airborne) s += def.spreadAir;
  if (crouched) s *= 0.8;
  return s;
}

/** The revolver loads a round at a time: when each starts, as a fraction of a full reload, and how long it takes to seat. */
export const REVOLVER_ROUNDS = [0.1, 0.225, 0.35, 0.475, 0.6, 0.725];
export const REVOLVER_ROUND_SEAT = 0.09;
const ROUND_STEP = REVOLVER_ROUNDS[1] - REVOLVER_ROUNDS[0];

/** Rounds a reload puts in: what the magazine lacks, as far as the reserve goes. */
export function reloadNeed(w: WeaponId, mag: number, reserve: number) {
  return Math.max(0, Math.min(WEAPONS[w].mag - mag, reserve));
}

/** Revolver rounds a reload leaves out of its clip, the cylinder already holding them. */
export function reloadSkip(w: WeaponId, need: number) {
  return w === "pistol" ? Math.max(0, Math.min(REVOLVER_ROUNDS.length - 1, REVOLVER_ROUNDS.length - need)) : 0;
}

/** How long a reload of `need` rounds takes: the revolver only spends time on the rounds it loads. */
export function reloadMs(w: WeaponId, need: number) {
  return WEAPONS[w].reloadMs * (1 - reloadSkip(w, need) * ROUND_STEP);
}

/**
 * Where the full reload clip (0..1) is, `frac` (0..1) of the way through a reload that skips
 * `skip` revolver rounds: it plays as usual up to the first round, then jumps over the skipped ones.
 */
export function reloadClipAt(skip: number, frac: number) {
  const c = frac * (1 - skip * ROUND_STEP);
  return skip && c >= REVOLVER_ROUNDS[0] ? c + skip * ROUND_STEP : c;
}

/** When each round the revolver loads seats, as fractions of a reload of `need` rounds. */
export function roundSeats(need: number) {
  const skip = reloadSkip("pistol", need), scale = 1 - skip * ROUND_STEP;
  return REVOLVER_ROUNDS.slice(skip).map((s) => (s - skip * ROUND_STEP + REVOLVER_ROUND_SEAT) / scale);
}

/**
 * Rounds in so far, `frac` (0..1) of the way through a reload of `need`: the revolver's one by
 * one as each seats, a magazine's all at once at the end (as many as fit; callers cap it).
 */
export function reloadedRounds(w: WeaponId, need: number, frac: number) {
  if (w !== "pistol") return frac >= 1 ? WEAPONS[w].mag : 0;
  return frac >= 1 ? need : roundSeats(need).filter((at) => frac >= at).length;
}
