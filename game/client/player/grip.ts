import * as THREE from "three";
import { instantiateCharacter, type CharacterTemplate } from "../assets/characters";
import type { WeaponId } from "../../shared/weapons";

type V3 = readonly [number, number, number];

/** Rounded box in weapon space (grip at the origin, muzzle toward -Z), pitched about X. */
interface Part { center: V3; half: V3; round: number; pitch?: number }

interface HandGrip {
  /** What the fingers close around. */
  part: Part;
  /** Where the centre of the palm presses, weapon space. */
  palm: V3;
  /** Palm normal, pointing from the palm into the part. */
  facing: V3;
  /** Rough direction from the little finger toward the index finger. */
  thumbSide: V3;
  /** Where the thumb points. */
  thumb: V3;
  /** Fixed index curls (knuckle → tip) for a trigger finger instead of wrapping it. */
  trigger?: readonly [number, number, number];
}

/**
 * Hand placements measured against the imported gun meshes: the right hand wraps the pistol
 * grip with the index on the trigger, the support hand cradles the handguard from below with
 * the thumb along its left side. Weapons without an entry keep the aim-pose hands.
 */
const GRIPS: Partial<Record<WeaponId, { right: HandGrip; left: HandGrip }>> = {
  ar: {
    right: {
      part: { center: [0, 0.005, -0.002], half: [0.011, 0.05, 0.02], round: 0.009, pitch: -0.24 },
      palm: [0.026, 0.012, 0.012],
      facing: [-1, 0, 0.1],
      thumbSide: [0, 1, -0.24],
      thumb: [-0.35, 0.25, -1],
      trigger: [0.3, 0.75, 0.35],
    },
    left: {
      part: { center: [0, 0.1, -0.33], half: [0.014, 0.032, 0.075], round: 0.012 },
      palm: [-0.024, 0.066, -0.31],
      facing: [0.75, 1, 0],
      thumbSide: [-0.25, 0.1, -1],
      thumb: [-0.1, 0.05, -1],
    },
  },
};

const FINGERS = ["index", "middle", "ring", "pinky"] as const;
/** Joint limits (rad) from knuckle to tip. */
const MAX_CURL = [1.55, 1.9, 1.35];
const THUMB_MAX_CURL = [0.6, 0.8];
const FINGER_RADIUS = 0.0085;
/** Relaxed support hand while it travels to the magazine, as a fraction of the grip. */
const RELAXED = 0.35;
const STEP = 0.06;

export interface FingerPose {
  name: string;
  /** Relaxed pose, used when the hand lets go (reload). */
  open: THREE.Quaternion;
  closed: THREE.Quaternion;
}

export interface GripPose {
  /** Hand bone transforms in weapon space. */
  right: THREE.Matrix4;
  left: THREE.Matrix4;
  /** Finger bone local rotations for both hands. */
  fingers: FingerPose[];
}

const cache = new WeakMap<CharacterTemplate, Map<WeaponId, GripPose>>();

export function gripPose(template: CharacterTemplate, weapon: WeaponId): GripPose | null {
  const grip = GRIPS[weapon];
  if (!grip) return null;
  let byWeapon = cache.get(template);
  if (!byWeapon) cache.set(template, byWeapon = new Map());
  let pose = byWeapon.get(weapon);
  if (!pose) byWeapon.set(weapon, pose = solveGrip(template, grip));
  return pose;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);

function solveGrip(template: CharacterTemplate, grip: { right: HandGrip; left: HandGrip }): GripPose {
  // Solve on a bind-pose copy whose hands are detached, so "world" here is weapon space.
  const inst = instantiateCharacter(template, 0, false);
  inst.root.updateMatrixWorld(true);
  const fingers: FingerPose[] = [];
  const hand = (side: "r" | "l", g: HandGrip) => {
    const bone = inst.bones.get(`hand_${side}`)!;
    const scale = bone.getWorldScale(new THREE.Vector3());
    bone.removeFromParent();
    bone.scale.copy(scale);
    // Hand frame: +Y along the fingers, +Z toward the thumb, palm facing -X (right) / +X (left).
    const facing = _v.set(...g.facing).normalize();
    _x.copy(facing).multiplyScalar(side === "r" ? -1 : 1);
    _z.set(...g.thumbSide).projectOnPlane(_x).normalize();
    _y.crossVectors(_z, _x);
    const basis = new THREE.Matrix4().makeBasis(_x, _y, _z);
    bone.quaternion.setFromRotationMatrix(basis);
    // Palm centre: between the wrist and the middle knuckle, on the palm skin.
    const palm = _v2.set(side === "r" ? -0.02 : 0.02, 0.065, -0.004).multiply(scale).applyQuaternion(bone.quaternion);
    bone.position.set(...g.palm).sub(palm);
    bone.updateMatrixWorld(true);

    const sdf = partDistance(g.part);
    const b = (name: string) => inst.bones.get(`${name}_${side}`);
    const chains: { names: string[]; curls?: readonly number[]; thumb?: boolean }[] = FINGERS.map((f) => ({
      names: [1, 2, 3, 4].map((j) => j === 4 ? `${f}_04_leaf` : `${f}_0${j}`),
      curls: f === "index" ? g.trigger : undefined,
    }));
    chains.push({ names: ["thumb_01", "thumb_02", "thumb_03", "thumb_04_leaf"], thumb: true });
    for (const chain of chains) {
      const found = chain.names.map(b);
      if (found.some((x) => !x)) continue;
      const bones = found as THREE.Bone[];
      const open = bones.slice(0, 3).map((x) => x.quaternion.clone());
      if (chain.thumb) aimThumb(bones, new THREE.Vector3(...g.thumb).normalize(), g.part);
      const first = chain.thumb ? 1 : 0;
      for (let j = first; j < 3; j++) {
        const fixed = chain.curls?.[j];
        if (fixed !== undefined) curl(bones[j], fixed);
        else wrap(bones[j], bones[j + 1], chain.thumb ? THUMB_MAX_CURL[j - 1] : MAX_CURL[j], sdf);
      }
      for (let j = 0; j < 3; j++) {
        const closed = bones[j].quaternion.clone();
        fingers.push({ name: bones[j].name, closed, open: open[j].slerp(closed, RELAXED) });
      }
    }
    return bone.matrixWorld.clone();
  };
  return { right: hand("r", grip.right), left: hand("l", grip.left), fingers };
}

