import { describe, expect, it } from "vitest";
import { resetSightMotion, updateSightMotion, type SightMotionInput } from "./sightMotion";

const still: SightMotionInput = { swayX: 0, swayY: 0, bobX: 0, bobY: 0, strafe: 0, vy: 0, recoil: 0, time: 0 };
const settle = (input: Partial<SightMotionInput>) => {
  const out = { x: 0, y: 0, kick: 0 };
  for (let i = 0; i < 120; i++) updateSightMotion(1 / 60, { ...still, ...input }, out);
  return out;
};

describe("sight motion", () => {
  it("rests centred when the gun is still", () => {
    const out = settle({});
    expect(out.x).toBeCloseTo(0, 4);
    expect(out.y).toBeCloseTo(0, 4);
    expect(out.kick).toBe(0);
  });

  it("lags behind turning and strafing", () => {
    // Turning right sways the gun left (LocalPlayer negates mouse x).
    expect(settle({ swayX: -0.009 }).x).toBeLessThan(-0.05);
    expect(settle({ strafe: 5 }).x).toBeLessThan(-0.05);
    // Mouse down lifts the gun (view +y), which is screen up.
    expect(settle({ swayY: 0.009 }).y).toBeLessThan(-0.05);
  });

  it("kicks up on recoil and stays within the eyebox", () => {
    const out = settle({ recoil: 0.65, swayX: 1, strafe: -50, vy: 50 });
    expect(out.kick).toBe(1);
    expect(Math.abs(out.x)).toBeLessThanOrEqual(0.12);
    expect(Math.abs(out.y)).toBeLessThanOrEqual(0.12);
    resetSightMotion(out);
    expect(out).toEqual({ x: 0, y: 0, kick: 0 });
  });
});
