import { create } from "zustand";

export type Quality = "low" | "medium" | "high" | "ultra";

export interface QualityPreset {
  dpr: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowExtent: number;
  ao: boolean;
  aoHalfRes: boolean;
  bloom: boolean;
  smaa: boolean;
  /** Fraction of decorative grass/flowers drawn. */
  foliage: number;
  hdri: "1k" | "2k";
  drawDistance: number;
}

export const PRESETS: Record<Quality, QualityPreset> = {
  low: { dpr: 0.8, shadows: false, shadowMapSize: 1024, shadowExtent: 30, ao: false, aoHalfRes: true, bloom: false, smaa: false, foliage: 0.25, hdri: "1k", drawDistance: 140 },
  medium: { dpr: 1, shadows: true, shadowMapSize: 2048, shadowExtent: 34, ao: false, aoHalfRes: true, bloom: true, smaa: true, foliage: 0.55, hdri: "1k", drawDistance: 180 },
  high: { dpr: 1.25, shadows: true, shadowMapSize: 2048, shadowExtent: 38, ao: true, aoHalfRes: true, bloom: true, smaa: true, foliage: 1, hdri: "2k", drawDistance: 240 },
  ultra: { dpr: 2, shadows: true, shadowMapSize: 4096, shadowExtent: 44, ao: true, aoHalfRes: false, bloom: true, smaa: true, foliage: 1, hdri: "2k", drawDistance: 300 },
};

export interface Settings {
  name: string;
  quality: Quality;
  sensitivity: number;
  adsSensitivity: number;
  fov: number;
  volume: number;
  invertY: boolean;
  thirdPerson: boolean;
  showFps: boolean;
  set: (patch: Partial<Omit<Settings, "set">>) => void;
}

const KEY = "hollowmere.settings.v1";

function detectQuality(): Quality {
  if (typeof window === "undefined") return "high";
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch) return "low";
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (mem <= 4 || navigator.hardwareConcurrency <= 4) return "medium";
  return "high";
}

function load(): Partial<Settings> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export const useSettings = create<Settings>((set, get) => ({
  name: "",
  quality: detectQuality(),
  sensitivity: 1,
  adsSensitivity: 0.8,
  fov: 78,
  volume: 0.8,
  invertY: false,
  thirdPerson: false,
  showFps: false,
  ...load(),
  set: (patch) => {
    set(patch);
    try {
      const { set: _omit, ...rest } = get();
      void _omit;
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {
      /* storage unavailable (private mode): settings just won't persist */
    }
  },
}));

export const preset = () => PRESETS[useSettings.getState().quality];
