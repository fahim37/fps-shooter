import { create } from "zustand";
import { COMPATIBLE_OPTICS, DEFAULT_OPTICS, type OpticId } from "../shared/optics";
import type { WeaponId } from "../shared/weapons";

const KEY = "hollowmere.optics.v1";
export const useLoadout = create<{
  optics: Record<WeaponId, OpticId>;
  hydrate: () => void;
  equipOptic: (weapon: WeaponId, optic: OpticId) => void;
}>((set, get) => ({
  optics: { ...DEFAULT_OPTICS },
  hydrate: () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
      const optics = { ...DEFAULT_OPTICS };
      for (const weapon of Object.keys(optics) as WeaponId[]) {
        if (COMPATIBLE_OPTICS[weapon].includes(saved?.[weapon])) optics[weapon] = saved[weapon];
      }
      set({ optics });
    } catch { /* Keep defaults when storage is unavailable or invalid. */ }
  },
  equipOptic: (weapon, optic) => {
    if (!COMPATIBLE_OPTICS[weapon].includes(optic)) return;
    const optics = { ...get().optics, [weapon]: optic };
    set({ optics });
    try { localStorage.setItem(KEY, JSON.stringify(optics)); } catch { /* Still usable for this session. */ }
  },
}));
