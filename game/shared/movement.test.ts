import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_SPEED_MULT, CROUCH_SPEED, SPRINT_SPEED, WALK_SPEED } from "./constants";
import { Mover, newMoveState, type MoveInput, type MoveState } from "./movement";

beforeAll(async () => { await RAPIER.init(); });

describe.each([30, 60, 120])("sprint steering at %i Hz", (rate) => {
  let world: RAPIER.World;
  let mover: Mover;
  let state: MoveState;
  let input: MoveInput;

  beforeEach(() => {
    world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    mover = new Mover(RAPIER, world);
    // Unobstructed ground isolates steering from contact resolution. Real map
    // collision, stairs and jumping are exercised by server/stairs.test.ts.
    const kcc = (mover as unknown as { kcc: RAPIER.KinematicCharacterController }).kcc;
    let movement = { x: 0, y: 0, z: 0 };
    vi.spyOn(kcc, "computeColliderMovement").mockImplementation((_collider, desired) => { movement = { ...desired, y: 0 }; });
    vi.spyOn(kcc, "computedMovement").mockImplementation(() => movement);
    vi.spyOn(kcc, "computedGrounded").mockReturnValue(true);
    state = newMoveState(0, 0, 0);
    state.grounded = true;
    input = { forward: 0, right: 0, yaw: 0, jump: false, sprint: true, crouch: false, ads: 0, speedMult: 1 };
  });

  afterEach(() => { vi.restoreAllMocks(); mover.dispose(); world.free(); });

  const speed = (state: MoveState) => Math.hypot(state.vx, state.vz);
  function run(seconds = 0.5) {
    for (let i = 0; i < rate * seconds; i++) mover.step(state, input, 1 / rate);
  }

  it("maintains sprint speed on every frame when adding, switching and releasing strafe", () => {
    input.forward = 1;
    run();
    for (const right of [-1, 1, 0, 1, -1, 0]) {
      input.right = right;
      for (let i = 0; i < rate / 4; i++) {
        mover.step(state, input, 1 / rate);
        expect(state.sprinting).toBe(true);
        expect(speed(state)).toBeCloseTo(SPRINT_SPEED, 5);
      }
      expect(Math.sign(state.vx)).toBe(right);
      expect(state.vz).toBeLessThan(0);
    }
  });

  it.each([-1, 1])("keeps sprinting when forward is released and strafe is %i", (right) => {
    input.forward = 1;
    input.right = right;
    run();
    input.forward = 0;
    for (let i = 0; i < rate / 2; i++) {
      mover.step(state, input, 1 / rate);
      expect(state.sprinting).toBe(true);
      expect(speed(state)).toBeCloseTo(SPRINT_SPEED, 5);
    }
    expect(state.vx).toBeCloseTo(right * SPRINT_SPEED, 5);
    expect(state.vz).toBeCloseTo(0, 5);
  });

  it("preserves speed while turning the view and keeps diagonal speed capped", () => {
    input.forward = 1;
    input.right = 1;
    run();
    expect(speed(state)).toBeCloseTo(SPRINT_SPEED, 5);
    for (let i = 0; i < rate; i++) {
      input.yaw += Math.PI / rate;
      mover.step(state, input, 1 / rate);
      expect(speed(state)).toBeCloseTo(SPRINT_SPEED, 5);
    }
  });

  it("still stops, reverses direction and respects walk, crouch and aiming speeds", () => {
    input.forward = 1;
    run();
    input.forward = 0;
    run();
    expect(speed(state)).toBe(0);
    expect(state.sprinting).toBe(false);
    input.right = 1;
    run();
    input.right = -1;
    run();
    expect(state.vx).toBeCloseTo(-SPRINT_SPEED, 5);
    input.right = 0;
    input.forward = -1;
    run();
    expect(speed(state)).toBeCloseTo(WALK_SPEED, 5);
    input.forward = 1;
    input.crouch = true;
    run();
    expect(speed(state)).toBeCloseTo(CROUCH_SPEED, 5);
    input.crouch = false;
    input.ads = 1;
    run();
    expect(speed(state)).toBeCloseTo(WALK_SPEED * ADS_SPEED_MULT, 5);
    input.ads = 0;
    input.sprint = false;
    run();
    expect(speed(state)).toBeCloseTo(WALK_SPEED, 5);
  });

  it("keeps weapon speed limits and yields to blocked movement", () => {
    input.forward = 1;
    run();
    input.speedMult = 0.85;
    input.right = 1;
    run();
    expect(speed(state)).toBeCloseTo(SPRINT_SPEED * 0.85, 5);
    const kcc = (mover as unknown as { kcc: RAPIER.KinematicCharacterController }).kcc;
    vi.mocked(kcc.computedMovement).mockReturnValue({ x: 0, y: 0, z: 0 });
    mover.step(state, input, 1 / rate);
    expect(speed(state)).toBe(0);
  });
});
