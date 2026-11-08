import * as THREE from "three";
import { instantiateCharacter, type CharacterTemplate } from "../assets/characters";
import { SHELL_SEATS, WEAPON_PARTS } from "../assets/weapons";
import type { WeaponId } from "../../shared/weapons";

type V3 = readonly [number, number, number];

/** Rounded box in weapon space (grip at the origin, muzzle toward -Z), pitched about X. */
interface Part { center: V3; half: V3; round: number; pitch?: number }

/** What a hand pose is attached to: the gun itself, or a piece that moves while handling it. */
export type HandFrame = "gun" | "mag" | "pump" | "bolt" | "shell";

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
  frame?: HandFrame;
}

export type RightPose = "grip" | "bolt" | "cock";
export type LeftPose = "support" | "mag" | "charge" | "shell";
export type HandPoseId = RightPose | LeftPose;

const rotX = (v: V3, a: number): V3 => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Right hand around a pistol grip, index on the trigger. */
function pistolGrip(center: V3, half: V3, pitch: number, trigger: readonly [number, number, number] = [0.3, 0.75, 0.35]): HandGrip {
  return {
    part: { center, half, round: 0.009, pitch },
    palm: add(center, rotX([half[0] + 0.015, 0.0035, 0.0153], pitch)),
    facing: [-1, 0, 0.1],
    thumbSide: rotX([0, 1, 0], pitch),
    thumb: [-0.35, 0.25, -1],
    trigger,
  };
}

/**
 * Support hand under the left of a handguard (or pump, or forend), as a shooter holds one: the hand
 * points along the gun with the index knuckle on top, the palm turned up and in, and the fingers
 * curled up around the far side. The forearm comes up from below, so the wrist bends (~60°) instead
 * of running straight on from it. `back` slides the palm toward the receiver, which keeps the
 * support elbow bent.
 */
function cradle(center: V3, half: V3, frame?: HandFrame, back = 0): HandGrip {
  const round = 0.012;
  // Palm on the box's rounded lower-left edge, where its surface faces the palm.
  const f = Math.hypot(CRADLE_FACING[0], CRADLE_FACING[1]);
  const fx = CRADLE_FACING[0] / f, fy = CRADLE_FACING[1] / f;
  const out = round + 0.002;
  return {
    part: { center, half, round },
    palm: [center[0] - (half[0] - round) - fx * out, center[1] - (half[1] - round) - fy * out, center[2] + 0.02 + back],
    facing: CRADLE_FACING,
    thumbSide: CRADLE_THUMB_SIDE,
    thumb: [-0.1, 0.05, -1],
    frame,
  };
}
/** Cradling palm normal: up and in, tipped a little back as the hand angles in toward the gun. */
const CRADLE_FACING: V3 = [0.6, 1, 0];
const CRADLE_THUMB_SIDE: V3 = [-0.45, 0.3, -1];

/** Support hand closed around a magazine from its left: fingers over the front, thumb behind. */
function magGrip(center: V3, half: V3, pitch: number): HandGrip {
  return {
    part: { center, half, round: 0.006, pitch },
    palm: add(center, rotX([-(half[0] + 0.016), -half[1] * 0.35, 0.004], pitch)),
    facing: [1, 0, 0],
    thumbSide: rotX([0, 1, 0], pitch),
    thumb: [0.4, 0.2, 1],
    frame: "mag",
  };
}

/** The revolver's plow-handle grip, thumb lying along the frame. */
const REVOLVER: HandGrip = { ...pistolGrip([0, -0.0075, 0.005], [0.0206, 0.06, 0.0288], -0.31, [0.4, 0.9, 0.45]), thumb: [0.1, 0.2, -1] };

/**
 * Hand placements measured against the imported gun meshes. Each weapon has the firing grip
 * and support hold, plus the extra holds its reload and cycling animations move through.
 */
