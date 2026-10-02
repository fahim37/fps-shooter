import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CharacterRig, type RigState } from "./CharacterRig";
import type { CharacterTemplate, ClipName } from "../assets/characters";
import type { WeaponId } from "../../shared/weapons";

/** Static animation samples expose procedural drift that moving keyframes can hide. */
function template(): CharacterTemplate {
  const scene = new THREE.Group();
  const bones: THREE.Bone[] = [];
  const add = (parent: THREE.Object3D, name: string, x: number, y: number, z = 0) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    parent.add(bone);
    bones.push(bone);
    return bone;
  };
  const root = add(scene, "root", 0, 0);
  const pelvis = add(root, "pelvis", 0, 0.95);
  const spine1 = add(pelvis, "spine_01", 0, 0.12);
  const spine2 = add(spine1, "spine_02", 0, 0.11);
  const spine3 = add(spine2, "spine_03", 0, 0.13);
  const neck = add(spine3, "neck_01", 0, 0.2);
  add(neck, "Head", 0, 0.08);
  for (const side of ["l", "r"]) {
    const upper = add(spine3, `upperarm_${side}`, side === "l" ? 0.2 : -0.2, 0.12);
    const lower = add(upper, `lowerarm_${side}`, 0, -0.25);
    const hand = add(lower, `hand_${side}`, 0, -0.24);
    add(hand, `middle_01_${side}`, 0, -0.07);
  }
  const names: ClipName[] = ["idle", "walk", "jog", "sprint", "crouchIdle", "crouchWalk", "jumpLoop", "aimNeutral", "aimUp", "aimDown", "death"];
  const full = new Map<ClipName, THREE.AnimationClip>();
  const lower = new Map<ClipName, THREE.AnimationClip>();
  const upper = new Map<ClipName, THREE.AnimationClip>();
  for (const name of names) {
    const tracks = bones.map((bone) => new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]));
    full.set(name, new THREE.AnimationClip(name, 1, tracks));
    lower.set(name, new THREE.AnimationClip(name, 1, tracks.filter((track) => /^(root|pelvis)\./.test(track.name))));
    upper.set(name, new THREE.AnimationClip(name, 1, tracks.filter((track) => !/^(root|pelvis)\./.test(track.name))));
  }
  return { scene, full, lower, upper };
}

describe("character shooting pose", () => {
  it("returns to the same track sampling cost after cycling movement animations", () => {
    const rig = new CharacterRig(template(), new Map(), 1, false, "tpp");
    const state: RigState = {
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, moveYaw: 0,
      crouch: false, grounded: true, alive: true, sprint: 0, ads: 0, reload: -1, recoil: 0,
    };
    const evaluate = vi.spyOn(THREE.Interpolant.prototype, "evaluate");
    try {
      rig.update(1 / 60, state);
      const restingCost = evaluate.mock.calls.length;
      expect(restingCost).toBeGreaterThan(0);
      for (const speed of [2, 5, 7]) {
        for (let frame = 0; frame < 60; frame++) rig.update(1 / 60, { ...state, speed });
      }
      for (let frame = 0; frame < 120; frame++) rig.update(1 / 60, state);
      evaluate.mockClear();
      rig.update(1 / 60, state);
      expect(evaluate.mock.calls.length).toBe(restingCost);
    } finally {
      evaluate.mockRestore();
      rig.dispose();
    }
  });

  it.each(["ar", "pistol"] as WeaponId[])("holds a stable %s pose while the legs face sideways", (weapon) => {
    const rig = new CharacterRig(template(), new Map([[weapon, new THREE.Group()]]), 1, false, "tpp");
    rig.setWeapon(weapon);
    const state: RigState = {
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0.25, speed: 5, moveYaw: Math.PI / 2,
      crouch: false, grounded: true, alive: true, sprint: 0, ads: 1, reload: -1, recoil: 0.8,
    };
    for (let frame = 0; frame < 180; frame++) rig.update(1 / 60, state);
    rig.update(0, state);
    const pose = [...rig.inst.bones.values()].map((bone) => ({ bone, q: bone.quaternion.clone().normalize() }));
    const muzzle = rig.muzzle.clone();
    for (let frame = 0; frame < 180; frame++) rig.update(0, state);
    for (const { bone, q } of pose) {
      expect(q.angleTo(bone.quaternion.clone().normalize()), `${bone.name} should not accumulate rotation`).toBeLessThan(1e-5);
    }
    expect(muzzle.distanceTo(rig.muzzle)).toBeLessThan(1e-6);
    rig.dispose();
  });
});
