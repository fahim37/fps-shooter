import { describe, expect, it } from "vitest";
import { REVOLVER_ROUNDS, REVOLVER_ROUND_SEAT, WEAPONS, reloadClipAt, reloadMs, reloadNeed, reloadSkip, reloadedRounds, roundSeats } from "./weapons";

describe("reload", () => {
  it("gives the revolver one loading step per chamber", () => {
    expect(REVOLVER_ROUNDS.length).toBe(WEAPONS.pistol.mag);
  });

  it("puts the revolver's rounds in one at a time, each as it seats", () => {
    const seats = roundSeats(6);
    expect(seats[0]).toBeCloseTo(REVOLVER_ROUNDS[0] + REVOLVER_ROUND_SEAT);
    expect(reloadedRounds("pistol", 6, 0)).toBe(0);
    seats.forEach((at, i) => {
      expect(reloadedRounds("pistol", 6, at - 0.001)).toBe(i);
      expect(reloadedRounds("pistol", 6, at)).toBe(i + 1);
    });
    expect(reloadedRounds("pistol", 6, 1)).toBe(6);
  });

  it("only spends time on the rounds a revolver top-up needs", () => {
    expect(reloadMs("pistol", 6)).toBe(WEAPONS.pistol.reloadMs);
    expect(reloadMs("pistol", 2)).toBeLessThan(reloadMs("pistol", 3));
    for (let need = 1; need <= 6; need++) {
      const seats = roundSeats(need);
      expect(seats).toHaveLength(need);
      // Each round seats on the same beat of the animation as in a full reload.
      const skip = reloadSkip("pistol", need);
      seats.forEach((at, i) => expect(reloadClipAt(skip, at)).toBeCloseTo(REVOLVER_ROUNDS[skip + i] + REVOLVER_ROUND_SEAT));
      expect(reloadClipAt(skip, 1)).toBeCloseTo(1);
      expect(reloadedRounds("pistol", need, 1)).toBe(need);
    }
  });

  it("plays the animation without a jump where skipped rounds are left out", () => {
    const skip = reloadSkip("pistol", 2);
    expect(reloadClipAt(skip, 0.05)).toBeCloseTo(0.05 * (1 - skip * 0.125));
    expect(reloadClipAt(skip, 0.999)).toBeGreaterThan(0.99);
  });

  it("fills a magazine all at once at the end", () => {
    expect(reloadedRounds("ar", 20, 0.99)).toBe(0);
    expect(reloadedRounds("ar", 20, 1)).toBeGreaterThanOrEqual(20);
    expect(reloadMs("ar", 3)).toBe(WEAPONS.ar.reloadMs);
  });

  it("takes only what the reserve holds", () => {
    expect(reloadNeed("pistol", 2, 30)).toBe(4);
    expect(reloadNeed("pistol", 0, 3)).toBe(3);
    expect(reloadNeed("ar", 35, 10)).toBe(0);
  });
});
