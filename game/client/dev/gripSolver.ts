import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { instantiateCharacter, type CharacterInstance, type CharacterTemplate } from "../assets/characters";
import { cloneWeapon, SHELL_SEATS, WEAPON_PARTS, type WeaponTemplates } from "../assets/weapons";
import type { WeaponId } from "../../shared/weapons";
import { COCK_ANGLE } from "../player/CharacterRig";
import type { BakedGrip, BakedHand, HandFrame, LeftPose, RightPose } from "../player/grip";

/**
 * Solves how each gun is held, against the real meshes: the hand is pushed onto the gun until the
 * glove's skin meets its surface, then every finger closes until each of its segments touches.
 * Too slow to run while playing, so scripts/dev/grip-bake.ts runs it once in the rig viewer and
 * writes the poses to game/shared/generated/grips.json.
 */

type V3 = readonly [number, number, number];

/** Rounded box in weapon space (grip at the origin, muzzle toward -Z), pitched about X. */
interface Part { center: V3; half: V3; round: number; pitch?: number }

/**
 * How a hand may be moved off where its hold aims it, to find where most of it lies on the gun:
 * turned (rad) about its thumb axis, its finger axis and its palm normal, and shifted (m) along
 * its fingers and across them.
 */
interface Fit { yaw: number; roll: number; tilt: number; along: number; across: number }

interface HandGrip {
  /** Roughly what the hand is on: the thumb bends toward its centre. For `against` "part" or "both" it is solid. */
  part: Part;
  /** Where the centre of the palm presses, weapon space. The hand starts off the gun and is pushed on. */
  palm: V3;
  /** Palm normal, pointing from the palm into the gun. */
  facing: V3;
  /** Rough direction from the little finger toward the index finger. */
  thumbSide: V3;
  /** Where the thumb points before it is pressed onto the gun. */
  thumb: V3;
  /** How far (rad) the thumb may stray sideways from there to find the gun, where not 0.6 of `THUMB_SWING`: small keeps it at the height it was aimed. */
  thumbAside?: number;
  /** Fixed index curls (knuckle → tip) for a trigger finger instead of wrapping it. */
  trigger?: readonly [number, number, number];
  /** Where the pad of the index finger rests on the trigger; solved instead of `trigger` curls. */
  triggerAt?: V3;
  /** Where the pad of the thumb rests, e.g. on a hammer spur; solved instead of laying the thumb along the gun. */
  thumbAt?: V3;
  /** The hammer rolled back this far (rad) from fallen, where the bake's gun has it: `thumbAt` is on the fallen spur and rolls with it. */
  hammer?: number;
  /**
   * How far (m) the palm is pressed on past first touching the gun. The glove's palm is thickly
   * padded: resting on its pads, the knuckles stand well off a narrow grip and the fingers cannot
   * get round it. Pressed in, as padding gives under a firm hold, the pads are out of sight inside the grip.
   */
  press?: number;
  /** How far the hand may be moved from this hold while fitting it to the gun, where not `SEARCH`; 0 keeps it as aimed. */
  search?: Partial<Fit>;
  /** What the hand closes on: the gun's mesh, only `part` (a hand that is off the gun), or both (a round held at the gun). */
  against?: "gun" | "part" | "both";
  frame?: HandFrame;
}

const rotX = (v: V3, a: number): V3 => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * Right hand around a pistol grip raked back by `pitch`, the pad of the index finger on the
 * trigger at `triggerAt`. As a rifle is really held: the knuckles lie along the grip's right
 * side, not at its front corner, so the fingers run forward before they turn round the front
 * strap and the index can come back onto the trigger; the web of the hand is behind the
 * backstrap, and the thumb comes round it onto the left side, which is the side the player sees.
 */
function pistolGrip(center: V3, half: V3, pitch: number, triggerAt: V3, thumb?: V3, back = 0.016): HandGrip {
  return {
    part: { center, half, round: 0.009, pitch },
    palm: add(center, rotX([half[0] + 0.015, 0.001, half[2] + back], pitch)),
    facing: rotX([-1, 0, 0.15], pitch),
    thumbSide: rotX([0, 1, 0], pitch),
    // Across behind the grip and forward; from there it is swung and bent round the far corner.
    thumb: thumb ?? rotX([-0.8, 0, -0.6], pitch),
    triggerAt,
    press: 0.006,
    // How high the hand sits is set by the trigger guard over the middle finger, not by what fits best.
    search: { yaw: 0, roll: 0, tilt: 0, along: 0, across: 0 },
  };
}

/**
 * Support hand under the left of a handguard (or pump, or forend), as a shooter holds one: the hand
 * points along the gun with the index knuckle on top, the palm turned up and in, and the fingers
 * curled up around the far side. The forearm comes up from below, so the wrist bends (~60°) instead
 * of running straight on from it. `back` slides the palm toward the receiver, which keeps the
 * support elbow bent.
 */
function cradle(center: V3, half: V3, frame?: HandFrame, back = 0, thumb: V3 = THUMB_ALONG): HandGrip {
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
    thumb,
    frame,
  };
}
/**
 * A cradling hand's thumb: forward along the gun's near side and up toward its top edge, where the
 * player sees it. Reaching right up and over the top pulls it so far from where a thumb sits
 * that the glove stretches into something like a worm.
 */
const THUMB_ALONG: V3 = [0.05, 0.55, -0.85];
/** Cradling palm normal: up and in. */
const CRADLE_FACING: V3 = [0.6, 1, 0];
/**
 * The hand lies on a slant, its fingers pointing forward as well as across under the gun: it
 * meets the forearm, which comes up and forward from the elbow, without a sharp bend at the wrist.
 */
const CRADLE_THUMB_SIDE: V3 = [-0.7, 0.41, -0.58];

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

/**
 * The revolver's plow handle: 32 mm wide, its front strap upright and its back sweeping away
 * below the hammer. The thumb lies across the top of the left grip panel, where it shows against the
 * wood: any higher and it is lost against the frame and the back of the hand.
 */
