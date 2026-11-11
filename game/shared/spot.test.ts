import { describe, expect, it } from "vitest";
import { pickSpot, SPOT_RANGE } from "./spot";

type V3 = [number, number, number];
const eye: V3 = [0, 1.6, 0], ahead: V3 = [0, 0, -1];
const at = (id: string, x: number, z: number) => ({ id, points: [[x, 1.6, z], [x, 1, z]] as V3[] });
const clear = () => true;

describe("marking an enemy", () => {
  it("marks the enemy nearest the crosshair, a little off it included", () => {
    expect(pickSpot(eye, ahead, [at("a", 3, -40), at("b", 1.5, -40), at("c", -12, -40)], clear)).toBe("b");
    expect(pickSpot(eye, ahead, [at("c", -12, -40)], clear)).toBeNull();
  });

  it("is forgiving up close, but never marks someone behind", () => {
    expect(pickSpot(eye, ahead, [at("a", 0.7, -3)], clear)).toBe("a");
    expect(pickSpot(eye, ahead, [at("a", 0.2, 3)], clear)).toBeNull();
  });

  it("needs the enemy in view and in range", () => {
    expect(pickSpot(eye, ahead, [at("a", 0, -30)], () => false)).toBeNull();
    // Chest behind cover, head showing.
    expect(pickSpot(eye, ahead, [at("a", 0, -30)], (_, to) => to[1] > 1.5)).toBe("a");
    expect(pickSpot(eye, ahead, [at("a", 0, -(SPOT_RANGE + 5))], clear)).toBeNull();
  });
});
