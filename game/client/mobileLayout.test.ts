import { describe, expect, it } from "vitest";
import { createMobileLayoutStore, defaultMobileLayout, MOBILE_LAYOUT_KEY, sanitizeMobileLayout, type MobileLayoutStorage } from "./mobileLayout";

function memoryStorage(value?: string): MobileLayoutStorage {
  const entries = new Map<string, string>();
  if (value !== undefined) entries.set(MOBILE_LAYOUT_KEY, value);
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, item) => { entries.set(key, item); } };
}

describe("device-local mobile control layouts", () => {
  it("preserves responsive CSS defaults until a control is edited", () => {
    const store = createMobileLayoutStore(memoryStorage());
    expect(store.getState().controls).toEqual({ landscape: {}, portrait: {} });
    expect(store.getState().dirty).toBe(false);
  });
  it("previews edits without saving, then restores positions, sizes and opacity after an explicit save and reload", () => {
    const storage = memoryStorage();
    const store = createMobileLayoutStore(storage);
    store.getState().setControl("landscape", "leftFire", { x: 0.19, y: 0.34, size: 1.2 });
    store.getState().setControl("portrait", "joystick", { x: 0.23, y: 0.75, size: 1.1 });
    store.getState().setButtonScale(1.05);
    store.getState().setOpacity(0.5);
    expect(store.getState().dirty).toBe(true);
    expect(storage.getItem(MOBILE_LAYOUT_KEY)).toBeNull();
    expect(createMobileLayoutStore(storage).getState().controls).toEqual({ landscape: {}, portrait: {} });
    expect(store.getState().save()).toBe(true);
    expect(store.getState().dirty).toBe(false);
    const reloaded = createMobileLayoutStore(storage).getState();
    expect(reloaded.controls.landscape.leftFire).toEqual({ x: 0.19, y: 0.34, size: 1.2 });
    expect(reloaded.controls.portrait.joystick).toEqual({ x: 0.23, y: 0.75, size: 1.1 });
    expect(reloaded.buttonScale).toBe(1.05);
    expect(reloaded.opacity).toBe(0.5);
  });
  it("cancels unsaved changes and treats changes back to saved values as clean", () => {
    const store = createMobileLayoutStore(memoryStorage());
    store.getState().setControl("landscape", "ads", { x: 0.7, y: 0.6 });
    store.getState().save();
    store.getState().setControl("landscape", "ads", { x: 0.2 });
    expect(store.getState().dirty).toBe(true);
    store.getState().setControl("landscape", "ads", { x: 0.7 });
    expect(store.getState().dirty).toBe(false);
    store.getState().setOpacity(0.4);
    store.getState().restoreSaved();
    expect(store.getState().controls.landscape.ads).toEqual({ x: 0.7, y: 0.6 });
    expect(store.getState().opacity).toBe(0.8);
    expect(store.getState().dirty).toBe(false);
  });
  it("resets one orientation independently and persists an all-layout reset only when saved", () => {
    const storage = memoryStorage();
    const store = createMobileLayoutStore(storage);
    store.getState().setControl("landscape", "jump", { x: 0.9, y: 0.6 });
    store.getState().setControl("portrait", "jump", { x: 0.8, y: 0.7 });
    store.getState().setOpacity(0.6);
    store.getState().save();
    store.getState().reset("landscape");
    expect(store.getState().controls.landscape).toEqual({});
    expect(store.getState().controls.portrait.jump).toEqual({ x: 0.8, y: 0.7 });
    expect(store.getState().opacity).toBe(0.6);
    expect(createMobileLayoutStore(storage).getState().controls.landscape.jump).toBeDefined();
    store.getState().reset();
    expect({ controls: store.getState().controls, buttonScale: store.getState().buttonScale, opacity: store.getState().opacity }).toEqual(defaultMobileLayout());
    store.getState().save();
    expect(createMobileLayoutStore(storage).getState().controls).toEqual({ landscape: {}, portrait: {} });
  });
  it("sanitizes bounds, unknown controls and bad schema versions", () => {
    const valid = sanitizeMobileLayout({ version: 1, buttonScale: -1, opacity: 10, controls: { landscape: { leftFire: { x: -4, y: 8, size: 9, action: "bad" }, joystick: { size: 0.1 }, unknown: { x: 0.5, y: 0.5 }, jump: { x: NaN, y: "0.5", size: Infinity } }, portrait: { pause: { size: 1.2 } } } });
    expect(valid.controls.landscape).toEqual({ leftFire: { x: 0, y: 1, size: 1.5 }, joystick: { size: 0.75 } });
    expect(valid.controls.portrait.pause).toEqual({ size: 1.2 });
    expect(valid.opacity).toBe(1);
    expect(valid.buttonScale).toBe(0.65);
    for (const value of [null, [], {}, { version: 2, controls: { landscape: { leftFire: { x: 0.3 } } } }]) expect(sanitizeMobileLayout(value)).toEqual(defaultMobileLayout());
    expect(createMobileLayoutStore(memoryStorage("{bad json")).getState().controls).toEqual({ landscape: {}, portrait: {} });
  });
  it("keeps unsaved edits recoverable when device storage is unavailable", () => {
    const storage: MobileLayoutStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const store = createMobileLayoutStore(storage);
    store.getState().setOpacity(0.4);
    expect(store.getState().save()).toBe(false);
    expect(store.getState().opacity).toBe(0.4);
    expect(store.getState().dirty).toBe(true);
    store.getState().restoreSaved();
    expect(store.getState().opacity).toBe(0.8);
    expect(store.getState().dirty).toBe(false);
  });
});