const REVOLVER: HandGrip = { ...pistolGrip([0, -0.025, 0.014], [0.016, 0.04, 0.027], -0.2, [0, 0.017, -0.066], [-0.78, 0.3, -0.55]), thumbAside: 0.12 };

/**
 * Thumbing the hammer back. A big gloved hand low on a plow handle cannot reach the spur from the
 * firing grip: as a real one does, it rides up the grip (the gun rolling down in it), the index
 * off the trigger, and the thumb's pad goes on top of the spur.
 */
const REVOLVER_COCK: HandGrip = {
  ...REVOLVER,
  thumbAt: [0, 0.109, -0.018],
  triggerAt: undefined,
  trigger: [0.25, 0.35, 0.25],
  search: { yaw: 0.2, roll: 0.3, tilt: 0.4, along: 0.03, across: 0.045 },
};

/**
 * Where each hand goes on each gun: the firing grip and support hold, plus the extra holds the
 * reload and cycling animations move through. These only aim the hand; contact is solved.
 */
const GRIPS: Record<WeaponId, { right: Partial<Record<RightPose, HandGrip>> & { grip: HandGrip }; left: Partial<Record<LeftPose, HandGrip>> & { support: HandGrip } }> = {
  ar: {
    right: {
      grip: pistolGrip([0, -0.0013, 0.0105], [0.0195, 0.058, 0.029], -0.5, [0, 0.033, -0.051]),
    },
    left: {
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
    right: { grip: pistolGrip([0, 0.0037, 0.003], [0.0135, 0.045, 0.024], -0.36, [0, 0.031, -0.05]) },
    left: {
      // Far enough forward that the little finger stays on the handguard, not in the gap before the mag well.
      support: cradle([0, 0.085, -0.235], [0.0285, 0.031, 0.06], "gun", -0.015),
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
        triggerAt: [0, -0.032, -0.079],
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
          against: "part" as const,
          frame: "shell" as const,
        };
      })(),
    },
  },
  sniper: {
    right: {
      // The stock runs on behind the grip as a bar, so the thumb cannot come round behind it: it lies forward along the top of the bar.
      grip: pistolGrip([0, -0.073, 0.021], [0.0175, 0.05, 0.024], -0.59, [0, -0.05, -0.058], [-0.35, 0.25, -0.9], 0.006),
      // The bolt knob is a stub 8 mm proud of the receiver's right side: pinched, as a real one is,
      // the index hooked under its front and the thumb's pad pressing on top, the other fingers
      // curled into the palm out of the way.
      bolt: {
        part: { center: [0.02, 0.005, -0.096], half: [0.008, 0.008, 0.008], round: 0.003 },
        palm: [0.02, -0.041, -0.04],
        facing: [-1, 0, 0],
        thumbSide: [0, 1, 0],
        thumb: [-0.2, 0.3, -0.9],
        triggerAt: [0.021, -0.008, -0.1],
        thumbAt: [0.021, 0.017, -0.094],
        against: "part",
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
      // Thumb on the fallen hammer's spur, then (cocked) on the same spur rolled back to full cock.
      cock: REVOLVER_COCK,
      cocked: { ...REVOLVER_COCK, hammer: COCK_ANGLE },
    },
    left: {
      // Never held in two hands: this is only where the arm hangs from (see BELT in handling.ts).
      support: {
        part: { center: [0.004, -0.012, -0.004], half: [0.032, 0.036, 0.03], round: 0.015, pitch: -0.42 },
        palm: [-0.046, -0.018, 0.006],
        facing: [1, 0.15, 0],
        thumbSide: [0, 0.55, -1],
        thumb: [-0.1, 0.3, -1],
        against: "part",
      },
      // In from the left, behind the cylinder, a round pinched in the fingertips. The right of the
      // frame is where the gate is, but the gun hand fills that side.
      shell: {
        part: { center: [-0.0215, 0.0688, -0.06], half: [0.0075, 0.0075, 0.02], round: 0.005 },
        palm: [-0.072, 0.074, 0.034],
        facing: [1, 0, 0],
        thumbSide: [0, 1, 0],
        thumb: [-0.15, 0.5, -1],
        against: "part",
        frame: "shell",
      },
    },
  },
};

const FINGERS = ["index", "middle", "ring", "pinky"] as const;
/** Joint limits (rad) from knuckle to tip. Fingers close with every joint the same share of the way to its limit. */
const MAX_CURL = [1.55, 1.9, 1.35];
const THUMB_MAX_CURL = [0.6, 0.8];
/** Palm centre in the hand bone's frame: between wrist and middle knuckle, on the glove's palm (4 cm out). */
const PALM = [0.04, 0.065, -0.004] as const;
/** Skin this close to the gun (m) is touching it. */
const CONTACT = 0.0005;
/** A finger's bone never comes closer than this (m) to the gun, whatever its skin does between vertices. */
const CORE = 0.0045;
/** Share of a finger's full curl closed per step: its tip moves well under a millimetre. */
const CURL_STEP = 0.003;
/** Distance the hand moves per step while it is pushed onto the gun (m). */
const SEAT_STEP = 0.0005;
/** The hand starts this far off the gun (m) before it is pushed on. */
const SEAT_BACK = 0.03;
/** Skin this close to the gun (m) counts as lying on it, in a bake's report. */
const ON = 0.0015;
/** Skin deeper than this inside the gun (m) counts against a hold. */
const SUNK = 0.001;
/** A part of the hand this far off the gun (m) is as good as not holding it at all. */
const LOOSE = 0.015;
/** The thumb is what the player sees most of, lying on the near side of the gun: it weighs more than a finger segment. */
const THUMB_WEIGHT = 1.5;
/** How far a hand is moved, unless its hold says otherwise, to find where it fits the gun best. */
const SEARCH: Fit = { yaw: 0.35, roll: 0.25, tilt: 0.15, along: 0.02, across: 0.008 };
/** Beyond this the gun is simply far away (m). */
const FAR = 0.06;
/** Closer than this (m), whether a point is inside the gun is worked out; further off it is taken to be outside. */
const SIGN_WITHIN = 0.004;
/** How far the thumb may swing (rad) to reach the gun, or to get out of it. */
const THUMB_SWING = 0.7;

