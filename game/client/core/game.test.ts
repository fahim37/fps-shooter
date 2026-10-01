import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Game } from "./game";
import { useHud } from "./hud";

vi.mock("./audio", () => ({ audio: { shot: vi.fn() } }));

beforeEach(() => useHud.setState({ hitmarker: { at: 0, head: false, kill: false, confirmed: false, damage: 0 } }));

it("ignores the previous dead snapshot after respawn but accepts later deaths", () => {
  const state = { awaitingSpawnState: true, local: { alive: true, die: vi.fn() } };
  const sync = (Game.prototype as unknown as { syncLife(alive: boolean): void }).syncLife;
  sync.call(state, false);
  expect(state.local.die).not.toHaveBeenCalled();
  sync.call(state, true);
  expect(state.awaitingSpawnState).toBe(false);
  sync.call(state, false);
  expect(state.local.die).toHaveBeenCalledOnce();
});

describe("local shot presentation", () => {
  it("uses the current eye for scoped tracers after the hidden viewmodel is left behind", () => {
    const tracer = vi.fn();
    const flash = vi.fn();
    const state = {
      local: { scoped: true, thirdPerson: false },
      fpp: { muzzle: new THREE.Vector3(-20, 1.4, 0) },
      effects: { tracer, muzzleFlash: flash },
      traceFrom: () => ({ point: [8, 1.62, -20], target: null, wall: null }),
    };
    Game.prototype.onLocalShot.call(state as unknown as Game, "sniper", [8, 1.62, -3], [[0, 0, -1]]);
    expect(tracer.mock.calls[0][0].toArray()).toEqual([8, 1.62, -3]);
    expect(flash).not.toHaveBeenCalled();
  });

  it("keeps predicted hits faint and reserves blood for server confirmation", () => {
    const blood = vi.fn();
    const state = {
      local: { scoped: false, thirdPerson: false },
      effects: { tracer: vi.fn(), muzzleFlash: vi.fn(), blood },
      traceFrom: () => ({ point: [0, 1.62, -5], target: {}, part: "head", wall: null }),
    };
    Game.prototype.onLocalShot.call(state as unknown as Game, "ar", [0, 1.62, 0], [[0, 0, -1]]);
    expect(blood).not.toHaveBeenCalled();
    expect(useHud.getState().hitmarker).toMatchObject({ confirmed: false, head: true, damage: 0, kill: false });
  });
});
