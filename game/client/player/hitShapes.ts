import * as THREE from "three";
import { rayCapsule, raySphere, type HitPart, type PoseHit } from "../../shared/hitboxes";

type V3 = [number, number, number];

/**
 * Hit shapes riding on a character's animated skeleton, so a shot lands on what is drawn: the
 * head bobbing with the stride, bent over a low aim, or tilted out of a peek. A capsule runs
 * from one bone to the next (or to a point in the first bone's frame); radii are fitted to the
 * skinned mesh by scripts/dev/hit-accuracy.ts. Arms and shoulders count as the body.
 */
interface ShapeDef {
  part: HitPart;
  from: string;
  /** End bone, or a point (m) in `from`'s local frame. Omitted: a sphere at `at`. */
  to?: string | V3;
  /** Start point offset (m) in `from`'s local frame. */
  at?: V3;
  r: number;
}

// Head: a sphere over the skull and helmet (the Head bone sits at the base of the skull), and
// the neck. The torso is thick with the plate carrier, pouches and belt. Radii and the head offset
// are tuned by `scripts/dev/hit-accuracy.ts --tune --cover 3` against the soldier's skinned mesh,
// favouring cover: a shot that visibly lands on the soldier or the gear carried should count. 90.4% of rays score
// the part they visibly hit; visible hits that miss: head 1.7%, body 9.7% (loose gear such as the
// dump pouch), legs 2.1%; 7% of rays that pass within a few cm of the mesh score.
export const SHAPES: ShapeDef[] = [
  { part: "head", from: "Head", at: [0.005, 0.085, -0.03], r: 0.16 },
  { part: "head", from: "neck_01", to: "Head", r: 0.12 },
  { part: "body", from: "pelvis", to: "spine_02", r: 0.255 },
  { part: "body", from: "spine_02", to: "spine_03", r: 0.27 },
  { part: "body", from: "spine_03", to: "neck_01", r: 0.13 },
  // Across the shoulders and the hips: the torso is wider than it is deep.
  { part: "body", from: "clavicle_l", to: "clavicle_r", r: 0.08 },
  { part: "body", from: "thigh_l", to: "thigh_r", r: 0.085 },
  { part: "body", from: "clavicle_l", to: "upperarm_l", r: 0.075 },
  { part: "body", from: "clavicle_r", to: "upperarm_r", r: 0.075 },
  { part: "body", from: "upperarm_l", to: "lowerarm_l", r: 0.075 },
  { part: "body", from: "upperarm_r", to: "lowerarm_r", r: 0.07 },
  { part: "body", from: "lowerarm_l", to: "hand_l", r: 0.06 },
  { part: "body", from: "lowerarm_r", to: "hand_r", r: 0.06 },
  { part: "body", from: "hand_l", to: "middle_01_l", r: 0.06 },
  { part: "body", from: "hand_r", to: "middle_01_r", r: 0.055 },
  { part: "legs", from: "thigh_l", to: "calf_l", r: 0.135 },
  { part: "legs", from: "thigh_r", to: "calf_r", r: 0.15 },
  { part: "legs", from: "calf_l", to: "foot_l", r: 0.1 },
  { part: "legs", from: "calf_r", to: "foot_r", r: 0.1 },
  { part: "legs", from: "foot_l", to: "ball_l", r: 0.075 },
  { part: "legs", from: "foot_r", to: "ball_r", r: 0.07 },
  { part: "legs", from: "ball_l", to: "ball_leaf_l", r: 0.02 },
  { part: "legs", from: "ball_r", to: "ball_leaf_r", r: 0.025 },
];

/** Radius (m) of a sphere around the pelvis that holds every shape in any pose: a cheap reject. */
const REACH = 1.25;

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _pa: V3 = [0, 0, 0], _pb: V3 = [0, 0, 0];

interface Shape { part: HitPart; a: THREE.Bone; b: THREE.Bone | null; at: THREE.Vector3 | null; to: THREE.Vector3 | null; r: number }

export class HitShapes {
  private shapes: Shape[];
  private pelvis: THREE.Bone;

  constructor(bones: Map<string, THREE.Bone>, defs: ShapeDef[] = SHAPES) {
    this.pelvis = bones.get("pelvis")!;
    this.shapes = defs.map((d) => ({
      part: d.part, a: bones.get(d.from)!, r: d.r,
      b: typeof d.to === "string" ? bones.get(d.to)! : null,
      at: d.at ? new THREE.Vector3(...d.at) : null,
      to: Array.isArray(d.to) ? new THREE.Vector3(...d.to) : null,
    }));
  }

  /** Nearest hit of a ray (unit `dir`) against the shapes as last posed, within `maxDist`. */
  raycast(o: V3, dir: V3, maxDist: number): PoseHit | null {
    const p = _a.setFromMatrixPosition(this.pelvis.matrixWorld);
    _pa[0] = p.x; _pa[1] = p.y; _pa[2] = p.z;
    const near = raySphere(o, dir, _pa, REACH);
    if (near === null || near > maxDist) return null;
    let best: PoseHit | null = null;
    for (const s of this.shapes) {
      const a = s.at ? _a.copy(s.at).applyMatrix4(s.a.matrixWorld) : _a.setFromMatrixPosition(s.a.matrixWorld);
      _pa[0] = a.x; _pa[1] = a.y; _pa[2] = a.z;
      let t: number | null;
      if (!s.b && !s.to) t = raySphere(o, dir, _pa, s.r);
      else {
        const b = s.b ? _b.setFromMatrixPosition(s.b.matrixWorld) : _b.copy(s.to!).applyMatrix4(s.a.matrixWorld);
        _pb[0] = b.x; _pb[1] = b.y; _pb[2] = b.z;
        t = rayCapsule(o, dir, _pa, _pb, s.r);
      }
      if (t !== null && t <= maxDist && (!best || t < best.distance)) best = { distance: t, part: s.part };
    }
    return best;
  }
}