/** Signed distance to what is held (m): negative inside. `sure` works out the sign however far the point is. */
type Field = (p: THREE.Vector3, sure?: boolean) => number;

/** Rays out of a point: one that escapes the gun in any of these is outside it. */
const DIRECTIONS = (() => {
  const out: THREE.Vector3[] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    const axes = Math.abs(x) + Math.abs(y) + Math.abs(z);
    if (axes === 1 || axes === 3) out.push(new THREE.Vector3(x, y, z).normalize());
  }
  return out;
})();

/** The gun as the player sees it up close, everything seated, as one triangle soup in weapon space. */
function gunSurface(templates: WeaponTemplates, weapon: WeaponId) {
  const gun = cloneWeapon(templates, weapon, true);
  gun.updateMatrixWorld(true);
  const positions: number[] = [];
  const v = new THREE.Vector3();
  gun.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // The rifle's rail scope is only there with a magnified optic; hands are fitted to the bare gun.
    for (let a: THREE.Object3D | null = mesh; a; a = a.parent) if (a.name === "scope" && weapon !== "sniper") return;
    const p = mesh.geometry.getAttribute("position"), index = mesh.geometry.getIndex();
    const n = index ? index.count : p.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new MeshBVH(geometry);
}

function gunField(bvh: MeshBVH): Field {
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const ray = new THREE.Ray();
  return (p, sure = false) => {
    const found = bvh.closestPointToPoint(p, hit, 0, FAR);
    if (!found) return FAR;
    const d = found.distance;
    if (!sure && d > SIGN_WITHIN) return d;
    ray.origin.copy(p);
    for (const dir of DIRECTIONS) {
      ray.direction.copy(dir);
      if (!bvh.raycastFirst(ray, THREE.DoubleSide)) return d;
    }
    return -d;
  };
}

/**
 * A field sampled on a millimetre grid as it is asked for, and read back between the samples.
 * Fitting a hand asks about the same space over and over; this answers a hundred times faster.
 */
function cached(field: Field): Field {
  const CELL = 0.001;
  // Blocks of 32 x 32 x 32 samples, made when first touched.
  const blocks = new Map<number, Float32Array>();
  let lastKey = NaN, last: Float32Array | undefined;
  const q = new THREE.Vector3();
  const node = (ix: number, iy: number, iz: number) => {
    const key = ((ix >> 5) + 512) + ((iy >> 5) + 512) * 1024 + ((iz >> 5) + 512) * 1048576;
    if (key !== lastKey) {
      last = blocks.get(key);
      if (!last) blocks.set(key, last = new Float32Array(32768).fill(NaN));
      lastKey = key;
    }
    const i = (ix & 31) + ((iy & 31) << 5) + ((iz & 31) << 10);
    let d = last![i];
    if (d !== d) {
      const block = last!;
      block[i] = d = field(q.set(ix * CELL, iy * CELL, iz * CELL), true);
    }
    return d;
  };
  return (p) => {
    const fx = p.x / CELL, fy = p.y / CELL, fz = p.z / CELL;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const x00 = node(ix, iy, iz) * (1 - tx) + node(ix + 1, iy, iz) * tx;
    const x10 = node(ix, iy + 1, iz) * (1 - tx) + node(ix + 1, iy + 1, iz) * tx;
    const x01 = node(ix, iy, iz + 1) * (1 - tx) + node(ix + 1, iy, iz + 1) * tx;
    const x11 = node(ix, iy + 1, iz + 1) * (1 - tx) + node(ix + 1, iy + 1, iz + 1) * tx;
    return (x00 * (1 - ty) + x10 * ty) * (1 - tz) + (x01 * (1 - ty) + x11 * ty) * tz;
  };
}

