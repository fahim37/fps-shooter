export type GunId = "ar" | "smg" | "shotgun" | "sniper" | "pistol";
/** Blades, in slot 3: always carried, chosen in the loadout. */
export type MeleeId = "knife" | "katana";
export type WeaponId = GunId | MeleeId;
export const PRIMARIES: WeaponId[] = ["ar", "smg", "shotgun", "sniper"];
export const MELEES: MeleeId[] = ["knife", "katana"];

/**
 * How a blade strikes. A swing is resolved on the server the moment it starts: a fan of rays from
 * the eye out to `range`, across `arc` either side of the aim, against the rewound hitboxes. The
 * nearest body in the fan takes it.
 */
export interface MeleeDef {
  /** Reach from the eye (m). */
  range: number;
  /** Half-width of the sweep either side of the aim (deg), and half its height. */
  arc: number;
  /** Damage when it lands from behind (attacker behind the target and facing the way it faces). */
  backstab: number;
  heavy: { damage: number; intervalMs: number };
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** 0 primary, 1 sidearm, 2 blade. */
  slot: 0 | 1 | 2;
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
  /**
   * Share of each kick that stays in the view instead of springing back. High on automatics: held
   * down, the aim walks up and the player pulls the mouse down against it.
   */
  recoilClimb: number;
  adsFov: number;
  adsMs: number;
  moveMult: number;
  /** A sniper's optic: fully accurate from the moment the scope is up (see SCOPE_UP), for quick-scoping. */
  scope?: boolean;
  /** A blade: no ammunition, no aiming; `rpm` is swings per minute, `moveMult` above 1 is the run you get for carrying it. */
  melee?: MeleeDef;
}

/** How far into aiming (0..1) a magnified scope is up. */
export const SCOPE_UP = 0.7;

const W = (d: WeaponDef) => d;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ar: W({
    id: "ar", name: "Panther", slot: 0, auto: true, rpm: 600, damage: 26, headMult: 2.6, limbMult: 0.85, pellets: 1,
    falloffStart: 30, falloffEnd: 65, minMult: 0.72, range: 200, mag: 35, reserve: 120, reloadMs: 1900, equipMs: 450,
    spreadHip: 1.7, spreadAds: 0.12, spreadMove: 1.1, spreadAir: 5, recoilUp: 0.5, recoilSide: 0.12, recoilClimb: 0.85,
    adsFov: 55, adsMs: 220, moveMult: 0.95,
  }),
  smg: W({
    id: "smg", name: "Honey Badger", slot: 0, auto: true, rpm: 880, damage: 19, headMult: 2.4, limbMult: 0.9, pellets: 1,
    falloffStart: 14, falloffEnd: 35, minMult: 0.6, range: 150, mag: 40, reserve: 160, reloadMs: 1650, equipMs: 350,
    spreadHip: 1.6, spreadAds: 0.22, spreadMove: 0.9, spreadAir: 3.5, recoilUp: 0.3, recoilSide: 0.15, recoilClimb: 0.85,
    adsFov: 62, adsMs: 170, moveMult: 1.05,
  }),
  shotgun: W({
    id: "shotgun", name: "Grizzly", slot: 0, auto: false, rpm: 150, damage: 15, headMult: 1.4, limbMult: 0.9, pellets: 9,
    falloffStart: 9, falloffEnd: 22, minMult: 0.25, range: 60, mag: 6, reserve: 30, reloadMs: 2250, equipMs: 450,
    spreadHip: 5.5, spreadAds: 4.2, spreadMove: 1, spreadAir: 2, recoilUp: 2.2, recoilSide: 0.35, recoilClimb: 0.5,
    adsFov: 65, adsMs: 200, moveMult: 0.97,
  }),
  sniper: W({
    id: "sniper", name: "Nighthawk", slot: 0, auto: false, rpm: 90, damage: 100, headMult: 2, limbMult: 0.8, pellets: 1,
    falloffStart: 80, falloffEnd: 200, minMult: 1, range: 300, mag: 5, reserve: 25, reloadMs: 2500, equipMs: 600,
    spreadHip: 7, spreadAds: 0.02, spreadMove: 3, spreadAir: 9, recoilUp: 3.2, recoilSide: 0.2, recoilClimb: 0.5,
    adsFov: 18, adsMs: 170, moveMult: 0.9, scope: true,
  }),
  pistol: W({
    id: "pistol", name: "Rattler", slot: 1, auto: false, rpm: 190, damage: 44, headMult: 4.55, limbMult: 0.9, pellets: 1,
    falloffStart: 18, falloffEnd: 40, minMult: 0.6, range: 120, mag: 6, reserve: 36, reloadMs: 2600, equipMs: 250,
    spreadHip: 0.18, spreadAds: 0.16, spreadMove: 0.2, spreadAir: 3, recoilUp: 1.5, recoilSide: 0.2, recoilClimb: 0.5,
    adsFov: 66, adsMs: 150, moveMult: 1.05,
  }),
  // Blades: no magazine (mag 0 never reloads), no spread or recoil. Two hits kill through a full
  // shield (120); from behind, one. Carrying one is the fastest way round the map.
  knife: W({
    id: "knife", name: "Butterfly Knife", slot: 2, auto: true, rpm: 150, damage: 60, headMult: 1, limbMult: 1, pellets: 1,
    falloffStart: 0, falloffEnd: 1, minMult: 1, range: 2.2, mag: 0, reserve: 0, reloadMs: 0, equipMs: 300,
    spreadHip: 0, spreadAds: 0, spreadMove: 0, spreadAir: 0, recoilUp: 0, recoilSide: 0, recoilClimb: 0,
    adsFov: 78, adsMs: 150, moveMult: 1.15, melee: { range: 2.2, arc: 22, backstab: 150, heavy: { damage: 85, intervalMs: 750 } },
  }),
  katana: W({
    id: "katana", name: "Katana", slot: 2, auto: true, rpm: 90, damage: 75, headMult: 1, limbMult: 1, pellets: 1,
    falloffStart: 0, falloffEnd: 1, minMult: 1, range: 2.9, mag: 0, reserve: 0, reloadMs: 0, equipMs: 450,
    spreadHip: 0, spreadAds: 0, spreadMove: 0, spreadAir: 0, recoilUp: 0, recoilSide: 0, recoilClimb: 0,
    adsFov: 78, adsMs: 150, moveMult: 1.1, melee: { range: 2.9, arc: 34, backstab: 150, heavy: { damage: 100, intervalMs: 1000 } },
  }),
};

