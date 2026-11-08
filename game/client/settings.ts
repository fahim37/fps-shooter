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
  low: { dpr: 0.8, minDpr: 0.65, shadows: false, shadowMapSize: 512, shadowExtent: 30, ao: false, aoHalfRes: true, bloom: false, smaa: false, foliage: 0, hdri: "1k", drawDistance: 180, decorationDistance: 35, terrainDetail: false, wind: false, textureAnisotropy: 2 },
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
  /** Reduce glare and edge darkening for easier target tracking. */
  clearView: boolean;
  sensitivity: number;
  adsSensitivity: number;
  fov: number;
  volume: number;
  /** Menu theme level, on top of the master volume (match sound is unaffected). */
  musicVolume: number;
  invertY: boolean;
  thirdPerson: boolean;
  /** Q/E peek latches on a tap instead of only while held. */
  leanToggle: boolean;
  /** FPS meter in the top-right corner of a match. */
  fpsMeter: boolean;
  set: (patch: Partial<Omit<Settings, "set">>) => void;
}

const KEY = "hollowmere.settings.v1";

/**
 * Bumped when the default graphics quality changes: a stored quality saved under an older
 * default (often just the old auto-detected value) is dropped once, so every player starts on
 * the new default and can raise it from there.
 */
const QUALITY_DEFAULTS = 2;

/**
 * Bumped when the default for toggle peek changes: every save holds the old default, so a stored
 * value from an older version is dropped once. Anything saved after that is the player's choice.
 */
const LEAN_DEFAULTS = 1;

/**
 * Look sensitivity. Aim turns 0.0022 rad per mouse count times this, so on the 1000 DPI office mice
 * most players have, 0.5 is about 14 cm of mouse travel per full turn and 1.0 only 7 cm: the range
 * leans low, with fine 0.05 steps.
 */
export const SENSITIVITY_RANGE = { min: 0.05, max: 2, step: 0.05 } as const;

/** Only load known settings so older or damaged browser storage cannot break a match. */
export function sanitizeSettings(value: unknown): Partial<Omit<Settings, "set">> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const out: Partial<Omit<Settings, "set">> = {};
  if (typeof input.name === "string") out.name = input.name.slice(0, 20);
  if (input.qualityDefaults === QUALITY_DEFAULTS && QUALITY_ORDER.includes(input.quality as Quality)) out.quality = input.quality as Quality;
  for (const key of ["adaptiveResolution", "clearView", "invertY", "thirdPerson", "fpsMeter"] as const) {
    if (typeof input[key] === "boolean") out[key] = input[key];
  }
  if (input.leanDefaults === LEAN_DEFAULTS && typeof input.leanToggle === "boolean") out.leanToggle = input.leanToggle;
  const ranges = { sensitivity: [SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max], adsSensitivity: [0.2, 1.5], fov: [60, 110], volume: [0, 1], musicVolume: [0, 1] } as const;
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

/** Out-of-the-box aim, view and sound; the lobby quick settings mark these and can reset to them. */
export const TUNING_DEFAULTS = { sensitivity: 0.5, adsSensitivity: 0.8, fov: 78, volume: 0.8, musicVolume: 1 };

export const useSettings = create<Settings>((set, get) => ({
  name: "",
  // Low on every device: most players are on office PCs and integrated graphics.
  quality: "low",
  adaptiveResolution: true,
  clearView: true,
  ...TUNING_DEFAULTS,
  invertY: false,
  thirdPerson: false,
  leanToggle: true,
  fpsMeter: true,
  ...load(),
  set: (patch) => {
    set(patch);
    try {
      const { set: _omit, ...rest } = get();
      void _omit;
      localStorage.setItem(KEY, JSON.stringify({ ...rest, qualityDefaults: QUALITY_DEFAULTS, leanDefaults: LEAN_DEFAULTS }));
    } catch {
      /* storage unavailable (private mode): settings just won't persist */
    }
  },
}));

export const preset = () => PRESETS[useSettings.getState().quality];
