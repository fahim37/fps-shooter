import { describe, expect, it } from "vitest";
import { ResolutionGovernor } from "./resolution";

function run(governor: ResolutionGovernor, fps: number, seconds: number) {
  const values: number[] = [];
  for (let frame = 0; frame < fps * seconds; frame++) {
    const next = governor.sample(1 / fps);
    if (next !== null) values.push(next);
  }
  return values;
}

describe("adaptive render resolution", () => {
  it("waits through warmup and sustained frame drops before lowering resolution", () => {
    const governor = new ResolutionGovernor(1, 0.65);
    expect(run(governor, 30, 7)).toEqual([]);
    expect(run(governor, 30, 3)).toEqual([0.9]);
  });
  it("respects preset bounds and recovers gradually without oscillating", () => {
    const governor = new ResolutionGovernor(1, 0.65);
    run(governor, 30, 90);
    expect(governor.dpr).toBe(0.65);
    run(governor, 52, 30);
    expect(governor.dpr).toBe(0.65);
    const recovered = run(governor, 60, 120);
    expect(recovered[0]).toBe(0.7);
    expect(governor.dpr).toBe(1);
  });
  it("still lowers resolution when a very slow machine renders only a few frames per second", () => {
    const governor = new ResolutionGovernor(1, 0.65);
    expect(run(governor, 3, 10)).toEqual([0.9]);
  });
  it("ignores loading hitches and paused samples", () => {
    const governor = new ResolutionGovernor(1, 0.65);
    run(governor, 30, 7);
    expect(governor.sample(2)).toBeNull();
    expect(governor.sample(Number.NaN)).toBeNull();
    governor.pause();
    expect(run(governor, 30, 3)).toEqual([]);
    expect(governor.dpr).toBe(1);
  });
});