const GRIPS: Record<WeaponId, { right: Partial<Record<RightPose, HandGrip>> & { grip: HandGrip }; left: Partial<Record<LeftPose, HandGrip>> & { support: HandGrip } }> = {
  ar: {
    right: {
      // Thumb forward along the receiver: wrapped over the top it would sink into the wide lower.
      grip: { ...pistolGrip([0, -0.0013, 0.0105], [0.0195, 0.058, 0.029], -0.5), thumb: [0.1, 0.15, -1] },
    },
    left: {
      // The handguard measured off the mesh: ±19 mm wide, 68-125 mm up. A wider box leaves the palm off its side.
      support: cradle([0, 0.0965, -0.3], [0.019, 0.0285, 0.08], "gun", 0.035),
      mag: magGrip([0, -0.022, -0.124], [0.0134, 0.056, 0.03], 0.18),
      // From the left, so the arm stays out of the view: fingers over the T-handle at the rear.
      charge: {
        part: { center: [0, 0.115, 0.023], half: [0.026, 0.008, 0.007], round: 0.006 },
        palm: [-0.042, 0.082, 0.03],
        facing: [1, 0.25, 0],
        thumbSide: [0, 0, 1],
        thumb: [-0.2, -0.2, 1],
      },
    },
  },
  smg: {
    right: { grip: { ...pistolGrip([0, 0.0037, 0.003], [0.0135, 0.045, 0.024], -0.36, [0.5, 1.05, 0.55]), thumb: [0.1, 0.15, -1] } },
    left: {
      support: cradle([0, 0.085, -0.235], [0.0285, 0.031, 0.06], "gun", 0.015),
      mag: magGrip([0, -0.0245, -0.1187], [0.0105, 0.055, 0.027], 0.17),
      charge: {
        part: { center: [0, 0.1075, 0.023], half: [0.021, 0.006, 0.006], round: 0.005 },
        palm: [-0.034, 0.075, 0.03],
        facing: [1, 0.25, 0],
        thumbSide: [0, 0, 1],
        thumb: [-0.2, -0.2, 1],
      },
    },
  },
  shotgun: {
    right: {
      // The stock's wrist: fingers wrap under it, thumb over the top.
      grip: {
        part: { center: [0, -0.004, 0.005], half: [0.013, 0.019, 0.04], round: 0.01, pitch: 0.16 },
        palm: [0.028, -0.004, 0.015],
        facing: [-1, 0, 0],
        thumbSide: [0, 0.45, -0.9],
        thumb: [-0.5, 0.3, -1],
        trigger: [0.25, 0.6, 0.3],
      },
    },
    left: {
      support: cradle([0, 0.006, -0.32], [0.015, 0.025, 0.093], "pump", 0.04),
      // Under the loading port, fingers across it pushing the shell up and in.
      shell: (() => {
        const port = SHELL_SEATS.shotgun!.port;
        return {
          part: { center: port, half: [0.011, 0.011, 0.03], round: 0.012 },
          palm: [port[0] - 0.021, port[1] - 0.013, port[2] + 0.02] as V3,
          facing: [0.6, 1, 0] as V3,
          thumbSide: [-0.25, 0.1, -1] as V3,
          thumb: [-0.1, 0.05, -1] as V3,
          frame: "shell" as const,
        };
      })(),
    },
  },
  sniper: {
    right: {
      grip: { ...pistolGrip([0, -0.073, 0.021], [0.0175, 0.05, 0.024], -0.59, [0.3, 0.8, 0.4]), thumb: [0.1, 0.15, -1] },
      // In from the right, fingers over the cocking knob. The part reaches in to the receiver's side,
      // so fingers stop on its surface instead of curling into it; the thumb rides above.
      bolt: {
        part: { center: [0, -0.03, -0.13], half: [0.038, 0.07, 0.08], round: 0.006 },
        palm: [0.045, 0, -0.08],
        facing: [-1, 0, 0],
        thumbSide: [0, 1, 0],
        thumb: [0.3, 0.7, 0.3],
        frame: "bolt",
      },
    },
    left: {
      // Around the foregrip under the barrel.
      support: cradle([0, -0.035, -0.305], [0.0145, 0.035, 0.05], "gun", 0),
      mag: magGrip([0, -0.063, -0.172], [0.018, 0.03, 0.05], 0),
    },
  },
  pistol: {
    right: {
      grip: REVOLVER,
      // Thumb up on the hammer spur, rolling it back.
      cock: { ...REVOLVER, thumb: [-0.05, 0.75, 0.55] },
    },
    left: {
      // Never held in two hands: this is only where the arm hangs from (see BELT in handling.ts).
      support: {
        part: { center: [0.004, -0.012, -0.004], half: [0.032, 0.036, 0.03], round: 0.015, pitch: -0.42 },
        palm: [-0.046, -0.018, 0.006],
        facing: [1, 0.15, 0],
        thumbSide: [0, 0.55, -1],
        thumb: [-0.1, 0.3, -1],
      },
      // In from the left, behind the cylinder, a round pinched in the fingertips. The right of the
      // frame is where the gate is, but the gun hand fills that side.
      shell: {
        part: { center: [-0.0215, 0.0688, -0.06], half: [0.0075, 0.0075, 0.02], round: 0.005 },
        palm: [-0.072, 0.074, 0.034],
        facing: [1, 0, 0],
        thumbSide: [0, 1, 0],
        thumb: [-0.15, 0.5, -1],
        frame: "shell",
      },
    },
  },
};

