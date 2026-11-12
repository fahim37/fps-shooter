import { describe, expect, it } from "vitest";
import { Recoil, RECOIL } from "./recoil";
import { WEAPONS, fireIntervalMs, type WeaponId } from "../../shared/weapons";

const steady = () => 0.5;

/** Runs `seconds` of frames, returning the furthest back the gun got. */
function run(recoil: Recoil, seconds: number, fps: number, each?: (t: number) => void) {
  let peak = 0;
  const frames = Math.round(seconds * fps);
  for (let frame = 0; frame < frames; frame++) {
    each?.(frame / fps);
    recoil.update(1 / fps);
    peak = Math.max(peak, recoil.back);
  }
  return peak;
}

describe("recoil", () => {
  it.each(Object.keys(RECOIL) as WeaponId[])("kicks the %s back about as far as its profile says, then settles", (weapon) => {
    const recoil = new Recoil();
    recoil.kick(weapon, steady);
    const peak = run(recoil, 1.5, 240);
    expect(peak).toBeGreaterThan(RECOIL[weapon].back * 0.85);
    expect(peak).toBeLessThan(RECOIL[weapon].back * 1.15);
    for (const v of [recoil.back, recoil.up, recoil.pitch, recoil.yaw, recoil.roll, recoil.trigger]) expect(Math.abs(v)).toBeLessThan(1e-4);
  });

  it("moves the same at 20 fps as at 240", () => {
    const sample = (fps: number) => {
      const recoil = new Recoil();
      recoil.kick("shotgun", steady);
      run(recoil, 0.1, fps);
      return recoil.back;
    };
    expect(sample(20)).toBeCloseTo(sample(240), 4);
  });

  it("stays bounded through a long automatic burst at a poor frame rate", () => {
    for (const weapon of ["ar", "smg"] as const) {
      const recoil = new Recoil();
      const interval = fireIntervalMs(WEAPONS[weapon]) / 1000;
      let next = 0, lowest = Infinity, sum = 0, frames = 0;
      const peak = run(recoil, 4, 25, (t) => {
        while (t >= next) { recoil.kick(weapon); next += interval; }
        if (t > 1) { lowest = Math.min(lowest, recoil.back); sum += recoil.back; frames++; }
      });
      expect(peak).toBeLessThan(RECOIL[weapon].back * 3);
      // Held down, the gun sits shoved back and never springs forward of where it is held.
      expect(sum / frames).toBeGreaterThan(RECOIL[weapon].back * 0.25);
      expect(lowest).toBeGreaterThan(-RECOIL[weapon].back * 0.1);
      expect(Math.abs(recoil.roll)).toBeLessThan(0.2);
    }
  });
});
