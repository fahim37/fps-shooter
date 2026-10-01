import { describe, expect, it } from "vitest";
import { Input } from "./input";

const makeInput = () => new Input({} as HTMLElement);

describe("touch input", () => {
  it("preserves touch movement actions when keyboard or grenade holds refresh axes", () => {
    const input = makeInput();
    input.setAction("crouch", true);
    input.setAction("jump", true);
    input.hold("KeyG", true);
    expect(input.crouch).toBe(true);
    expect(input.jump).toBe(true);
    input.hold("KeyG", false);
    expect(input.crouch).toBe(true);
    expect(input.jump).toBe(true);
    input.setAction("crouch", false);
    input.setAction("sprint", true);
    input.setStick({ x: 0.3, y: 0.8 });
    expect(input.axes()).toEqual([0.8, 0.3]);
    expect(input.sprint).toBe(true);
    input.releaseAll();
    expect([input.crouch, input.jump, input.sprint, input.fire, input.ads]).toEqual([false, false, false, false, false]);
    expect(input.axes()).toEqual([0, 0]);
  });

  it("registers one grenade press per hold and updates held keyboard movement", () => {
    const input = makeInput();
    input.hold("KeyG", true);
    expect(input.consume("KeyG")).toBe(true);
    input.hold("KeyG", true);
    expect(input.consume("KeyG")).toBe(false);
    input.hold("KeyG", false);
    input.hold("KeyG", true);
    expect(input.consume("KeyG")).toBe(true);
    input.hold("ShiftLeft", true);
    expect(input.sprint).toBe(true);
    input.hold("ShiftLeft", false);
    expect(input.sprint).toBe(false);
  });

  it("rejects new touches while paused and still accepts releases", () => {
    const input = makeInput();
    input.setAction("fire", true);
    input.enabled = false;
    input.setAction("fire", false);
    input.setAction("ads", true);
    input.setAction("crouch", true);
    input.press("KeyR");
    input.hold("KeyG", true);
    input.setStick({ x: 1, y: 1 });
    input.addLook(30, 20);
    expect([input.fire, input.ads, input.crouch, input.held("KeyG"), input.consume("KeyR")]).toEqual([false, false, false, false, false]);
    expect(input.axes()).toEqual([0, 0]);
    expect(input.consumeLook()).toEqual([0, 0]);
  });
});
