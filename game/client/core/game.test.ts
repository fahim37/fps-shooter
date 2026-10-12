import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Game } from "./game";
import { useHud } from "./hud";

vi.mock("./audio", () => ({ audio: { shot: vi.fn() } }));

beforeEach(() => useHud.setState(useHud.getInitialState()));

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


describe("elimination presentation", () => {
  const onKill = (Game.prototype as unknown as { onKill(ev: import("../../shared/messages").KillEvent): void }).onKill;
  function fixture() {
    const die = vi.fn(), start = vi.fn();
    const state = {
      room: { sessionId: "me", state: { players: new Map() } },
      local: { die, onKillScavenge: vi.fn(), eye: new THREE.Vector3(0, 1.5, 0) },
      killSeq: 0, clock: { now: () => 1000 }, deathCamera: { start },
    };
    return { state, die, start };
  }
  it("uses elimination snapshots even when the killer has left replicated state", () => {
    const { state, die, start } = fixture();
    onKill.call(state, { killer: "enemy", victim: "me", weapon: "sniper", headshot: true, streak: 4,
      killerInfo: { name: "Actual Killer", team: 2, hp: 27, position: [0, 0, -30] },
      victimInfo: { name: "Me", team: 1 }, distance: 30, respawnAt: 4400 });
    expect(die).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][1].toArray()).toEqual([0, 1.5, -30]);
    expect(useHud.getState()).toMatchObject({ hp: 0, alive: false, respawnAt: 4400,
      killedBy: { id: "enemy", name: "Actual Killer", hp: 27, distance: 30, headshot: true, streak: 4 } });
    expect(useHud.getState().killfeed[0]).toMatchObject({ killer: "Actual Killer", victim: "Me", localDeath: true, localKill: false });
  });
  it("shows fall damage without identifying yourself as the killer and bounds the feed", () => {
    const { state, start } = fixture();
    for (let i = 0; i < 8; i++) onKill.call(state, { killer: "me", victim: "me", weapon: "fall", headshot: false, streak: 0 });
    expect(start).toHaveBeenLastCalledWith(state.local.eye, null);
    expect(useHud.getState().killedBy).toMatchObject({ id: "", name: "Fall damage", hp: null, distance: null });
    expect(useHud.getState().killfeed).toHaveLength(5);
    expect(useHud.getState().killfeed[0].localKill).toBe(false);
  });
  it("names confirmed victims and groups rapid kills without counting other players' kills", () => {
    const { state } = fixture();
    const kill = { killer: "me", victim: "enemy", weapon: "ar" as const, headshot: true, streak: 1, victimInfo: { name: "Enemy Scout", team: 2 } };
    onKill.call(state, kill);
    expect(useHud.getState().elimination).toMatchObject({ name: "Enemy Scout", count: 1, headshot: true });
    onKill.call(state, { ...kill, victim: "enemy2", victimInfo: { name: "Enemy Two", team: 2 } });
    expect(useHud.getState().elimination).toMatchObject({ name: "Enemy Two", count: 2 });
    onKill.call(state, { ...kill, killer: "other" });
    expect(useHud.getState().elimination?.name).toBe("Enemy Two");
    useHud.setState({ elimination: { ...useHud.getState().elimination!, at: performance.now() - 3000 } });
    onKill.call(state, kill);
    expect(useHud.getState().elimination?.count).toBe(1);
  });
});
