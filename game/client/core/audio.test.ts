import { describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audio";

const param = () => ({ setValueAtTime: vi.fn() });
const listener = () => ({
  positionX: param(), positionY: param(), positionZ: param(),
  forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param(),
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
