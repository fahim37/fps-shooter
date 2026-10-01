import { describe, expect, it } from "vitest";
import { spreadDir, spreadRadius, zoomSensitivity } from "./aim";
import { currentSpread, WEAPONS } from "./weapons";

describe("aim presentation and handling", () => {
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
