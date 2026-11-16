import * as THREE from "three";
import { raySphere, type HitPart, type PoseHit } from "../../shared/hitboxes";

type V3 = [number, number, number];

/** Which part a bone belongs to: the same split scripts/dev/hit-accuracy.ts measures against. */
export function bonePart(name: string): HitPart {
  return name === "Head" || name === "neck_01" ? "head" : /^(thigh|calf|foot|ball)/.test(name) ? "legs" : "body";
}

/** Static data per shared character geometry: bind-space positions, skin weights, triangles, parts. */
interface Baked {
  /** Positions with the bind matrix applied (x, y, z per vertex). */
  bound: Float32Array;
  index: Uint32Array;
  /** Four bone indices and weights per vertex. */
  bones: Uint16Array;
  weights: Float32Array;
  /** Part of each triangle, by its vertices' dominant bones (as the accuracy check scores it). */
  facePart: Uint8Array;
}

const PARTS: HitPart[] = ["head", "body", "legs"];
const baked = new WeakMap<THREE.BufferGeometry, Baked>();

function bake(mesh: THREE.SkinnedMesh): Baked {
  let b = baked.get(mesh.geometry);
  if (b) return b;
  const g = mesh.geometry;
  const pos = g.getAttribute("position"), si = g.getAttribute("skinIndex"), sw = g.getAttribute("skinWeight");
  const n = pos.count;
  const bound = new Float32Array(n * 3), bones = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  const vertexPart = new Uint8Array(n);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
    bound[i * 3] = v.x; bound[i * 3 + 1] = v.y; bound[i * 3 + 2] = v.z;
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k), j = si.getComponent(i, k);
      bones[i * 4 + k] = j; weights[i * 4 + k] = w;
      if (w > bw) { bw = w; best = j; }
    }
    vertexPart[i] = PARTS.indexOf(bonePart(mesh.skeleton.bones[best].name));
  }
  const index = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: n }, (_, i) => i);
  const facePart = new Uint8Array(index.length / 3);
  for (let f = 0; f < facePart.length; f++) {
    const a = vertexPart[index[f * 3]], pb = vertexPart[index[f * 3 + 1]], c = vertexPart[index[f * 3 + 2]];
    facePart[f] = pb === c ? pb : a;
  }
  b = { bound, index, bones, weights, facePart };
  baked.set(g, b);
  return b;
}

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3();
const _c: V3 = [0, 0, 0];
/** Around the pelvis, the reach of the body and anything it holds out (m): rays further away skip the mesh. */
const REACH = 1.25;

/**
 * A ray against the character exactly as drawn: the skinned triangles, posed by the same bone
 * matrices the GPU uses. Shots that visibly hit count, shots that visibly miss (between the legs,
 * past the arm, over the shoulder) do not. The mesh is skinned only when a ray comes near, and at
 * most once per posed frame (`invalidate` after each pose).
 */
export class MeshHit {
  private meshes: { mesh: THREE.SkinnedMesh; baked: Baked; world: Float32Array; boneWorld: Float32Array }[];
  private fresh = false;

  constructor(meshes: THREE.SkinnedMesh[], private pelvis: THREE.Object3D) {
    this.meshes = meshes.map((mesh) => {
      const b = bake(mesh);
      return { mesh, baked: b, world: new Float32Array(b.bound.length), boneWorld: new Float32Array(mesh.skeleton.bones.length * 16) };
    });
  }

  /** The character was posed again: skin again before the next ray. */
  invalidate() {
    this.fresh = false;
  }

  raycast(o: V3, dir: V3, maxDist: number): PoseHit | null {
    _p.setFromMatrixPosition(this.pelvis.matrixWorld);
    _c[0] = _p.x; _c[1] = _p.y; _c[2] = _p.z;
    const near = raySphere(o, dir, _c, REACH);
    if (near === null || near > maxDist) return null;
    if (!this.fresh) this.skin();
    let best = maxDist, part = -1;
    for (const { mesh, baked: b, world } of this.meshes) {
      if (!mesh.visible) continue;
      const idx = b.index;
      for (let f = 0, nf = idx.length / 3; f < nf; f++) {
        const t = rayTriangle(o, dir, world, idx[f * 3] * 3, idx[f * 3 + 1] * 3, idx[f * 3 + 2] * 3, best);
        if (t !== null) { best = t; part = b.facePart[f]; }
      }
    }
    return part < 0 ? null : { distance: best, part: PARTS[part] };
  }

  private skin() {
    this.fresh = true;
    for (const { mesh, baked: b, world, boneWorld } of this.meshes) {
      if (!mesh.visible) continue;
      // World matrix of each bone's skinning transform: matrixWorld * bindMatrixInverse * bone * boneInverse.
      const bones = mesh.skeleton.bones, inverses = mesh.skeleton.boneInverses;
      _inv.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
      for (let j = 0; j < bones.length; j++) {
        _m.multiplyMatrices(bones[j].matrixWorld, inverses[j]).premultiply(_inv);
        boneWorld.set(_m.elements, j * 16);
      }
      const { bound, bones: bi, weights } = b;
      for (let i = 0, n = bound.length / 3; i < n; i++) {
        const x = bound[i * 3], y = bound[i * 3 + 1], z = bound[i * 3 + 2];
        let wx = 0, wy = 0, wz = 0;
        for (let k = 0; k < 4; k++) {
          const w = weights[i * 4 + k];
          if (w === 0) continue;
          const e = bi[i * 4 + k] * 16;
          wx += w * (boneWorld[e] * x + boneWorld[e + 4] * y + boneWorld[e + 8] * z + boneWorld[e + 12]);
          wy += w * (boneWorld[e + 1] * x + boneWorld[e + 5] * y + boneWorld[e + 9] * z + boneWorld[e + 13]);
          wz += w * (boneWorld[e + 2] * x + boneWorld[e + 6] * y + boneWorld[e + 10] * z + boneWorld[e + 14]);
        }
        world[i * 3] = wx; world[i * 3 + 1] = wy; world[i * 3 + 2] = wz;
      }
    }
  }
}

/** Möller–Trumbore, both faces: distance along the unit ray to the triangle, if under `max`. */
function rayTriangle(o: V3, d: V3, p: Float32Array, a: number, b: number, c: number, max: number): number | null {
  const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
  const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-9 && det < 1e-9) return null;
  const inv = 1 / det;
  const tx = o[0] - p[a], ty = o[1] - p[a + 1], tz = o[2] - p[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t >= 0 && t < max ? t : null;
}
