import { describe, expect, it } from "vitest";
import { screenSpot } from "./spots";

describe("placing a mark on screen", () => {
  it("sits on an enemy in view", () => {
    expect(screenSpot(0, 0, false)).toEqual({ x: 50, y: 50, edge: false, angle: 0 });
    const high = screenSpot(0.5, 0.5, false);
    expect(high.x).toBe(75);
    expect(high.y).toBe(25);
  });

  it("goes to the edge of the screen toward an enemy out of view", () => {
    const right = screenSpot(3, 0, false);
    expect(right.edge).toBe(true);
    expect(right.x).toBeCloseTo(95);
    expect(right.y).toBeCloseTo(50);
    expect(right.angle).toBeCloseTo(90);
  });

  it("mirrors an enemy behind the camera, and always puts them on the edge", () => {
    // Projected up and right while behind: they are really down and to the left.
    const behind = screenSpot(0.2, 0.1, true);
    expect(behind.edge).toBe(true);
    expect(behind.x).toBeLessThan(50);
    expect(behind.y).toBeGreaterThan(50);
    expect(Number.isFinite(screenSpot(0, 0, true).y)).toBe(true);
  });
});
