import { describe, expect, it } from "vitest";
import { COMPATIBLE_OPTICS, DEFAULT_OPTICS, OPTICS, opticFov } from "./optics";
import type { WeaponId } from "./weapons";

describe("weapon optics", () => {
  it("uses compatible defaults and limits high zoom to suitable guns", () => {
    for (const weapon of Object.keys(DEFAULT_OPTICS) as WeaponId[]) {
      expect(COMPATIBLE_OPTICS[weapon]).toContain(DEFAULT_OPTICS[weapon]);
    }
    expect(COMPATIBLE_OPTICS.pistol).not.toContain("4x");
    expect(COMPATIBLE_OPTICS.shotgun).not.toContain("6x");
  });
  it("matches advertised magnification at different player FOV settings", () => {
    for (const base of [65, 78, 100]) {
      for (const optic of ["2x", "4x", "6x"] as const) {
        const fov = opticFov("sniper", optic, base);
        expect(Math.tan(base * Math.PI / 360) / Math.tan(fov * Math.PI / 360)).toBeCloseTo(OPTICS[optic].zoom, 8);
      }
    }
    expect(opticFov("ar", "red-dot", 78)).toBe(55);
  });
});
