import { WEAPONS, type WeaponId } from "./weapons";

export type OpticId = "iron" | "red-dot" | "2x" | "4x" | "6x";
export const OPTICS: Record<OpticId, { name: string; zoom: number; description: string }> = {
  iron: { name: "Iron sights", zoom: 1, description: "Open view" },
  "red-dot": { name: "Red dot", zoom: 1, description: "Close range" },
  "2x": { name: "2× scope", zoom: 2, description: "Mid range" },
  "4x": { name: "4× scope", zoom: 4, description: "Long range" },
  "6x": { name: "6× scope", zoom: 6, description: "Sniper range" },
};
export const COMPATIBLE_OPTICS: Record<WeaponId, readonly OpticId[]> = {
  ar: ["iron", "red-dot", "2x", "4x"],
  smg: ["iron", "red-dot", "2x"],
  shotgun: ["iron", "red-dot"],
  sniper: ["2x", "4x", "6x"],
  pistol: ["iron", "red-dot"],
};
/**
 * Share of the ADS raise a red dot takes to reach the eye. It looks quick, and aiming accuracy is
 * full from that moment, while zoom and move speed keep the gun's ADS time.
 */
export const RED_DOT_ARRIVE = 0.6;
/** The same moment in eased aim (the smoothstep of the raise that `ads` is). */
export const RED_DOT_UP = RED_DOT_ARRIVE * RED_DOT_ARRIVE * (3 - 2 * RED_DOT_ARRIVE);

export const DEFAULT_OPTICS: Record<WeaponId, OpticId> = {
  ar: "red-dot", smg: "red-dot", shotgun: "iron", sniper: "6x", pistol: "iron",
};

export function opticFov(weapon: WeaponId, optic: OpticId, baseFov: number) {
  const zoom = OPTICS[optic].zoom;
  return zoom > 1 ? 2 * Math.atan(Math.tan(baseFov * Math.PI / 360) / zoom) * 180 / Math.PI
    : Math.min(baseFov, WEAPONS[weapon].adsFov + baseFov - 78);
}
