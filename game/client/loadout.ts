import { create } from "zustand";
import { COMPATIBLE_OPTICS, DEFAULT_OPTICS, type OpticId } from "../shared/optics";
import { MELEES, type MeleeId, type WeaponId } from "../shared/weapons";

const KEY = "hollowmere.optics.v1";
const MELEE_KEY = "hollowmere.melee.v1";
export const useLoadout = create<{
  optics: Record<WeaponId, OpticId>;
  /** The blade carried in slot 3, kept between visits. */
  melee: MeleeId;
  hydrate: () => void;
  equipOptic: (weapon: WeaponId, optic: OpticId) => void;
  chooseMelee: (melee: MeleeId) => void;
}>((set, get) => ({
  optics: { ...DEFAULT_OPTICS },
  melee: "knife",
  hydrate: () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
      const optics = { ...DEFAULT_OPTICS };
      for (const weapon of Object.keys(optics) as WeaponId[]) {
        if (COMPATIBLE_OPTICS[weapon].includes(saved?.[weapon])) optics[weapon] = saved[weapon];
      }
      const melee = localStorage.getItem(MELEE_KEY) as MeleeId | null;
      set({ optics, ...(melee && MELEES.includes(melee) ? { melee } : {}) });
    } catch { /* Keep defaults when storage is unavailable or invalid. */ }
  },
  chooseMelee: (melee) => {
    if (!MELEES.includes(melee)) return;
    set({ melee });
    try { localStorage.setItem(MELEE_KEY, melee); } catch { /* Still usable for this session. */ }
  },
  equipOptic: (weapon, optic) => {
    if (!COMPATIBLE_OPTICS[weapon].includes(optic)) return;
    const optics = { ...get().optics, [weapon]: optic };
    set({ optics });
    try { localStorage.setItem(KEY, JSON.stringify(optics)); } catch { /* Still usable for this session. */ }
  },
}));
