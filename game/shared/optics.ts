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
export const DEFAULT_OPTICS: Record<WeaponId, OpticId> = {
  ar: "red-dot", smg: "red-dot", shotgun: "iron", sniper: "6x", pistol: "iron",
};

export function opticFov(weapon: WeaponId, optic: OpticId, baseFov: number) {
  const zoom = OPTICS[optic].zoom;
  return zoom > 1 ? 2 * Math.atan(Math.tan(baseFov * Math.PI / 360) / zoom) * 180 / Math.PI
    : Math.min(baseFov, WEAPONS[weapon].adsFov + baseFov - 78);
}
