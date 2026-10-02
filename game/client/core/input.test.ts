import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "./input";

const makeInput = () => new Input({} as HTMLElement);

afterEach(() => vi.unstubAllGlobals());

function attachedInput() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null as unknown, fullscreenElement: null as unknown, exitPointerLock: vi.fn() });
  const keyboard = { lock: vi.fn().mockResolvedValue(undefined), unlock: vi.fn() };
  const element = new EventTarget();
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { keyboard });
  const input = new Input(element as HTMLElement);
  input.attach(); input.locked = true;
  const key = (code: string, ctrlKey = true, type = "keydown") => {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, ctrlKey });
    win.dispatchEvent(event);
    return event;
  };
  return { input, win, doc, element, keyboard, key };
}

describe("browser shortcut suppression", () => {
  it.each(["KeyW", "KeyS", "KeyR", "KeyF", "KeyP", "KeyT", "KeyN", "KeyL", "KeyD", "KeyJ", "KeyU", "Tab", "Equal", "Minus"])("cancels Ctrl+%s during play while preserving game input", (code) => {
    const { input, key } = attachedInput();
    expect(key(code).defaultPrevented).toBe(true);
    expect(input.held(code)).toBe(true);
    expect(key(code, true, "keyup").defaultPrevented).toBe(true);
    expect(input.held(code)).toBe(false);
    input.detach();
  });

  it("keeps both Ctrl crouch keys and movement working together", () => {
    const { input, key } = attachedInput();
    key("ControlRight"); key("KeyW");
    expect(input.crouch).toBe(true);
    expect(input.axes()).toEqual([1, 0]);
    key("ControlRight", false, "keyup");
    expect(input.crouch).toBe(false);
    expect(input.axes()).toEqual([1, 0]);
    input.detach();
  });

  it("leaves browser shortcuts available in menus and removes listeners on detach", () => {
    const { input, key } = attachedInput();
    input.enabled = false;
    expect(key("KeyR").defaultPrevented).toBe(false);
    expect(input.held("KeyR")).toBe(false);
    input.enabled = true; input.locked = false;
    expect(key("KeyS").defaultPrevented).toBe(false);
    input.locked = true; input.detach();
    expect(key("KeyP").defaultPrevented).toBe(false);
  });

  it("blocks Ctrl+wheel zoom only during active gameplay", () => {
    const { input, win } = attachedInput();
    const wheel = () => {
      const event = Object.assign(new Event("wheel", { cancelable: true }), { ctrlKey: true, deltaY: 100 });
      win.dispatchEvent(event); return event;
    };
    expect(wheel().defaultPrevented).toBe(true);
    expect(input.consume("WheelDown")).toBe(true);
    input.enabled = false;
    expect(wheel().defaultPrevented).toBe(false);
    input.detach();
  });

  it("captures reserved shortcuts in fullscreen and releases capture on pause or exit", async () => {
    const { input, doc, element, keyboard } = attachedInput();
    doc.pointerLockElement = element;
    doc.fullscreenElement = { contains: () => true };
    doc.dispatchEvent(new Event("fullscreenchange"));
    await Promise.resolve();
    expect(keyboard.lock).toHaveBeenCalledOnce();
    expect(keyboard.lock.mock.calls[0][0]).toContain("KeyW");
    expect(keyboard.lock.mock.calls[0][0]).not.toContain("Escape");
    input.enabled = false;
    expect(keyboard.unlock).toHaveBeenCalledOnce();
    input.enabled = true;
    await Promise.resolve();
    expect(keyboard.lock).toHaveBeenCalledTimes(2);
    doc.fullscreenElement = null;
    doc.dispatchEvent(new Event("fullscreenchange"));
    expect(keyboard.unlock).toHaveBeenCalledTimes(2);
    input.detach();
  });

  it("continues normal shortcut blocking if fullscreen capture is denied", async () => {
    const { input, doc, keyboard, key } = attachedInput();
    keyboard.lock.mockRejectedValue(new Error("Permission denied"));
    doc.fullscreenElement = { contains: () => true };
    doc.dispatchEvent(new Event("fullscreenchange"));
    await Promise.resolve(); await Promise.resolve();
    expect(key("KeyR").defaultPrevented).toBe(true);
    input.detach();
  });
});

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
