import { create } from "zustand";

export type Quality = "low" | "medium" | "high" | "ultra";

export interface QualityPreset {
  dpr: number;
  minDpr: number;
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
  decorationDistance: number;
  terrainDetail: boolean;
  wind: boolean;
  textureAnisotropy: number;
}

export const PRESETS: Record<Quality, QualityPreset> = {
  low: { dpr: 0.8, minDpr: 0.55, shadows: false, shadowMapSize: 512, shadowExtent: 30, ao: false, aoHalfRes: true, bloom: false, smaa: false, foliage: 0.12, hdri: "1k", drawDistance: 140, decorationDistance: 35, terrainDetail: false, wind: false, textureAnisotropy: 2 },
  medium: { dpr: 1, minDpr: 0.65, shadows: true, shadowMapSize: 1024, shadowExtent: 34, ao: false, aoHalfRes: true, bloom: true, smaa: true, foliage: 0.45, hdri: "1k", drawDistance: 180, decorationDistance: 55, terrainDetail: true, wind: true, textureAnisotropy: 4 },
  high: { dpr: 1.25, minDpr: 0.7, shadows: true, shadowMapSize: 2048, shadowExtent: 38, ao: true, aoHalfRes: true, bloom: true, smaa: true, foliage: 1, hdri: "2k", drawDistance: 240, decorationDistance: 90, terrainDetail: true, wind: true, textureAnisotropy: 8 },
  ultra: { dpr: 2, minDpr: 1, shadows: true, shadowMapSize: 4096, shadowExtent: 44, ao: true, aoHalfRes: false, bloom: true, smaa: true, foliage: 1, hdri: "2k", drawDistance: 300, decorationDistance: 140, terrainDetail: true, wind: true, textureAnisotropy: 8 },
};

export const QUALITY_ORDER: Quality[] = ["low", "medium", "high", "ultra"];

export interface Settings {
  name: string;
  quality: Quality;
  /** Reduce rendering resolution during sustained frame drops. */
  adaptiveResolution: boolean;
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
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mem <= 4 || cores <= 4) return "low";
  return cores >= 8 && mem >= 8 ? "high" : "medium";
}

/** Only load known settings so older or damaged browser storage cannot break a match. */
export function sanitizeSettings(value: unknown): Partial<Omit<Settings, "set">> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const out: Partial<Omit<Settings, "set">> = {};
  if (typeof input.name === "string") out.name = input.name.slice(0, 20);
  if (QUALITY_ORDER.includes(input.quality as Quality)) out.quality = input.quality as Quality;
  for (const key of ["adaptiveResolution", "invertY", "thirdPerson", "showFps"] as const) {
    if (typeof input[key] === "boolean") out[key] = input[key];
  }
  const ranges = { sensitivity: [0.2, 3], adsSensitivity: [0.2, 1.5], fov: [60, 110], volume: [0, 1] } as const;
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const n = input[key];
    if (typeof n === "number" && Number.isFinite(n)) out[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], n));
  }
  return out;
}

function load(): Partial<Omit<Settings, "set">> {
  if (typeof window === "undefined") return {};
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return {};
  }
}

export const useSettings = create<Settings>((set, get) => ({
  name: "",
  quality: detectQuality(),
  adaptiveResolution: true,
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