export function isMelee(w: string): w is MeleeId {
  return !!WEAPONS[w as WeaponId]?.melee;
}

/** The fastest any weapon lets its carrier run (the server's movement check allows for it). */
export const FASTEST_MOVE = Math.max(...Object.values(WEAPONS).map((w) => w.moveMult));

/** Whether a blow from `attacker` (its look yaw) lands on `target`'s back: behind it and facing roughly the way it faces. */
export function isBackstab(attacker: { x: number; z: number; yaw: number }, target: { x: number; z: number; yaw: number }) {
  // Yaw 0 faces -Z.
  const tf = [-Math.sin(target.yaw), -Math.cos(target.yaw)];
  const af = [-Math.sin(attacker.yaw), -Math.cos(attacker.yaw)];
  const dx = attacker.x - target.x, dz = attacker.z - target.z;
  const behind = dx * tf[0] + dz * tf[1] < 0;
  const alike = af[0] * tf[0] + af[1] * tf[1] > Math.cos((65 * Math.PI) / 180);
  return behind && alike;
}

export const GRENADE = {
  fuseMs: 4000,
  throwSpeed: 21,
  /** An underhand lob (right mouse while aiming) leaves the hand at this fraction of a full throw. */
  lobPower: 0.5,
  radius: 8,
  /** At the blast; lethal through a full shield out to about 3 m, around 45 damage at 6 m. */
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

/**
 * Current spread cone half-angle in degrees. `sightUp` is how far into aiming the sight is up and
 * fully accurate: a red dot comes up early (RED_DOT_UP), a magnified scope once its view is up (SCOPE_UP).
 * A sniper's scope always uses SCOPE_UP.
 */
export function currentSpread(def: WeaponDef, ads: number, moving: number, airborne: boolean, crouched: boolean, sightUp = 1) {
  const aim = Math.min(1, ads / (def.scope ? SCOPE_UP : sightUp));
  let s = def.spreadHip + (def.spreadAds - def.spreadHip) * aim;
  // A sniper's scope, once up, shoots where the crosshair is even on the move.
  s += def.spreadMove * Math.min(1, Math.max(0, moving)) * (def.scope && aim >= 1 ? 0 : 1 - aim * 0.8);
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
