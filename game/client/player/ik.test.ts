import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { solveTwoBone } from "./ik";

function arm() {
  const parent = new THREE.Group();
  const upper = new THREE.Bone(), lower = new THREE.Bone(), hand = new THREE.Bone();
  parent.add(upper);
  upper.add(lower);
  lower.add(hand);
  lower.position.set(0, -0.25, 0);
  hand.position.set(0, -0.24, 0);
  parent.updateMatrixWorld(true);
  return { upper, lower, hand };
}

describe("weapon hand IK", () => {
  it.each([
    { target: new THREE.Vector3(0.18, -0.3, -0.2), pole: new THREE.Vector3(-0.4, -0.5, 0) },
    { target: new THREE.Vector3(0, 0, 0), pole: new THREE.Vector3(0, -1, 0) },
    { target: new THREE.Vector3(0, -0.3, 0), pole: new THREE.Vector3(0, -1, 0) },
    { target: new THREE.Vector3(0, 4, 0), pole: new THREE.Vector3(0, 4, 0) },
  ])("keeps arm lengths and rotations valid at ordinary and degenerate targets", ({ target, pole }) => {
    const { upper, lower, hand } = arm();
    solveTwoBone(upper, lower, hand, target, pole);
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const elbow = lower.getWorldPosition(new THREE.Vector3());
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    expect(shoulder.distanceTo(elbow)).toBeCloseTo(0.25, 6);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(0.24, 6);
    for (const bone of [upper, lower, hand]) {
      expect(bone.quaternion.toArray().every(Number.isFinite)).toBe(true);
      expect(bone.quaternion.length()).toBeCloseTo(1, 6);
    }
    if (target.length() > 0.01 && target.length() < 0.49) expect(wrist.distanceTo(target)).toBeLessThan(1e-6);
    expect(wrist.distanceTo(shoulder)).toBeLessThan(0.49);
  });

  it("leaves a missing or zero-length bone chain intact", () => {
    const { upper, lower, hand } = arm();
    lower.position.set(0, 0, 0);
    solveTwoBone(upper, lower, hand, new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0));
    expect(upper.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(lower.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  });
});
