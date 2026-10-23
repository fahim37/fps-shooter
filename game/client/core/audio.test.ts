import { describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audio";

const param = () => ({ setValueAtTime: vi.fn() });
const listener = () => ({
  positionX: param(), positionY: param(), positionZ: param(),
  forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param(),
});

/** Just enough of an AudioContext to build gunshots and footsteps and count live routing. */
function fakeContext() {
  const disconnected: object[] = [];
  const panners: { panningModel: string }[] = [];
  const p = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const node = (extra: object = {}) => {
    const n = { connect: (to: object) => to, disconnect: () => { disconnected.push(n); }, gain: p(), frequency: p(), Q: p(), ...extra };
    return n;
  };
  const ctx = {
    currentTime: 0, listener: listener(),
    createGain: () => node(), createBiquadFilter: () => node({ type: "" }),
    createPanner: () => { const n = node({ panningModel: "", positionX: p(), positionY: p(), positionZ: p() }); panners.push(n as unknown as { panningModel: string }); return n; },
    createBufferSource: () => node({ start: vi.fn() }),
    createOscillator: () => node({ start: vi.fn(), stop: vi.fn(), type: "" }),
  };
  return { ctx, disconnected, panners };
}

describe("audio voices", () => {
  function engine() {
    const audio = new AudioEngine();
    const fake = fakeContext();
    Object.assign(audio, { ctx: fake.ctx, sfx: {}, reverb: {}, noise: {} });
    audio.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    return { audio, ...fake };
  }
  const voices = (audio: AudioEngine) => (audio as unknown as { voices: unknown[] }).voices.length;

  it("disconnects every finished sound so the audio thread stops processing it", () => {
    const { audio, ctx, disconnected } = engine();
    for (let i = 0; i < 20; i++) audio.shot("ar", { x: 10 + i, y: 0, z: 0 });
    audio.footstep(true, { x: 2, y: 0, z: 0 });
    audio.hitmarker(false);
    expect(voices(audio)).toBe(22);
    ctx.currentTime = 0.25;
    audio.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    expect(voices(audio)).toBe(20); // footstep and hitmarker done; gunshots still ringing
    ctx.currentTime = 2;
    audio.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    expect(voices(audio)).toBe(0);
    // Each gunshot cuts its bus, distance filter, panner and reverb send.
    expect(disconnected.length).toBe(20 * 4 + 3 + 1); // + footstep bus, filter, panner + hitmarker bus
  });

  it("keeps HRTF for a few nearby sounds and equal-power for the rest", () => {
    const { audio, panners } = engine();
    audio.shot("ar", { x: 5, y: 0, z: 0 });
    audio.shot("ar", { x: 60, y: 0, z: 0 });
    expect(panners.map((p) => p.panningModel)).toEqual(["HRTF", "equalpower"]);
    for (let i = 0; i < 12; i++) audio.shot("smg", { x: 4, y: 0, z: 0 });
    expect(panners.filter((p) => p.panningModel === "HRTF").length).toBe(8);
  });

  it("drops only faint sounds when the mix is crowded", () => {
    const { audio, panners } = engine();
    for (let i = 0; i < 40; i++) audio.shot("ar", { x: 30, y: 0, z: 0 });
    audio.shot("ar", { x: 80, y: 0, z: 0 });
    expect(panners.length).toBe(40);
    audio.shot("shotgun", { x: 4, y: 0, z: 0 });
    expect(panners.length).toBe(41);
  });
});

describe("audio updates", () => {
  it("does not enqueue unchanged volume ramps every frame", () => {
    const audio = new AudioEngine();
    const setTargetAtTime = vi.fn();
    Object.assign(audio, { ctx: { currentTime: 2 }, master: { gain: { setTargetAtTime } } });
    audio.setVolume(0.4);
    for (let frame = 0; frame < 600; frame++) audio.setVolume(0.4);
    expect(setTargetAtTime).toHaveBeenCalledExactlyOnceWith(0.4, 2, 0.05);
    audio.setVolume(0);
    expect(setTargetAtTime).toHaveBeenLastCalledWith(0, 2, 0.05);
  });

  it("updates only changed spatial parameters and resynchronizes after a match", () => {
    const audio = new AudioEngine();
    const first = listener();
    const pos = { x: 3, y: 1.6, z: -4 }, forward = { x: 0, y: 0, z: -1 };
    // The game can update before the first user gesture unlocks audio.
    audio.setListener(pos, forward);
    Object.assign(audio, { ctx: { currentTime: 1, listener: first, close: vi.fn() } });
    for (let frame = 0; frame < 600; frame++) audio.setListener(pos, forward);
    for (const value of Object.values(first)) expect(value.setValueAtTime).toHaveBeenCalledOnce();
    pos.x = 4;
    audio.setListener(pos, forward);
    expect(first.positionX.setValueAtTime).toHaveBeenLastCalledWith(4, 1);
    expect(first.forwardX.setValueAtTime).toHaveBeenCalledOnce();
    forward.x = 1; forward.z = 0;
    audio.setListener(pos, forward);
    expect(first.forwardX.setValueAtTime).toHaveBeenLastCalledWith(1, 1);
    expect(first.positionX.setValueAtTime).toHaveBeenCalledTimes(2);
    expect(first.upY.setValueAtTime).toHaveBeenCalledOnce();
    audio.dispose();
    const second = listener();
    Object.assign(audio, { ctx: { currentTime: 0, listener: second } });
    audio.setListener(pos, forward);
    for (const value of Object.values(second)) expect(value.setValueAtTime).toHaveBeenCalledOnce();
  });

  it("keeps legacy listener updates working", () => {
    const audio = new AudioEngine();
    const legacy = { setPosition: vi.fn(), setOrientation: vi.fn() };
    Object.assign(audio, { ctx: { currentTime: 0, listener: legacy } });
    const pos = { x: 1, y: 2, z: 3 }, forward = { x: 0, y: 0, z: -1 };
    audio.setListener(pos, forward);
    audio.setListener(pos, forward);
    expect(legacy.setPosition).toHaveBeenCalledExactlyOnceWith(1, 2, 3);
    expect(legacy.setOrientation).toHaveBeenCalledExactlyOnceWith(0, 0, -1, 0, 1, 0);
  });
});

describe("ambient beds", () => {
  type FakeBed = { key: string; out: { gain: { linearRampToValueAtTime: ReturnType<typeof vi.fn> } }; sources: { stop: ReturnType<typeof vi.fn> }[]; timers: Set<unknown> };
  function engine() {
    const p = () => ({
      value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(), cancelAndHoldAtTime: vi.fn(), setTargetAtTime: vi.fn(),
    });
    const node = (extra: object = {}) => ({
      connect: (to: object) => to, disconnect: vi.fn(), gain: p(), frequency: p(), Q: p(), pan: p(), playbackRate: p(),
      start: vi.fn(), stop: vi.fn(), type: "", ...extra,
    });
    const ctx = {
      currentTime: 0, state: "running", listener: listener(),
      createGain: () => node(), createBiquadFilter: () => node(), createStereoPanner: () => node(),
      createBufferSource: () => node(), createOscillator: () => node(), createPanner: () => node(),
    };
    const audio = new AudioEngine();
    Object.assign(audio, { ctx, master: node(), sfx: node(), reverb: node(), noise: {} });
    const bed = () => (audio as unknown as { bed: FakeBed | null }).bed;
    return { audio, ctx, bed };
  }

  it("plays one bed at a time and crossfades between the lobby and a map", () => {
    vi.useFakeTimers();
    try {
      const { audio, bed } = engine();
      audio.lobby(true);
      const lobby = bed()!;
      expect(lobby.key).toBe("lobby");
      audio.setMap("downtown");
      expect(bed()!.key).toBe("downtown");
      // The lobby bed fades out and its sources and timers stop.
      expect(lobby.out.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.any(Number));
      for (const s of lobby.sources) expect(s.stop).toHaveBeenCalled();
      expect(lobby.timers.size).toBe(0);
      // A lobby screen unmounting during the match leaves the match bed alone.
      audio.lobby(false);
      expect(bed()!.key).toBe("downtown");
      audio.dispose();
      expect(bed()).toBeNull();
      // Back in the lobby without a new context.
      audio.lobby(true);
      expect(bed()!.key).toBe("lobby");
      // Leaving a match after the lobby bed already came back keeps it.
      audio.dispose();
      expect(bed()!.key).toBe("lobby");
      // Swapping one menu screen for another (home lobby to waiting room) keeps the same bed.
      const theme = bed();
      audio.lobby(false);
      audio.lobby(true);
      vi.advanceTimersByTime(1000);
      expect(bed()).toBe(theme);
      // Leaving the menus for good stops it once no screen takes over.
      audio.lobby(false);
      expect(bed()).toBe(theme);
      vi.advanceTimersByTime(1000);
      expect(bed()).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("waits for an unlocked context before starting a bed", () => {
    const audio = new AudioEngine();
    audio.setMap("outpost");
    audio.lobby(true);
    expect((audio as unknown as { bed: unknown }).bed).toBeNull();
  });

  it("builds every bed and its occasional events, and cuts finished ones", () => {
    vi.useFakeTimers();
    try {
      const { audio, ctx, bed } = engine();
      for (const id of ["village", "downtown", "industrial", "outpost"] as const) {
        audio.setMap(id);
        expect(bed()!.key).toBe(id);
        vi.advanceTimersByTime(240_000);
        expect(bed()!.timers.size).toBeGreaterThan(0);
      }
      audio.lobby(true);
      vi.advanceTimersByTime(60_000);
      audio.uiHover(); audio.uiClick(); audio.uiTab(); audio.uiSting();
      ctx.currentTime = 1000;
      audio.uiHover();
      const voices = (audio as unknown as { voices: unknown[] }).voices;
      expect(voices.length).toBe(1); // the rest were swept once finished
    } finally { vi.useRealTimers(); }
  });
});
