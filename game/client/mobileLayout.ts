"use client";

import { create } from "zustand";

export const MOBILE_LAYOUT_KEY = "hollowmere.mobile-controls.v1";
export const MOBILE_CONTROL_IDS = ["joystick", "leftFire", "rightFire", "ads", "jump", "crouch", "sprint", "grenade", "reload", "switch", "camera", "scores", "pause"] as const;
export type MobileControlId = typeof MOBILE_CONTROL_IDS[number];
export type MobileOrientation = "landscape" | "portrait";

/** x/y are normalized viewport centers; omitted values retain the responsive CSS defaults. */
export interface MobileControlPlacement { x?: number; y?: number; size?: number }
export type MobileControlMap = Partial<Record<MobileControlId, MobileControlPlacement>>;
export interface MobileLayoutData {
  controls: Record<MobileOrientation, MobileControlMap>;
  buttonScale: number;
  opacity: number;
}
export interface MobileLayoutState extends MobileLayoutData {
  dirty: boolean;
  setControl: (orientation: MobileOrientation, id: MobileControlId, patch: MobileControlPlacement) => void;
  setOpacity: (opacity: number) => void;
  setButtonScale: (scale: number) => void;
  reset: (orientation?: MobileOrientation) => void;
  /** Save explicitly after editing; false means this browser could not persist the layout. */
  save: () => boolean;
  /** Discard unsaved edits and restore the layout saved on this device. */
  restoreSaved: () => void;
}

export type MobileLayoutStorage = Pick<Storage, "getItem" | "setItem">;
const ORIENTATIONS: MobileOrientation[] = ["landscape", "portrait"];
export const CONTROL_SIZE_LIMITS = { minimum: 0.65, maximum: 1.5, joystickMinimum: 0.75, joystickMaximum: 1.4 };

export function defaultMobileLayout(): MobileLayoutData {
  return { controls: { landscape: {}, portrait: {} }, buttonScale: 1, opacity: 0.8 };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function number(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : undefined;
}

function placement(value: unknown, id: MobileControlId): MobileControlPlacement {
  const source = record(value);
  if (!source) return {};
  const result: MobileControlPlacement = {};
  const x = number(source.x, 0, 1), y = number(source.y, 0, 1);
  const size = number(source.size, id === "joystick" ? CONTROL_SIZE_LIMITS.joystickMinimum : CONTROL_SIZE_LIMITS.minimum, id === "joystick" ? CONTROL_SIZE_LIMITS.joystickMaximum : CONTROL_SIZE_LIMITS.maximum);
  if (x !== undefined) result.x = x;
  if (y !== undefined) result.y = y;
  if (size !== undefined) result.size = size;
  return result;
}

/** A versioned allowlist prevents corrupt or old storage from moving controls off screen. */
export function sanitizeMobileLayout(value: unknown): MobileLayoutData {
  const result = defaultMobileLayout();
  const source = record(value);
  if (!source || source.version !== 1) return result;
  result.opacity = number(source.opacity, 0.25, 1) ?? result.opacity;
  result.buttonScale = number(source.buttonScale, 0.65, 1.5) ?? result.buttonScale;
  const controls = record(source.controls);
  for (const orientation of ORIENTATIONS) {
    const group = record(controls?.[orientation]);
    for (const id of MOBILE_CONTROL_IDS) {
      const p = placement(group?.[id], id);
      if (Object.keys(p).length) result.controls[orientation][id] = p;
    }
  }
  return result;
}

function browserStorage(): MobileLayoutStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}

function read(storage?: MobileLayoutStorage, fallback = defaultMobileLayout()): MobileLayoutData {
  if (!storage) return fallback;
  try { return sanitizeMobileLayout(JSON.parse(storage.getItem(MOBILE_LAYOUT_KEY) ?? "null")); }
  catch { return fallback; }
}

function data(state: MobileLayoutData): MobileLayoutData {
  return sanitizeMobileLayout({ version: 1, controls: state.controls, buttonScale: state.buttonScale, opacity: state.opacity });
}

function fingerprint(state: MobileLayoutData) {
  return JSON.stringify([state.opacity, state.buttonScale, ...ORIENTATIONS.map((orientation) => MOBILE_CONTROL_IDS.map((id) => {
    const p = state.controls[orientation][id];
    return [p?.x, p?.y, p?.size];
  }))]);
}

/** Injectable storage makes reload, reset and unavailable-storage behavior testable. */
export function createMobileLayoutStore(storage = browserStorage()) {
  const initial = read(storage);
  let saved = data(initial);
  let savedFingerprint = fingerprint(saved);
  return create<MobileLayoutState>((set, get) => {
    function apply(patch: Partial<MobileLayoutData>) {
      const next = { ...get(), ...patch };
      set({ ...patch, dirty: fingerprint(next) !== savedFingerprint });
    }
    return {
      ...initial,
      dirty: false,
      setControl: (orientation, id, patch) => {
        if (!ORIENTATIONS.includes(orientation) || !MOBILE_CONTROL_IDS.includes(id)) return;
        const clean = placement(patch, id);
        if (!Object.keys(clean).length) return;
        const current = get().controls;
        apply({ controls: { ...current, [orientation]: { ...current[orientation], [id]: { ...current[orientation][id], ...clean } } } });
      },
      setOpacity: (opacity) => {
        const valid = number(opacity, 0.25, 1);
        if (valid !== undefined) apply({ opacity: valid });
      },
      setButtonScale: (scale) => {
        const valid = number(scale, 0.65, 1.5);
        if (valid !== undefined) apply({ buttonScale: valid });
      },
      reset: (orientation) => {
        if (orientation === undefined) apply(defaultMobileLayout());
        else if (ORIENTATIONS.includes(orientation)) apply({ controls: { ...get().controls, [orientation]: {} } });
      },
      save: () => {
        if (!storage) return false;
        const current = data(get());
        try {
          storage.setItem(MOBILE_LAYOUT_KEY, JSON.stringify({ version: 1, ...current }));
          saved = current;
          savedFingerprint = fingerprint(saved);
          set({ dirty: false });
          return true;
        } catch { return false; }
      },
      restoreSaved: () => {
        saved = data(read(storage, saved));
        savedFingerprint = fingerprint(saved);
        set({ ...saved, dirty: false });
      },
    };
  });
}

export const useMobileLayout = createMobileLayoutStore();
