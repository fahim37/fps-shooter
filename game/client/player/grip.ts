import * as THREE from "three";
import type { WeaponId } from "../../shared/weapons";
import baked from "../../shared/generated/grips.json";

/**
 * How each gun is held. The poses are solved offline against the real gun and glove meshes
 * (game/client/dev/gripSolver.ts) and baked into grips.json, so nothing is solved while playing.
 * After changing a gun model, the soldier's hands or a hold: npx tsx scripts/dev/grip-bake.ts
 */

/** What a hand pose is attached to: the gun itself, or a piece that moves while handling it. */
export type HandFrame = "gun" | "mag" | "pump" | "bolt" | "shell";

export type RightPose = "grip" | "bolt" | "cock";
export type LeftPose = "support" | "mag" | "charge" | "shell";
export type HandPoseId = RightPose | LeftPose;

export interface HandPose {
  /** Hand bone transform in its frame's space (weapon space for "gun"). */
  matrix: THREE.Matrix4;
  frame: HandFrame;
  /** Local rotations of `GripPose.fingers[side]`, same order. */
  fingers: THREE.Quaternion[];
}

export interface GripPose {
  /** Finger bone names driven per hand. */
  fingers: { r: string[]; l: string[] };
  right: Partial<Record<RightPose, HandPose>> & { grip: HandPose };
  left: Partial<Record<LeftPose, HandPose>> & { support: HandPose };
}

/** A hand pose as stored: the matrix's 16 elements and the finger quaternions end to end. */
export interface BakedHand { frame: HandFrame; m: number[]; f: number[] }
export interface BakedGrip {
  fingers: { r: string[]; l: string[] };
  right: Partial<Record<RightPose, BakedHand>>;
  left: Partial<Record<LeftPose, BakedHand>>;
}

const cache = new Map<WeaponId, GripPose>();

/** A gun with no baked hold yet: hands at its origin, fingers left as the animation has them. */
const unposed = (): HandPose => ({ matrix: new THREE.Matrix4(), frame: "gun", fingers: [] });

function unpack(hand: BakedHand): HandPose {
  const fingers: THREE.Quaternion[] = [];
  for (let i = 0; i < hand.f.length; i += 4) fingers.push(new THREE.Quaternion().fromArray(hand.f, i));
  return { matrix: new THREE.Matrix4().fromArray(hand.m), frame: hand.frame, fingers };
}

function unpackSide<P extends string>(hands: Partial<Record<P, BakedHand>>) {
  const out: Partial<Record<P, HandPose>> = {};
  for (const name of Object.keys(hands) as P[]) out[name] = unpack(hands[name]!);
  return out;
}

export function gripPose(weapon: WeaponId): GripPose {
  let pose = cache.get(weapon);
  if (pose) return pose;
  const grip = (baked as unknown as Partial<Record<WeaponId, BakedGrip>>)[weapon];
  if (grip) {
    const right = unpackSide(grip.right), left = unpackSide(grip.left);
    pose = {
      fingers: grip.right.grip && grip.left.support ? grip.fingers : { r: [], l: [] },
      right: { ...right, grip: right.grip ?? unposed() },
      left: { ...left, support: left.support ?? unposed() },
    };
  } else {
    pose = { fingers: { r: [], l: [] }, right: { grip: unposed() }, left: { support: unposed() } };
  }
  cache.set(weapon, pose);
  return pose;
}
