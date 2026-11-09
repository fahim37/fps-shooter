import { describe, expect, it } from "vitest";
import { quickScope } from "./quickScope";
import type { WeaponId } from "../../shared/weapons";

const GUNS: WeaponId[] = ["ar", "smg", "shotgun", "sniper", "pistol"];
const samples = (raising: boolean, w: WeaponId) => Array.from({ length: 101 }, (_, i) => quickScope(w, i / 100, raising));

describe("quick-scope move", () => {
  it.each(GUNS)("%s rests exactly on the hip and on the sights", (w) => {
    for (const raising of [true, false]) {
      const hip = quickScope(w, 0, raising), aimed = quickScope(w, 1, raising);
      expect(hip.lift).toBeCloseTo(0, 9);
      expect(aimed.lift).toBeCloseTo(1, 9);
      for (const s of [hip, aimed]) {
        expect(Math.abs(s.roll)).toBeLessThan(1e-9);
        expect(Math.abs(s.yaw)).toBeLessThan(1e-9);
        expect(Math.abs(s.dip)).toBeLessThan(1e-9);
      }
    }
  });

  it.each(GUNS)("%s cants and snaps a little past the sights on the way up", (w) => {
    const up = samples(true, w);
    expect(Math.max(...up.map((s) => s.roll))).toBeGreaterThan(0.2);
    const peak = Math.max(...up.map((s) => s.lift));
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.1);
    // Off the hip faster than a plain ease: past halfway by a third of the raise time.
    expect(quickScope(w, 1 / 3, true).lift).toBeGreaterThan(0.5);
  });

  it.each(GUNS)("%s drops to the hip without overshooting, canting the other way", (w) => {
    const down = samples(false, w);
    for (let i = 1; i < down.length; i++) expect(down[i].lift).toBeGreaterThanOrEqual(down[i - 1].lift - 1e-12);
    expect(Math.min(...down.map((s) => s.roll))).toBeLessThan(-0.05);
  });

  it.each(GUNS)("%s rises behind a red dot nearly straight, without overshooting", (w) => {
    for (const raising of [true, false]) {
      const path = Array.from({ length: 101 }, (_, i) => quickScope(w, i / 100, raising, "red-dot"));
      expect(path[0].lift).toBeCloseTo(0, 9);
      expect(path[100].lift).toBeCloseTo(1, 9);
      for (let i = 1; i < path.length; i++) expect(path[i].lift).toBeGreaterThanOrEqual(path[i - 1].lift - 1e-12);
      expect(Math.max(...path.map((s) => Math.abs(s.roll)))).toBeLessThan(0.06);
      expect(Math.abs(path[100].roll) + Math.abs(path[100].yaw) + Math.abs(path[100].dip)).toBeLessThan(1e-9);
    }
    expect(quickScope(w, 1 / 3, true, "red-dot").lift).toBeGreaterThan(0.5);
  });
});