function partField(part: Part): Field {
  const inv = new THREE.Matrix4().compose(
    new THREE.Vector3(...part.center),
    new THREE.Quaternion().setFromAxisAngle(AXIS_X, part.pitch ?? 0),
    new THREE.Vector3(1, 1, 1),
  ).invert();
  const p = new THREE.Vector3();
  const r = part.round;
  const [hx, hy, hz] = part.half;
  return (point) => {
    p.copy(point).applyMatrix4(inv);
    const qx = Math.abs(p.x) - hx + r, qy = Math.abs(p.y) - hy + r, qz = Math.abs(p.z) - hz + r;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return outside + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
}

/** A point of the glove's skin, as the bones carry it. */
interface SkinVert { bones: THREE.Bone[]; weights: number[]; locals: THREE.Vector3[] }

const _t = new THREE.Vector3();
function skinPosition(vert: SkinVert, out: THREE.Vector3) {
  out.set(0, 0, 0);
  for (let k = 0; k < vert.bones.length; k++) out.addScaledVector(_t.copy(vert.locals[k]).applyMatrix4(vert.bones[k].matrixWorld), vert.weights[k]);
  return out;
}

/**
 * The skin of one hand, grouped by the bone that moves each vertex most. The forearm's share of
 * a wrist vertex is given to the hand: the hand is solved on its own, detached from the arm.
 */
function handSkin(inst: CharacterInstance, hand: THREE.Bone) {
  const chain = new Set<THREE.Object3D>();
  hand.traverse((o) => { chain.add(o); });
  const byBone = new Map<string, SkinVert[]>();
  const seen = new Set<string>();
  const v = new THREE.Vector3();
  for (const mesh of inst.meshes) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position"), skinIndex = geometry.getAttribute("skinIndex"), skinWeight = geometry.getAttribute("skinWeight");
    if (!position || !skinIndex || !skinWeight) continue;
    const { bones, boneInverses } = mesh.skeleton;
    const handIndex = bones.indexOf(hand);
    if (handIndex < 0) continue;
    for (let i = 0; i < position.count; i++) {
      let lead = -1, leadWeight = 0;
      const shares = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(i, k);
        if (w <= 0) continue;
        const b = skinIndex.getComponent(i, k);
        if (w > leadWeight) { leadWeight = w; lead = b; }
        const carried = chain.has(bones[b]) ? b : handIndex;
        shares.set(carried, (shares.get(carried) ?? 0) + w);
      }
      if (lead < 0 || !chain.has(bones[lead])) continue;
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
      const key = `${lead}|${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let total = 0;
      for (const w of shares.values()) total += w;
      const vert: SkinVert = { bones: [], weights: [], locals: [] };
      for (const [b, w] of shares) {
        vert.bones.push(bones[b]);
        vert.weights.push(w / total);
        vert.locals.push(v.clone().applyMatrix4(boneInverses[b]));
      }
      const name = bones[lead].name;
      let list = byBone.get(name);
      if (!list) byBone.set(name, list = []);
      list.push(vert);
    }
  }
  return byBone;
}

const _distances: number[] = [];
/**
 * 0..1: how nearly a piece of skin lies on the gun, by the quarter of it that is nearest. A round
 * finger lying along a surface has that much of its skin within a few millimetres; one that
 * only touches with its tip, or has sunk in, does not.
 */
function nearness(verts: SkinVert[], field: Field) {
  if (!verts.length) return 0;
  _distances.length = 0;
  for (const vert of verts) _distances.push(Math.abs(field(skinPosition(vert, _p))));
  _distances.sort((a, b) => a - b);
  return Math.max(0, 1 - _distances[Math.floor(_distances.length / 4)] / LOOSE);
}

const _p = new THREE.Vector3();
function closest(verts: SkinVert[], field: Field) {
  let min = Infinity;
  for (const vert of verts) min = Math.min(min, field(skinPosition(vert, _p)));
  return min;
}

/** How one hand pose came out, in millimetres: for checking a bake. Negative is inside the gun. */
export interface HandReport {
  /** Closest the palm's skin comes to the gun, and the share of the whole hand's inner skin lying on it. */
  palm: number; on: number;
  /** How the hand was moved from where its hold aimed it: yaw, roll, tilt (degrees), along, across (mm). */
  fit: number[];
  /** Closest skin of each finger segment, knuckle to tip. */
  fingers: Record<string, number[]>;
  /** How far the index finger's pad is from where it should rest on the trigger. */
  trigger?: number;
  /** How far the thumb's pad is from `thumbAt`. */
  thumb?: number;
  /** Deepest any skin sits inside the gun. */
  deepest: number;
  /** Where the wrist, the index and middle knuckles and the base of the thumb ended up, weapon space. */
  at: Record<string, number[]>;
}

export interface BakeResult { grip: BakedGrip; report: Record<string, HandReport>; ms: number }

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

/** Seated origin of a frame in weapon space. */
function frameOrigin(weapon: WeaponId, frame: HandFrame): V3 {
  if (frame === "gun") return [0, 0, 0];
  if (frame === "shell") return SHELL_SEATS[weapon]!.port;
  return WEAPON_PARTS[weapon]![frame]!.pivot;
}

interface Chain { name: string; bones: THREE.Bone[]; links: SkinVert[][]; trigger: boolean; thumb: boolean }

const round = (values: ArrayLike<number>, digits: number) => Array.from(values, (v) => Number(v.toFixed(digits)));

export function solveGrips(template: CharacterTemplate, templates: WeaponTemplates, weapon: WeaponId): BakeResult {
  const t0 = performance.now();
  // Solve on a bind-pose copy whose hands are detached, so "world" here is weapon space.
  const inst = instantiateCharacter(template, 0);
  inst.root.updateMatrixWorld(true);
  const spec = GRIPS[weapon];
  const gun = cached(gunField(gunSurface(templates, weapon)));
  const fingers = { r: [] as string[], l: [] as string[] };
  const report: Record<string, HandReport> = {};

  const solveSide = <K extends string>(side: "r" | "l", grips: Record<K, HandGrip>) => {
    const bone = inst.bones.get(`hand_${side}`)!;
    const skin = handSkin(inst, bone);
    const scale = bone.getWorldScale(new THREE.Vector3());
    bone.removeFromParent();
    bone.scale.copy(scale);
    const b = (name: string) => inst.bones.get(`${name}_${side}`);
    const link = (x: THREE.Bone) => skin.get(x.name) ?? [];
    const chains: Chain[] = [];
    for (const f of FINGERS) {
      const found = [1, 2, 3, 4].map((j) => b(j === 4 ? `${f}_04_leaf` : `${f}_0${j}`));
      if (!found.every(Boolean)) continue;
      const bones = found as THREE.Bone[];
      chains.push({ name: f, bones, links: [link(bones[0]), link(bones[1]), [...link(bones[2]), ...link(bones[3])]], trigger: f === "index", thumb: false });
    }
    const thumb = ["thumb_01", "thumb_02", "thumb_03", "thumb_04_leaf"].map(b);
    if (thumb.every(Boolean)) {
      const bones = thumb as THREE.Bone[];
      chains.push({ name: "thumb", bones, links: [link(bones[0]), link(bones[1]), [...link(bones[2]), ...link(bones[3])]], trigger: false, thumb: true });
    }
    const driven = chains.flatMap((c) => c.bones.slice(0, 3));
    fingers[side] = driven.map((x) => x.name);
    const bind = driven.map((x) => x.quaternion.clone());
    const handVerts = link(bone);
    const everything = [...handVerts, ...chains.flatMap((c) => c.links.flat())];

    const poses = {} as Record<K, BakedHand>;
    for (const name of Object.keys(grips) as K[]) {
      const g = grips[name];
      const part = partField(g.part);
      const field: Field = g.against === "part" ? part : g.against === "both" ? (p) => Math.min(gun(p), part(p)) : gun;
      // Hand frame: +Y along the fingers, +Z toward the thumb, palm facing -X (right) / +X (left).
      const facing = new THREE.Vector3(...g.facing).normalize();
      _x.copy(facing).multiplyScalar(side === "r" ? -1 : 1);
      _z.set(...g.thumbSide).projectOnPlane(_x).normalize();
      _y.crossVectors(_z, _x);
      const aimed = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(_x, _y, _z));
      const along = _y.clone(), across = _z.clone();
      const palmAt = new THREE.Vector3(side === "r" ? -PALM[0] : PALM[0], PALM[1], PALM[2]).multiply(scale);
      const thumbDir = new THREE.Vector3(...g.thumb).normalize();
      const triggered = (c: Chain) => c.trigger && !!(g.triggerAt || g.trigger);
      const turn = new THREE.Quaternion();
      let palmVerts: SkinVert[] = [];
      // A pressed-in palm is meant to be in the gun; only the fingers and thumb must stay out of it.
      const visible = g.press ? chains.flatMap((c) => c.links.flat()) : everything;
      let triggerMiss: number | undefined;
      let thumbMiss: number | undefined;

      /** Poses the whole hand for one way of fitting it: placed, pushed onto the gun, thumb laid on, fingers wrapped. */
      const pose = (fit: Fit, thorough = false) => {
        driven.forEach((x, i) => x.quaternion.copy(bind[i]));
        turn.setFromAxisAngle(AXIS_Z, fit.yaw).multiply(_q.setFromAxisAngle(AXIS_Y, fit.roll)).multiply(_q.setFromAxisAngle(AXIS_X, fit.tilt));
        bone.quaternion.copy(aimed).multiply(turn);
        facing.set(side === "r" ? -1 : 1, 0, 0).applyQuaternion(bone.quaternion);
        bone.position.set(...g.palm).addScaledVector(along, fit.along).addScaledVector(across, fit.across).sub(_v.copy(palmAt).applyQuaternion(bone.quaternion));
        bone.updateMatrixWorld(true);
        if (g.against !== "part") {
          // Onto the gun palm first, from well off it.
          const move = (by: number) => { bone.position.addScaledVector(facing, by); bone.updateMatrixWorld(true); };
          move(-SEAT_BACK);
          let moved = 0;
          for (const step of [SEAT_STEP * 4, SEAT_STEP]) {
            for (; moved < SEAT_BACK * 2; moved += step) {
              move(step);
              if (closest(palmVerts, field) < CONTACT) { move(-step); break; }
            }
          }
          if (g.press) move(g.press);
        }
        for (const chain of chains) {
          if (chain.thumb && g.thumbAt) thumbMiss = reachThumb(chain, onHammer(g.thumbAt, g.hammer ?? 0), field);
          else if (chain.thumb) { aimThumb(chain.bones, thumbDir, g.part); pressThumb(chain, thumbDir, g.part, field, thorough, g.press, g.thumbAside); }
          else if (chain.trigger && g.triggerAt) triggerMiss = reachTrigger(chain, new THREE.Vector3(...g.triggerAt));
          else if (chain.trigger && g.trigger) g.trigger.forEach((angle, j) => curl(chain.bones[j], angle));
          else closeFinger(chain, field);
        }
      };
      /** The skin that should end up on the gun: the palm, the thumb and the fingers that wrap it. */
      const inner = () => [...palmVerts, ...chains.filter((c) => !triggered(c)).flatMap((c) => c.links.flat())];
      /**
       * How good a hold is. Every segment of every wrapping finger, the thumb and the palm each add
       * up to 1 the nearer its inner side lies to the gun; skin sunk into the gun, a missed trigger
       * and straying from the hold that was aimed for take away.
       */
      const judge = (fit: Fit) => {
        pose(fit);
        let score = 2 * nearness(palmVerts, field);
        for (const chain of chains) {
          if (triggered(chain)) continue;
          for (const verts of chain.links) score += (chain.thumb ? THUMB_WEIGHT : 1) * nearness(verts, field);
        }
        let sunk = 0;
        for (const vert of visible) if (field(skinPosition(vert, _p)) < -SUNK) sunk++;
        return score - sunk * 0.2 - (g.triggerAt ? (triggerMiss ?? 0) * 300 : 0) - (g.thumbAt ? (thumbMiss ?? 0) * 300 : 0)
          - (Math.abs(fit.yaw) + Math.abs(fit.roll) + Math.abs(fit.tilt)) * 0.6 - (Math.abs(fit.along) + Math.abs(fit.across)) * 12;
      };

      let best: Fit = { yaw: 0, roll: 0, tilt: 0, along: 0, across: 0 };
      // Which skin is the palm's: what faces the gun, the hand as first aimed.
      bone.quaternion.copy(aimed);
      bone.position.set(0, 0, 0);
      bone.updateMatrixWorld(true);
      palmVerts = handVerts.filter((vert) => skinPosition(vert, _p).dot(facing) > 0.012);
      if (g.against !== "part") {
        const reach = { ...SEARCH, ...g.search };
        let bestScore = judge(best);
        for (const share of [0.5, 0.25]) {
          for (const key of Object.keys(reach) as (keyof Fit)[]) {
            if (!reach[key]) continue;
            for (const d of [-2, -1, 1, 2]) {
              const tried = { ...best, [key]: best[key] + d * share * reach[key] };
              if (Math.abs(tried[key]) > reach[key] + 1e-9) continue;
              const score = judge(tried);
              if (score > bestScore) { bestScore = score; best = tried; }
            }
          }
        }
      }
      pose(best, true);

      const frame = g.frame ?? "gun";
      const origin = frameOrigin(weapon, frame);
      poses[name] = {
        frame,
        m: round(new THREE.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]).multiply(bone.matrixWorld).elements, 6),
        f: round(driven.flatMap((x) => x.quaternion.toArray()), 5),
      };
      const mm = (m: number) => Math.round(m * 10000) / 10;
      const skinIn = inner();
      report[`${side === "r" ? "right" : "left"}.${name}`] = {
        palm: mm(closest(palmVerts, field)),
        on: Math.round((skinIn.filter((vert) => field(skinPosition(vert, _p)) < ON).length / Math.max(1, skinIn.length)) * 100),
        fit: [best.yaw, best.roll, best.tilt].map((r) => Math.round((r * 180) / Math.PI)).concat([best.along, best.across].map((m) => Math.round(m * 1000))),
        fingers: Object.fromEntries(chains.map((c) => [c.name, c.links.map((verts) => mm(closest(verts, field)))])),
        ...(triggerMiss === undefined || !g.triggerAt ? {} : { trigger: mm(triggerMiss) }),
        ...(thumbMiss === undefined || !g.thumbAt ? {} : { thumb: mm(thumbMiss) }),
        deepest: mm(Math.min(0, closest(visible, field))),
        at: Object.fromEntries([["wrist", bone], ["index", b("index_01")], ["middle", b("middle_01")], ["thumb", b("thumb_01")]]
          .map(([key, x]) => [key as string, new THREE.Vector3().setFromMatrixPosition((x as THREE.Bone).matrixWorld).toArray().map((v) => Math.round(v * 1000))])
          .concat(g.triggerAt ? [["pad", lastReach.pad], ["reach", lastReach.angles]] : [])),
      };
    }
    return poses;
  };
  /** A point on the fallen hammer, where it is once the hammer has rolled back `angle`. */
  const onHammer = (point: V3, angle: number) => {
    const at = new THREE.Vector3(...point);
    if (!angle) return at;
    const gun = cloneWeapon(templates, weapon, true);
    gun.updateMatrixWorld(true);
    const hammer = gun.getObjectByName("hammer");
    if (!hammer) return at;
    const fallen = hammer.matrixWorld.clone().invert();
    hammer.rotation.x += angle;
    hammer.updateMatrixWorld(true);
    return at.applyMatrix4(fallen).applyMatrix4(hammer.matrixWorld);
  };
  const right = solveSide("r", spec.right as Record<RightPose, HandGrip>);
  const left = solveSide("l", spec.left as Record<LeftPose, HandGrip>);
  return { grip: { fingers, right, left }, report, ms: Math.round(performance.now() - t0) };
}

function curl(bone: THREE.Object3D, angle: number) {
  bone.quaternion.multiply(_q.setFromAxisAngle(AXIS_X, angle));
  bone.updateMatrixWorld(true);
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
/** Whether segment `j` of a finger is on the gun: its skin touching, or its bone about to go through an edge. */
function touching(chain: Chain, j: number, field: Field) {
  for (const vert of chain.links[j]) if (field(skinPosition(vert, _p)) < CONTACT) return true;
  _a.setFromMatrixPosition(chain.bones[j].matrixWorld);
  _b.setFromMatrixPosition(chain.bones[j + 1].matrixWorld);
  for (const k of [0.3, 0.6, 0.9]) if (field(_p.lerpVectors(_a, _b, k)) < CORE) return true;
  return false;
}

/**
 * Wraps a finger round the gun a joint at a time, knuckle first: each joint bends until the
 * segment it carries (or one beyond it) meets the surface, so every segment ends up lying on the
 * gun instead of only the fingertip reaching it. A finger swung in dead straight can catch
 * its tip on something well past what it is meant to hold, so it is also tried starting part
 * curled, as a hand closes; whichever start leaves most of the finger on the gun is kept.
 */
function closeFinger(chain: Chain, field: Field, limits = MAX_CURL, first = 0) {
  const bones = chain.bones;
  const base = bones.slice(0, 3).map((x) => x.quaternion.clone());
  const angle = [0, 0, 0];
  const set = (j: number, to: number) => { angle[j] = to; bones[j].quaternion.copy(base[j]).multiply(_q.setFromAxisAngle(AXIS_X, to)); bones[j].updateMatrixWorld(true); };
  const stopped = (j: number) => { for (let k = j; k < 3; k++) if (touching(chain, k, field)) return true; return false; };
  let best: number[] | null = null, bestScore = -Infinity;
  for (const start of first === 0 ? [0, 0.25, 0.5, 0.75] : [0]) {
    for (let j = 2; j >= first; j--) set(j, j > first ? start * limits[j - first] : 0);
    if (start > 0 && stopped(first)) continue;
    for (let j = first; j < 3; j++) {
      if (stopped(j)) continue;
      const limit = limits[j - first], step = CURL_STEP * limit;
      // In big steps until it meets the gun, then the last of the way in small ones.
      let at = angle[j];
      for (const by of [step * 4, step]) {
        while (at + by <= limit) {
          set(j, at + by);
          if (stopped(j)) break;
          at += by;
        }
      }
      set(j, at);
    }
    let score = 0;
    for (let j = first; j < 3; j++) score += nearness(chain.links[j], field);
    if (score > bestScore + 1e-6) { bestScore = score; best = [...angle]; }
  }
  if (best) for (let j = 2; j >= first; j--) set(j, best[j]);
}

/** Curls and spreads the index finger so its pad rests at `target`, on the trigger. Returns how far it ends up from it. */
function reachTrigger(chain: Chain, target: THREE.Vector3) {
  const [knuckle, middle, tip, end] = chain.bones;
  const base = [knuckle, middle, tip].map((x) => x.quaternion.clone());
  const pose = (spread: number, a: number, b: number, follow: number) => {
    knuckle.quaternion.copy(base[0]).multiply(_q.setFromAxisAngle(AXIS_Z, spread)).multiply(_q.setFromAxisAngle(AXIS_X, a));
    middle.quaternion.copy(base[1]).multiply(_q.setFromAxisAngle(AXIS_X, b));
    // The last joint follows the middle one, as it does in a real finger: more or less, as the reach needs.
    tip.quaternion.copy(base[2]).multiply(_q.setFromAxisAngle(AXIS_X, Math.min(b * follow, MAX_CURL[2])));
    knuckle.updateMatrixWorld(true);
  };
  /** The pad: most of the way along the last segment, on its inner side. */
  const miss = () => {
    _a.setFromMatrixPosition(tip.matrixWorld);
    _b.setFromMatrixPosition(end.matrixWorld);
    const pad = _p.lerpVectors(_a, _b, 0.6).addScaledVector(_v.set(0, 0, 1).transformDirection(tip.matrixWorld), 0.007);
    return pad.distanceTo(target);
  };
  let best = { spread: 0, a: 0, b: 0, follow: 0.55, miss: Infinity };
  const search = (around: typeof best, span: number, step: number) => {
    let found = around;
    for (const follow of [0.2, 0.55, 0.9]) {
      for (let spread = Math.max(-0.6, around.spread - span); spread <= Math.min(0.45, around.spread + span); spread += step) {
        for (let a = Math.max(-0.25, around.a - span * 3); a <= Math.min(1.4, around.a + span * 3); a += step) {
          for (let b = Math.max(0, around.b - span * 3); b <= Math.min(1.7, around.b + span * 3); b += step) {
            pose(spread, a, b, follow);
            const m = miss();
            if (m < found.miss) found = { spread, a, b, follow, miss: m };
          }
        }
      }
    }
    return found;
  };
  best = search({ spread: 0, a: 0.6, b: 0.85, follow: 0.55, miss: Infinity }, 0.45, 0.05);
  best = search(best, 0.05, 0.01);
  pose(best.spread, best.a, best.b, best.follow);
  miss();
  lastReach = { pad: _p.toArray().map((v) => Math.round(v * 1000)), angles: [best.spread, best.a, best.b, best.follow].map((v) => Math.round(v * 100) / 100) };
  return best.miss;
}
/**
 * Swings and bends the thumb so its pad rests at `target` (a hammer spur, say), without sinking
 * any of it into the gun. Returns how far the pad ends up from it.
 */
function reachThumb(chain: Chain, target: THREE.Vector3, field: Field) {
  const [t1, t2, t3, end] = chain.bones;
  const start = [t1, t2, t3].map((x) => x.quaternion.clone());
  const base = new THREE.Vector3().setFromMatrixPosition(t1.matrixWorld);
  const dir = target.clone().sub(base).normalize();
  // Point the thumb at the target first; the search then works around that.
  const along = new THREE.Vector3().setFromMatrixPosition(t2.matrixWorld).sub(base).normalize();
  const aim = new THREE.Quaternion().setFromUnitVectors(along, dir);
  const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? _y.set(0, 1, 0) : _y.set(1, 0, 0)).normalize();
  const lift = new THREE.Vector3().crossVectors(side, dir);
  const swing = new THREE.Quaternion();
  const set = ([a, b, r, c2, c3]: number[]) => {
    t1.quaternion.copy(start[0]); t2.quaternion.copy(start[1]); t3.quaternion.copy(start[2]);
    swing.setFromAxisAngle(side, a).multiply(_q.setFromAxisAngle(lift, b)).multiply(_q.setFromAxisAngle(dir, r)).multiply(aim);
    rotateWorld(t1, swing);
    curl(t2, c2); curl(t3, c3);
    t1.updateMatrixWorld(true);
  };
  const miss = () => {
    _a.setFromMatrixPosition(t3.matrixWorld);
    _b.setFromMatrixPosition(end.matrixWorld);
    const pad = _p.lerpVectors(_a, _b, 0.6).addScaledVector(_v.set(0, 0, 1).transformDirection(t3.matrixWorld), 0.007);
    return pad.distanceTo(target);
  };
  const limits = [[-0.9, 0.9], [-0.9, 0.9], [-1.2, 1.2], [0, THUMB_MAX_CURL[0]], [0, THUMB_MAX_CURL[1]]];
  const cost = (params: number[]) => {
    set(params);
    const m = miss();
    const depth = Math.min(0, closest(chain.links[1], field), closest(chain.links[2], field));
    return m - depth * 5;
  };
  let best = [0, 0, 0, 0.2, 0.2], bestCost = cost(best);
  // Coarse starts first: rolled either way the bending side may face the gun or away from it.
  for (const r of [-0.9, -0.45, 0.45, 0.9]) {
    const tried = [0, 0, r, 0.3, 0.3], c = cost(tried);
    if (c < bestCost) { bestCost = c; best = tried; }
  }
  for (const step of [0.2, 0.1, 0.05, 0.02, 0.01]) {
    for (let improved = true; improved;) {
      improved = false;
      for (let k = 0; k < best.length; k++) {
        for (const d of [-step, step]) {
          const tried = best.slice();
          tried[k] = Math.min(limits[k][1], Math.max(limits[k][0], tried[k] + d));
          const c = cost(tried);
          if (c < bestCost - 1e-6) { bestCost = c; best = tried; improved = true; }
        }
      }
    }
  }
  set(best);
  return miss();
}

/** Where the last trigger reach left the index pad (mm, weapon space) and its spread/curl/curl/follow: for the bake report. */
let lastReach = { pad: [0, 0, 0], angles: [0, 0, 0, 0] };

/**
 * Lays the thumb on the gun: swung from where it was aimed until its skin meets the surface (or,
 * aimed into the gun, back out of it), then its two joints bent down onto it. With `thorough`
 * every way of swinging it near where it was aimed is tried, and the one kept is the one that
 * lays most of the thumb on the gun without any of it sinking in: a thumb is never left inside
 * the gun, where it would simply be missing from the hand.
 */
function pressThumb(chain: Chain, dir: THREE.Vector3, part: Part, field: Field, thorough = false, pressed = 0, sideways = THUMB_SWING * 0.6) {
  const [t1, t2, t3] = chain.bones;
  const base = _v.setFromMatrixPosition(t1.matrixWorld).clone();
  const toward = new THREE.Vector3(...part.center).sub(base).projectOnPlane(dir);
  if (toward.lengthSq() < 1e-8) { closeFinger(chain, field, THUMB_MAX_CURL, 1); return; }
  toward.normalize();
  const axis = new THREE.Vector3().crossVectors(dir, toward).normalize();
  const start = [t1, t2, t3].map((x) => x.quaternion.clone());
  const swing = new THREE.Quaternion();
  /** The thumb swung `to` toward the gun and `aside` across it (rad), not yet bent. */
  const set = (to: number, aside = 0) => {
    t2.quaternion.copy(start[1]); t3.quaternion.copy(start[2]);
    t1.quaternion.copy(start[0]);
    rotateWorld(t1, swing.setFromAxisAngle(axis, to).multiply(_q.setFromAxisAngle(toward, aside)));
  };
  const outer = [...chain.links[1], ...chain.links[2]];
  // The base of the thumb is part of the palm's padding: pressed into the grip with it, it may be as deep.
  const inside = () => closest(outer, field) < 0 || closest(chain.links[0], field) < -0.002 - pressed * 1.5;
  if (!thorough) {
    const step = 0.02;
    let angle = 0;
    if (inside()) {
      while (angle > -THUMB_SWING && inside()) set(angle -= step);
    } else {
      while (angle < THUMB_SWING && closest(outer, field) > CONTACT) {
        set(angle += step);
        if (inside()) { set(angle -= step); break; }
      }
    }
    closeFinger(chain, field, THUMB_MAX_CURL, 1);
    return;
  }
  let best = { to: 0, aside: 0, score: -Infinity };
  const judge = (to: number, aside: number) => {
    set(to, aside);
    if (inside()) return -Infinity;
    closeFinger(chain, field, THUMB_MAX_CURL, 1);
    // Straying from where the hold aimed the thumb costs a little, so it stays a thumb's place to be.
    return nearness(chain.links[1], field) + nearness(chain.links[2], field) + 0.4 * nearness(chain.links[0], field) - (Math.abs(to) + Math.abs(aside)) * 0.25;
  };
  for (const [span, step] of [[THUMB_SWING, 0.175], [0.12, 0.06], [0.04, 0.02]]) {
    const around = { ...best };
    for (let to = around.to - span; to <= around.to + span + 1e-9; to += step) {
      for (let aside = around.aside - span * 0.6; aside <= around.aside + span * 0.6 + 1e-9; aside += step) {
        if (Math.abs(to) > THUMB_SWING || Math.abs(aside) > sideways + 1e-9) continue;
        const score = judge(to, aside);
        if (score > best.score) best = { to, aside, score };
      }
    }
  }
  if (best.score === -Infinity) {
    // Nowhere near is clear of the gun: lift it off as far as it will go rather than leave it in.
    let angle = 0;
    while (angle > -THUMB_SWING * 1.5 && inside()) set(angle -= 0.02);
    return;
  }
  judge(best.to, best.aside);
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

/**
 * The gun seen from its left as rows of text, for finding where a trigger or a grip is: `#` is
 * solid across the whole slice `x` ± `halfWidth`, `+` part of it, `.` nothing.
 */
export function gunSideView(templates: WeaponTemplates, weapon: WeaponId, y: [number, number], z: [number, number], step = 0.0025, x = 0, halfWidth = 0.004) {
  const bvh = gunSurface(templates, weapon);
  const field = gunField(bvh);
  const rows: string[] = [];
  const p = new THREE.Vector3();
  for (let py = y[1]; py >= y[0] - 1e-9; py -= step) {
    let row = "";
    for (let pz = z[0]; pz <= z[1] + 1e-9; pz += step) {
      let solid = 0;
      for (const dx of [-halfWidth, 0, halfWidth]) if (field(p.set(x + dx, py, pz), true) < 0) solid++;
      row += solid === 3 ? "#" : solid ? "+" : ".";
    }
    rows.push(`${(py * 1000).toFixed(0).padStart(5)} ${row}`);
  }
  return rows.join("\n");
}

/** The gun's outline in a level slice at height `y`, seen from above: how wide a grip or handguard is there. */
export function gunTopView(templates: WeaponTemplates, weapon: WeaponId, y: number, x: [number, number], z: [number, number], step = 0.0025) {
  const field = gunField(gunSurface(templates, weapon));
  const rows: string[] = [];
  const p = new THREE.Vector3();
  for (let pz = z[0]; pz <= z[1] + 1e-9; pz += step) {
    let row = "";
    for (let px = x[0]; px <= x[1] + 1e-9; px += step) row += field(p.set(px, y, pz), true) < 0 ? "#" : ".";
    rows.push(`${(pz * 1000).toFixed(0).padStart(5)} ${row}`);
  }
  return rows.join("\n");
}

/**
 * Where the joints of the right hand are in its own frame, unposed (mm): +Y along the fingers,
 * +Z toward the thumb, the palm facing -X. With the skin's extent, for working out a hold.
 */
export function handLayout(template: CharacterTemplate) {
  const inst = instantiateCharacter(template, 0);
  inst.root.updateMatrixWorld(true);
  const hand = inst.bones.get("hand_r")!;
  const skin = handSkin(inst, hand);
  const toHand = hand.matrixWorld.clone().invert();
  const scale = hand.getWorldScale(new THREE.Vector3());
  const local = (p: THREE.Vector3) => p.applyMatrix4(toHand).multiply(scale).toArray().map((v) => Math.round(v * 1000));
  const joints: Record<string, number[]> = {};
  hand.traverse((o) => { if (o !== hand) joints[o.name] = local(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)); });
  const extent: Record<string, { n: number; min: number[]; max: number[] }> = {};
  for (const [name, verts] of skin) {
    const box = new THREE.Box3();
    for (const vert of verts) box.expandByPoint(new THREE.Vector3().fromArray(local(skinPosition(vert, new THREE.Vector3()))));
    extent[name] = { n: verts.length, min: box.min.toArray(), max: box.max.toArray() };
  }
  return { joints, extent };
}