function curl(bone: THREE.Object3D, angle: number) {
  bone.quaternion.multiply(_q.setFromAxisAngle(AXIS_X, angle));
  bone.updateMatrixWorld(true);
}

/** Curls a joint about its local X until the segment it drives touches the part. */
function wrap(bone: THREE.Object3D, end: THREE.Object3D, max: number, sdf: (p: THREE.Vector3) => number) {
  const base = bone.quaternion.clone();
  const touching = (angle: number) => {
    bone.quaternion.copy(base).multiply(_q.setFromAxisAngle(AXIS_X, angle));
    bone.updateMatrixWorld(true);
    const a = _v.setFromMatrixPosition(bone.matrixWorld);
    const tip = _v2.setFromMatrixPosition(end.matrixWorld);
    return sdf(tip) < FINGER_RADIUS || sdf(a.lerp(tip, 0.5)) < FINGER_RADIUS;
  };
  if (touching(0)) return;
  let lo = 0;
  for (let hi = STEP; hi < max + STEP; hi += STEP) {
    const angle = Math.min(hi, max);
    if (!touching(angle)) { lo = angle; continue; }
    let h = angle;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + h) / 2;
      if (touching(mid)) h = mid; else lo = mid;
    }
    break;
  }
  touching(lo);
}

/** Points the thumb along `dir`, rolled so its joints bend toward the part. */
function aimThumb(bones: THREE.Object3D[], dir: THREE.Vector3, part: Part) {
  const [t1, t2] = bones;
  const from = _v.setFromMatrixPosition(t2.matrixWorld).sub(_v2.setFromMatrixPosition(t1.matrixWorld)).normalize();
  rotateWorld(t1, _q.setFromUnitVectors(from, dir));
  // Roll about the thumb so the bending side (+Z of the next joint) faces the part.
  const base = _v2.setFromMatrixPosition(t1.matrixWorld);
  const toPart = new THREE.Vector3(...part.center).sub(base).projectOnPlane(dir).normalize();
  const bend = _v.set(0, 0, 1).transformDirection(t2.matrixWorld).projectOnPlane(dir).normalize();
  const angle = Math.atan2(_y.crossVectors(bend, toPart).dot(dir), bend.dot(toPart));
  rotateWorld(t1, _q.setFromAxisAngle(dir, angle));
}

const _pw = new THREE.Quaternion();
const _cw = new THREE.Quaternion();
function rotateWorld(bone: THREE.Object3D, delta: THREE.Quaternion) {
  bone.getWorldQuaternion(_cw).premultiply(delta);
  bone.parent!.getWorldQuaternion(_pw);
  bone.quaternion.copy(_pw.invert().multiply(_cw));
  bone.updateMatrixWorld(true);
}

function partDistance(part: Part) {
  const inv = new THREE.Matrix4().compose(
    new THREE.Vector3(...part.center),
    new THREE.Quaternion().setFromAxisAngle(AXIS_X, part.pitch ?? 0),
    new THREE.Vector3(1, 1, 1),
  ).invert();
  const p = new THREE.Vector3();
  const r = part.round;
  const [hx, hy, hz] = part.half;
  return (point: THREE.Vector3) => {
    p.copy(point).applyMatrix4(inv);
    const qx = Math.abs(p.x) - hx + r, qy = Math.abs(p.y) - hy + r, qz = Math.abs(p.z) - hz + r;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return outside + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
}
