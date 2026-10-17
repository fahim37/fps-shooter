import { describe, expect, it } from "vitest";
import { MODE_INFO, SCORE_LIMITS, matchMinutes, scoreLimitFor } from "./constants";

describe("room score limits", () => {
  it("accepts only the offered targets and falls back to the mode default", () => {
    expect(scoreLimitFor("tdm", 150)).toBe(150);
    expect(scoreLimitFor("tdm", 100)).toBe(100);
    expect(scoreLimitFor("ffa", 75)).toBe(75);
    for (const bad of [undefined, 0, 99, 151, 1e6, "150", null]) expect(scoreLimitFor("tdm", bad)).toBe(MODE_INFO.tdm.scoreLimit);
    expect(scoreLimitFor("ffa", 150)).toBe(MODE_INFO.ffa.scoreLimit);
    for (const mode of ["tdm", "ffa"] as const) expect(SCORE_LIMITS[mode]).toContain(MODE_INFO[mode].scoreLimit);
  });
  it("keeps the default clock and lengthens it for higher targets", () => {
    expect(matchMinutes("tdm", 30)).toBe(10);
    expect(matchMinutes("tdm", 60)).toBe(10);
    expect(matchMinutes("tdm", 100)).toBe(20);
    expect(matchMinutes("tdm", 150)).toBe(25);
    expect(matchMinutes("ffa", 30)).toBe(10);
    expect(matchMinutes("ffa", 75)).toBe(25);
  });
});