const FINGERS = ["index", "middle", "ring", "pinky"] as const;
/** Joint limits (rad) from knuckle to tip. */
const MAX_CURL = [1.55, 1.9, 1.35];
const THUMB_MAX_CURL = [0.6, 0.8];
/** Gloved finger, bone to skin. */
const FINGER_RADIUS = 0.012;
/** Palm centre in the hand bone's frame: between wrist and middle knuckle, on the glove's palm (4 cm out). */
const PALM = [0.04, 0.065, -0.004] as const;
const STEP = 0.06;

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

const cache = new WeakMap<CharacterTemplate, Map<WeaponId, GripPose>>();

export function gripPose(template: CharacterTemplate, weapon: WeaponId): GripPose {
  let byWeapon = cache.get(template);
  if (!byWeapon) cache.set(template, byWeapon = new Map());
  let pose = byWeapon.get(weapon);
  if (!pose) byWeapon.set(weapon, pose = solveGrips(template, weapon));
  return pose;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);

/** Seated origin of a frame in weapon space. */
function frameOrigin(weapon: WeaponId, frame: HandFrame): V3 {
  if (frame === "gun") return [0, 0, 0];
  if (frame === "shell") return SHELL_SEATS[weapon]!.port;
  return WEAPON_PARTS[weapon]![frame]!.pivot;
}

function solveGrips(template: CharacterTemplate, weapon: WeaponId): GripPose {
  // Solve on a bind-pose copy whose hands are detached, so "world" here is weapon space.
  const inst = instantiateCharacter(template, 0);
  inst.root.updateMatrixWorld(true);
  const spec = GRIPS[weapon];
  const fingers = { r: [] as string[], l: [] as string[] };
  const solveSide = <K extends string>(side: "r" | "l", grips: Record<K, HandGrip>) => {
    const bone = inst.bones.get(`hand_${side}`)!;
    const scale = bone.getWorldScale(new THREE.Vector3());
    bone.removeFromParent();
    bone.scale.copy(scale);
    const b = (name: string) => inst.bones.get(`${name}_${side}`);
    const chains: { bones: THREE.Bone[]; trigger: boolean; thumb: boolean }[] = [];
    for (const f of FINGERS) {
      const found = [1, 2, 3, 4].map((j) => b(j === 4 ? `${f}_04_leaf` : `${f}_0${j}`));
      if (found.every(Boolean)) chains.push({ bones: found as THREE.Bone[], trigger: f === "index", thumb: false });
    }
    const thumb = ["thumb_01", "thumb_02", "thumb_03", "thumb_04_leaf"].map(b);
    if (thumb.every(Boolean)) chains.push({ bones: thumb as THREE.Bone[], trigger: false, thumb: true });
    const driven = chains.flatMap((c) => c.bones.slice(0, 3));
    fingers[side] = driven.map((x) => x.name);
    const bind = driven.map((x) => x.quaternion.clone());

    const poses = {} as Record<K, HandPose>;
    for (const name of Object.keys(grips) as K[]) {
      const g = grips[name];
      driven.forEach((x, i) => x.quaternion.copy(bind[i]));
      // Hand frame: +Y along the fingers, +Z toward the thumb, palm facing -X (right) / +X (left).
      const facing = _v.set(...g.facing).normalize();
      _x.copy(facing).multiplyScalar(side === "r" ? -1 : 1);
      _z.set(...g.thumbSide).projectOnPlane(_x).normalize();
      _y.crossVectors(_z, _x);
      bone.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(_x, _y, _z));
      const palm = _v2.set(side === "r" ? -PALM[0] : PALM[0], PALM[1], PALM[2]).multiply(scale).applyQuaternion(bone.quaternion);
      bone.position.set(...g.palm).sub(palm);
      bone.updateMatrixWorld(true);

      const sdf = partDistance(g.part);
      for (const chain of chains) {
        const bones = chain.bones;
        if (chain.thumb) aimThumb(bones, new THREE.Vector3(...g.thumb).normalize(), g.part);
        const first = chain.thumb ? 1 : 0;
        for (let j = first; j < 3; j++) {
          const fixed = chain.trigger ? g.trigger?.[j] : undefined;
          if (fixed !== undefined) curl(bones[j], fixed);
          else wrap(bones[j], bones[j + 1], chain.thumb ? THUMB_MAX_CURL[j - 1] : MAX_CURL[j], sdf);
        }
      }
      const frame = g.frame ?? "gun";
      const origin = frameOrigin(weapon, frame);
      poses[name] = {
        matrix: new THREE.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]).multiply(bone.matrixWorld),
        frame,
        fingers: driven.map((x) => x.quaternion.clone()),
      };
    }
    return poses;
  };
  const right = solveSide("r", spec.right as Record<RightPose, HandGrip>);
  const left = solveSide("l", spec.left as Record<LeftPose, HandGrip>);
  return { fingers, right, left };
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
