import { describe, expect, it } from "vitest";
import { spreadDir, spreadRadius, zoomSensitivity } from "./aim";
import { SCOPE_UP, currentSpread, WEAPONS } from "./weapons";
import { RED_DOT_UP } from "./optics";

describe("aim presentation and handling", () => {
  it("lets a sniper quick-scope: dead on once the scope is up, wild before it", () => {
    const { sniper } = WEAPONS;
    expect(currentSpread(sniper, SCOPE_UP, 0, false, false)).toBeCloseTo(sniper.spreadAds);
    expect(currentSpread(sniper, SCOPE_UP / 2, 0, false, false)).toBeGreaterThan(3);
    expect(currentSpread(WEAPONS.ar, SCOPE_UP, 0, false, false)).toBeGreaterThan(WEAPONS.ar.spreadAds);
  });

  it("is fully accurate through a magnified scope on any gun once the scope view is up", () => {
    for (const def of [WEAPONS.ar, WEAPONS.smg]) {
      expect(currentSpread(def, SCOPE_UP, 1, false, false, SCOPE_UP)).toBeCloseTo(currentSpread(def, 1, 1, false, false));
    }
  });

  it("is fully accurate behind a red dot once it reaches the eye, moving or not", () => {
    for (const moving of [0, 1]) {
      const full = currentSpread(WEAPONS.ar, 1, moving, false, false);
      expect(currentSpread(WEAPONS.ar, RED_DOT_UP, moving, false, false, RED_DOT_UP)).toBeCloseTo(full);
      expect(currentSpread(WEAPONS.ar, RED_DOT_UP, moving, false, false)).toBeGreaterThan(full);
      expect(currentSpread(WEAPONS.ar, RED_DOT_UP / 2, moving, false, false, RED_DOT_UP)).toBeGreaterThan(full);
    }
  });

  it("preserves hip sensitivity and smoothly scales through the ADS midpoint", () => {
    expect(zoomSensitivity(78, 78, 0, 0.8)).toBe(1);
    const before = zoomSensitivity(78, 66, 0.499, 0.8);
    const after = zoomSensitivity(78, 66, 0.501, 0.8);
    expect(Math.abs(before - after)).toBeLessThan(0.001);
    expect(zoomSensitivity(78, 18, 1, 0.8)).toBeCloseTo(0.1565, 3);
  });

  it("projects the spread cone consistently with screen resolution and zoom", () => {
    const radius = spreadRadius(2, 78, 900);
    expect(spreadRadius(2, 78, 1800)).toBeCloseTo(radius * 2);
    expect(spreadRadius(2, 55, 900)).toBeGreaterThan(radius);
    expect(spreadRadius(0, 78, 900)).toBe(0);
  });

  it("keeps ADS tighter while retaining jumping and movement penalties", () => {
    for (const def of Object.values(WEAPONS)) {
      const aimed = currentSpread(def, 1, 0, false, false);
      expect(aimed).toBeLessThan(currentSpread(def, 0, 0, false, false));
      expect(currentSpread(def, 1, 1, false, false)).toBeGreaterThan(aimed);
      expect(currentSpread(def, 1, 0, true, false)).toBeGreaterThan(aimed);
      expect(currentSpread(def, 1, 0, false, true)).toBeCloseTo(aimed * 0.8);
    }
  });

  it("caps movement bloom when sprint speeds exceed the reference speed", () => {
    expect(currentSpread(WEAPONS.ar, 0, 3, false, false)).toBe(currentSpread(WEAPONS.ar, 0, 1, false, false));
  });

  it("keeps sampled shot directions normalized and within the displayed cone", () => {
    const cone = currentSpread(WEAPONS.ar, 1, 0, false, false);
    for (const random of [0, 0.2, 0.5, 0.9, 1]) {
      const dir = spreadDir([0, 0, -1], cone, () => random);
      expect(Math.hypot(...dir)).toBeCloseTo(1, 10);
      expect(Math.acos(-dir[2]) * 180 / Math.PI).toBeLessThanOrEqual(cone + 1e-8);
    }
  });
});
