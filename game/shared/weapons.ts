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
  scope?: boolean;
}

const W = (d: WeaponDef) => d;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ar: W({
    id: "ar", name: "AK Rifle", slot: 0, auto: true, rpm: 600, damage: 26, headMult: 1.8, limbMult: 0.85, pellets: 1,
    falloffStart: 30, falloffEnd: 65, minMult: 0.72, range: 200, mag: 30, reserve: 120, reloadMs: 2200, equipMs: 450,
    spreadHip: 1.7, spreadAds: 0.12, spreadMove: 1.1, spreadAir: 5, recoilUp: 0.4, recoilSide: 0.12,
    adsFov: 55, adsMs: 220, moveMult: 0.95,
  }),
  smg: W({
    id: "smg", name: "Vector SMG", slot: 0, auto: true, rpm: 880, damage: 19, headMult: 1.6, limbMult: 0.9, pellets: 1,
    falloffStart: 14, falloffEnd: 35, minMult: 0.6, range: 150, mag: 32, reserve: 160, reloadMs: 1900, equipMs: 350,
    spreadHip: 1.6, spreadAds: 0.22, spreadMove: 0.9, spreadAir: 3.5, recoilUp: 0.26, recoilSide: 0.15,
    adsFov: 62, adsMs: 170, moveMult: 1.05,
  }),
  shotgun: W({
    id: "shotgun", name: "Pump Shotgun", slot: 0, auto: false, rpm: 72, damage: 13, headMult: 1.4, limbMult: 0.9, pellets: 9,
    falloffStart: 7, falloffEnd: 22, minMult: 0.25, range: 60, mag: 6, reserve: 30, reloadMs: 2600, equipMs: 450,
    spreadHip: 5.5, spreadAds: 4.2, spreadMove: 1, spreadAir: 2, recoilUp: 2.2, recoilSide: 0.35,
    adsFov: 65, adsMs: 200, moveMult: 0.97,
  }),
  sniper: W({
    id: "sniper", name: "Hunter Sniper", slot: 0, auto: false, rpm: 44, damage: 92, headMult: 2.5, limbMult: 0.8, pellets: 1,
    falloffStart: 80, falloffEnd: 200, minMult: 0.9, range: 300, mag: 5, reserve: 25, reloadMs: 2900, equipMs: 600,
    spreadHip: 7, spreadAds: 0.02, spreadMove: 5, spreadAir: 9, recoilUp: 2.4, recoilSide: 0.2,
    adsFov: 18, adsMs: 320, moveMult: 0.9, scope: true,
  }),
  pistol: W({
    id: "pistol", name: "Sidearm", slot: 1, auto: false, rpm: 380, damage: 30, headMult: 1.8, limbMult: 0.9, pellets: 1,
    falloffStart: 18, falloffEnd: 40, minMult: 0.6, range: 120, mag: 12, reserve: 60, reloadMs: 1450, equipMs: 250,
    spreadHip: 1.1, spreadAds: 0.16, spreadMove: 0.8, spreadAir: 3, recoilUp: 0.75, recoilSide: 0.14,
    adsFov: 66, adsMs: 150, moveMult: 1.05,
  }),
};

export const GRENADE = {
  fuseMs: 3200,
  throwSpeed: 17,
  radius: 7,
  damage: 115,
  /** Minimum damage at the edge of the radius, as a fraction. */
  edgeMult: 0.15,
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
  let s = def.spreadHip + (def.spreadAds - def.spreadHip) * ads;
  s += def.spreadMove * Math.min(1, Math.max(0, moving)) * (1 - ads * 0.8);
  if (airborne) s += def.spreadAir;
  if (crouched) s *= 0.8;
  return s;
}
