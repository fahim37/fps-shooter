import { describe, expect, it } from "vitest";
import { ShotCadence } from "./cadence";
import { fireIntervalMs, WEAPONS } from "../../shared/weapons";

describe("automatic fire across frame rates", () => {
  it.each([30, 60, 144])("keeps SMG cadence close to its advertised rate at %i FPS", (fps) => {
    const cadence = new ShotCadence();
    const interval = fireIntervalMs(WEAPONS.smg);
    const times: number[] = [];
    for (let frame = 0; frame < fps * 10; frame++) {
      const now = frame * 1000 / fps;
      if (cadence.ready(now, interval)) { cadence.record(now, interval, true); times.push(now); }
    }
    expect(times.length).toBeGreaterThanOrEqual(140);
    expect(times.length).toBeLessThanOrEqual(147);
    expect(times.slice(1).every((time, i) => time - times[i] >= interval * 0.75 - 1e-8)).toBe(true);
  });

  it("does not turn a long frame stall into a burst of catch-up shots", () => {
    const cadence = new ShotCadence();
    cadence.record(1000, 100, true);
    expect(cadence.ready(6000, 100)).toBe(true);
    cadence.record(6000, 100, true);
    expect(cadence.ready(6001, 100)).toBe(false);
    expect(cadence.ready(6100, 100)).toBe(true);
  });

  it("keeps semi-automatic shots spaced by their full interval", () => {
    const cadence = new ShotCadence();
    cadence.record(1000, 200, false);
    expect(cadence.ready(1199, 200)).toBe(false);
    expect(cadence.ready(1200, 200)).toBe(true);
  });
});
