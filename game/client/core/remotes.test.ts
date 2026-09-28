import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RemotePlayer } from "./remotes";
import type { CharacterRig } from "../player/CharacterRig";
import { PlayerState } from "../../shared/schema";

function remote() {
  const r = new RemotePlayer("test");
  r.rig = { update: vi.fn() } as unknown as CharacterRig;
  return r;
}
function snap(x: number, yaw = 0, alive = true) {
  return Object.assign(new PlayerState(), { x, yaw, alive });
}
function sample(r: RemotePlayer, time: number) { r.update(1 / 60, time, new THREE.Vector3()); }

describe("remote snapshot playback", () => {
  it("holds the oldest sample before the buffer starts", () => {
    const r = remote(); r.push(1000, snap(1)); r.push(1100, snap(2));
    sample(r, 950); expect(r.pos.x).toBe(1);
  });
  it("interpolates position and takes the short rotation across pi", () => {
    const r = remote(); r.push(1000, snap(1, Math.PI - 0.1)); r.push(1100, snap(3, -Math.PI + 0.1));
    sample(r, 1050); expect(r.pos.x).toBe(2); expect(r.yaw).toBeCloseTo(Math.PI);
  });
  it("caps extrapolation at 120 milliseconds", () => {
    const r = remote(); r.push(1000, snap(1)); r.push(1100, snap(2));
    sample(r, 2000); expect(r.pos.x).toBeCloseTo(3.2);
  });
  it("ignores older packets and replaces equal timestamps", () => {
    const r = remote(); r.push(1000, snap(1)); r.push(1100, snap(2)); r.push(900, snap(9)); r.push(1100, snap(3));
    sample(r, 1100); expect(r.pos.x).toBe(3);
  });
  it("does not interpolate or extrapolate across respawn teleports", () => {
    const r = remote(); r.push(1000, snap(1, 0, false)); r.push(1100, snap(30));
    sample(r, 1075); expect(r.pos.x).toBe(1); expect(r.alive).toBe(false);
    sample(r, 1200); expect(r.pos.x).toBe(30); expect(r.alive).toBe(true);
  });
});
