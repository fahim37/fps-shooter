import fs from "node:fs";
import path from "node:path";
import { resolveObjectURL } from "node:buffer";
import sharp from "sharp";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { Document, type Material } from "@gltf-transform/core";
import { KHRMaterialsUnlit } from "@gltf-transform/extensions";
import { weld } from "@gltf-transform/functions";
import {
  RAW, PUBLIC_MODELS, GENERATED, writeGLB, buildCollision, writeCollisionBin, pieceBounds, writeJSON, compressTextures,
  type CollisionMesh, type PieceInfo,
} from "./common";

/**
 * "Chiba Arena": a low-poly remake of the X Games Chiba 2023 venue (Sketchfab), one FBX mesh of
 * a ballpark with a skate street course on a raised event floor in the middle. The event floor
 * (64 x 92 m) is the play area: the course's ramps, decks, ledges and rails in the middle, crowd
 * barriers around it, bleachers and booths on the sides. The stands and the ballpark's field
 * around it are backdrop.
 *
 * Built for low-end PCs first:
 * - The one source mesh is split into islands and sorted into tiers: solid chunks (collide),
 *   `Detail_` chunks (drink cans, skid and grind marks, logos: never collide, skipped on Low)
 *   and one `Arena_Backdrop` (stands, roof, field: unlit, so the baked stand lighting costs no
 *   lighting math, and never casts shadows).
 * - Materials whose texture is one flat color (most of the course) become one vertex-colored
 *   material: a few draw calls per chunk instead of a dozen.
 * - Textures are sized by what they cover (the source carries 4K bakes and 10 MB PNGs).
 *
 * For play:
 * - The crowd barriers are see-through railings: they stop players (`Clip_Arena`), not bullets.
 * - A board runs around the event floor, with a clip above it, so nobody leaves for the open
 *   field.
 * - Team spawns are picked on the real collision at the two ends, out of sight of each other.
 *
 * Put the downloaded pack at assets-raw/xgames-chiba (source/X_Games_Chiba_2023.fbx).
 */

const SRC = path.join(RAW, "xgames-chiba/source/X_Games_Chiba_2023.fbx");
/** Center of the event floor (source meters) becomes the origin. */
const CENTER: [number, number] = [1.6, 0];
/** Source height of the event floor's top, which becomes y = 0 (the game's ground plane). */
const FLOOR = 3.3;
/** Half the event floor's longer side, rounded up: the play area. */
export const ARENA_HALF = 47;
/** Chunk size for merged geometry, in meters. */
const CHUNK = 32;

/** The stadium around the event floor: baked stands and roof, banners, the ballpark's field. */
const BACKDROP = /^(stadium_bake|stands_bake|banner1|banner2|grassy1|asphalt|soil1)$/;
/** Baked stands and roof: drawn unlit, as baked. */
const UNLIT = /^(stadium_bake|stands_bake|banner1|banner2)$/;
/** Skid, grind and wear marks and logo cut-outs over the course: alpha tested, no collision. */
const DECAL = /^(xgames_alphas|moster_logo|wheel_marks|wallride_warks|grind_marks|wheel_marks_darker|wear_marks2)$/;
/** The street course's footprint [x0, x1, z0, z1], game space. */
const COURSE = [-11.5, 16, -29.6, 26.2];
/** Materials whose texture is (nearly) one color: drawn as vertex colors with one material. */
const FLAT = /^(paintboard1|cement_white|GROUND_BASE|monster_green|black_base|white_base|metal1\.001|black_wood|metal1)$/;
/** Islands smaller than this (bounding-box diagonal, m) are clutter: drink cans, bolts. */
const CLUTTER = 0.8;
/** Texture size by source material (default 256): bakes and the sign sheet stay sharpest. */
const TEXTURE_SIZE: Record<string, number> = {
  stadium_bake: 1024, stands_bake: 1024, texture_sheet1: 1024,
  banner1: 512, concrete_ground1: 512, cement2: 512, brick1: 512, wheel_marks: 512, wheel_marks_darker: 512,
  grind_marks: 512, xgames_alphas: 512, moster_logo: 512,
};

/**
 * The source's floor and course are near-white, which glares under the game's sun and hides
 * players against it: textured surfaces are darkened by these factors, flat colors capped at
 * `PAINT_MAX` (linear).
 */
const DARKEN: Record<string, number> = { concrete_ground1: 0.4, bleacher_tops: 0.6, cement2: 0.7 };
const PAINT_MAX = 0.42;

/**
 * Cover added to the open floor, for the north half (mirrored to the south): event road cases
 * and low staging walls in front of the course's ends, along the lanes beside the course and in
 * the corridors outside the barriers, so no lane is an open firing line end to end. [kind, x, z,
 * rotation (degrees)].
 */
const COVER: ["stack" | "wall", number, number, number][] = [
  ["wall", 1, -35, 0], ["stack", -17, -33, 0], ["stack", 19, -34, 0],
  ["stack", -16, -22, 90], ["wall", -15.5, -6, 90], ["stack", 20.5, -19, 90], ["wall", 19.5, -6, 90],
  ["stack", -29.6, -28, 90], ["stack", 29.6, -28, 90],
];
const CASE_COLOR: V3 = [0.022, 0.024, 0.028], WALL_COLOR: V3 = [0.16, 0.16, 0.15];

/** Materials whose primitives never collide: the see-through crowd barriers (clipped instead). */
const NO_COLLIDE = /^Arena_Barrier$/;
/** Perimeter board: height and thickness (m), and the clip above it. */
const BOARD_H = 1.05, BOARD_T = 0.12, CLIP_H = 7;
/** Barrier clips: footprint cell (m) and height. */
const BARRIER_CELL = 0.25, BARRIER_CLIP_H = 3;

type V3 = [number, number, number];
type Tier = "solid" | "detail" | "backdrop";

export async function importArena() {
  const src = await readFBX(SRC);
  const tris = src.mat.length;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const unlit = doc.createExtension(KHRMaterialsUnlit);

  // Materials: textured ones keep their texture, flat ones share Arena_Paint (vertex colors).
  const paint = doc.createMaterial("Arena_Paint").setMetallicFactor(0).setRoughnessFactor(0.85);
  const barrier = doc.createMaterial("Arena_Barrier").setMetallicFactor(0).setRoughnessFactor(0.6);
  const mats: { material: Material; color: V3 | null }[] = [];
  for (const m of src.materials) {
    if (FLAT.test(m.name)) {
      const peak = Math.max(...m.mean);
      mats.push({ material: paint, color: m.mean.map((c) => round3(peak > PAINT_MAX ? (c * PAINT_MAX) / peak : c)) as V3 });
      continue;
    }
    const size = TEXTURE_SIZE[m.name] ?? 256;
    const image = await sharp(m.image!).resize(size, size, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const texture = doc.createTexture(m.name).setImage(image).setMimeType("image/png");
    const material = doc.createMaterial(`Arena_${m.name}`).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(0.9);
    const dark = DARKEN[m.name];
    if (dark) material.setBaseColorFactor([dark, dark, dark, 1]);
    if (DECAL.test(m.name)) material.setAlphaMode("MASK").setAlphaCutoff(0.5);
    if (UNLIT.test(m.name)) material.setExtension("KHR_materials_unlit", unlit.createUnlit());
    mats.push({ material, color: null });
  }

  // Islands: triangles connected through shared corners.
  const islands = findIslands(src.pos);
  const box = new Map<number, { min: V3; max: V3 }>();
  for (let t = 0; t < tris; t++) {
    const b = box.get(islands[t]) ?? { min: [Infinity, Infinity, Infinity] as V3, max: [-Infinity, -Infinity, -Infinity] as V3 };
    for (let c = t * 9; c < t * 9 + 9; c += 3) for (let k = 0; k < 3; k++) {
      b.min[k] = Math.min(b.min[k], src.pos[c + k]);
      b.max[k] = Math.max(b.max[k], src.pos[c + k]);
    }
    box.set(islands[t], b);
  }

  // Every triangle into a piece (tier and chunk) and a material.
  const batches = new Map<string, Map<Material, Batch>>();
  const batchFor = (piece: string, material: Material) => {
    let byMat = batches.get(piece);
    if (!byMat) batches.set(piece, (byMat = new Map()));
    let b = byMat.get(material);
    if (!b) byMat.set(material, (b = { pos: [], nrm: [], uv: [], col: [] }));
    return b;
  };
  const barrierTris: number[] = [];
  for (let t = 0; t < tris; t++) {
    const name = src.materials[src.mat[t]].name;
    const { min, max } = box.get(islands[t])!;
    const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
    const size = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const outside = Math.abs(cx) > 34 || Math.abs(cz) > 48;
    const tier: Tier = BACKDROP.test(name) || outside ? "backdrop" : DECAL.test(name) || size < CLUTTER ? "detail" : "solid";
    // Crowd barriers: the railings standing on the floor around the course. The course's own
    // handrails (same material) and the bleachers' frames, at the floor's long edges, stay solid.
    const onCourse = cx > COURSE[0] && cx < COURSE[1] && cz > COURSE[2] && cz < COURSE[3];
    const isBarrier = tier === "solid" && name === "metal1" && Math.abs(cx) < 28 && !onCourse && min[1] < 0.2;
    if (isBarrier) barrierTris.push(t);
    const chunk = `${Math.floor(cx / CHUNK + 0.5)}_${Math.floor(cz / CHUNK + 0.5)}`;
    const piece = tier === "backdrop" ? "Arena_Backdrop" : tier === "detail" ? `Detail_Arena_${chunk}` : `Arena_${chunk}`;
    const { material, color } = mats[src.mat[t]];
    const b = batchFor(piece, isBarrier ? barrier : material);
    for (let c = t * 3; c < t * 3 + 3; c++) {
      b.pos.push(src.pos[c * 3], src.pos[c * 3 + 1], src.pos[c * 3 + 2]);
      b.nrm.push(src.nrm[c * 3], src.nrm[c * 3 + 1], src.nrm[c * 3 + 2]);
      if (color) b.col.push(...color, 1);
      else b.uv.push(src.uv[c * 2], src.uv[c * 2 + 1]);
    }
  }

  // The perimeter board, along the event floor's outer edge.
  const outline = floorOutline(src);
  const board = boardGeometry(outline);
  const boardBatch = batchFor("Arena_Board", paint);
  boardBatch.pos.push(...board.pos);
  boardBatch.nrm.push(...board.nrm);
  for (let i = 0; i < board.pos.length / 3; i++) boardBatch.col.push(...BOARD_COLOR, 1);
  // Cover, into the chunk's paint primitive (no extra draw calls).
  for (const [kind, x, z, deg] of COVER) for (const zz of [z, -z]) {
    const b = batchFor(`Arena_${Math.floor(x / CHUNK + 0.5)}_${Math.floor(zz / CHUNK + 0.5)}`, paint);
    const ry = (deg * Math.PI) / 180;
    const boxes: [number, number, number, number, number, number, V3][] = kind === "wall"
      // A low wall: cover for a crouching player, a standing one shoots over it.
      ? [[0, 0, 4, 0.6, 0, 1.1, WALL_COLOR]]
      // Road cases: a long one, a short one on top at one end (full cover, with a step).
      : [[0, 0, 2.4, 1.2, 0, 1, CASE_COLOR], [-0.55, 0.02, 1.2, 1.1, 1, 2.05, CASE_COLOR]];
    for (const [ox, oz, sx, sz, y0, y1, color] of boxes) {
      const g = boxGeometry(x + ox * Math.cos(ry) + oz * Math.sin(ry), zz - ox * Math.sin(ry) + oz * Math.cos(ry), sx, sz, y0, y1, ry);
      b.pos.push(...g.pos);
      b.nrm.push(...g.nrm);
      for (let i = 0; i < g.pos.length / 3; i++) b.col.push(...color, 1);
    }
  }

  // Build the document: one node per piece, one primitive per material.
  const scene = doc.createScene("arena");
  for (const name of [...batches.keys()].sort()) {
    const mesh = doc.createMesh(name);
    for (const [material, b] of batches.get(name)!) {
      const acc = (type: "VEC2" | "VEC3" | "VEC4", array: number[]) => doc.createAccessor().setType(type).setArray(new Float32Array(array)).setBuffer(buffer);
      const prim = doc.createPrimitive().setMaterial(material).setAttribute("POSITION", acc("VEC3", b.pos)).setAttribute("NORMAL", acc("VEC3", b.nrm));
      if (b.col.length) prim.setAttribute("COLOR_0", acc("VEC4", b.col));
      else prim.setAttribute("TEXCOORD_0", acc("VEC2", b.uv));
      mesh.addPrimitive(prim);
    }
    scene.addChild(doc.createNode(name).addChild(doc.createNode(`${name}_mesh`).setMesh(mesh)));
  }
  await doc.transform(weld());
  await compressTextures(doc, 1024, 84);
  const bytes = await writeGLB(doc, path.join(PUBLIC_MODELS, "arena.glb"));

  // Collision from the written document's triangles; the barriers and the perimeter are clips.
  const collision = new Map<string, CollisionMesh | null>();
  const info: Record<string, PieceInfo> = {};
  for (const piece of scene.listChildren()) {
    const name = piece.getName();
    if (!name.startsWith("Detail_") && name !== "Arena_Backdrop") collision.set(name, buildCollision(piece, NO_COLLIDE, 0.03));
    info[name] = pieceBounds(piece);
  }
  const clips = [...barrierClips(src, barrierTris), ...perimeterClips(outline)];
  collision.set("Clip_Arena", boxesMesh(clips));
  const { ranges, positionsByteLength } = writeCollisionBin(path.join(PUBLIC_MODELS, "arena.collision.bin"), collision);
  for (const [name, range] of ranges) (info[name] ??= boxBounds(clips)).col = range;

  const solid = new Surfaces([...collision].filter(([name, m]) => m && !name.startsWith("Clip_")).map(([, m]) => m!));
  const layout = playLayout(solid, clips, outline);
  writeJSON(path.join(GENERATED, "arena-pieces.json"), { positionsByteLength, pieces: info, ...layout });

  let colTris = 0;
  for (const r of ranges.values()) colTris += r[3] / 3;
  let drawn = 0, prims = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) { prims++; drawn += (prim.getIndices()?.getCount() ?? 0) / 3; }
  console.log(`[arena] ${(bytes / 1e6).toFixed(2)} MB glb, ${batches.size} pieces, ${prims} primitives, ${drawn} tris drawn, ${colTris} collision tris, ${clips.length} clip boxes, spawns ${layout.spawns.blue.length}/${layout.spawns.red.length}/${layout.spawns.ffa.length}, ${layout.footprints.length} footprints`);
}

interface Batch { pos: number[]; nrm: number[]; uv: number[]; col: number[] }

interface Source {
  /** Three corners per triangle, game space. */
  pos: Float32Array;
  nrm: Float32Array;
  /** glTF convention (v down). */
  uv: Float32Array;
  /** Material index per triangle. */
  mat: Uint8Array;
  /** Embedded image and its mean color (linear) per material. */
  materials: { name: string; image: Buffer | null; mean: V3 }[];
}

/**
 * Reads the FBX with three's loader. Node can't decode images, so the loader's textures stay
 * empty and keep the URL of the embedded image, which is read back from its blob.
 */
async function readFBX(file: string): Promise<Source> {
  const proto = THREE.TextureLoader.prototype;
  const load = proto.load;
  proto.load = function (url: string) {
    const t = new THREE.Texture();
    t.userData.url = url;
    return t;
  } as typeof load;
  let group: THREE.Group;
  try {
    const buf = fs.readFileSync(file);
    group = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
  } finally {
    proto.load = load;
  }
  group.updateMatrixWorld(true);
  const mesh = group.children.find((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh)!;
  const g = mesh.geometry as THREE.BufferGeometry;
  const index = g.index, corners = index ? index.count : g.attributes.position.count;
  const toGame = new THREE.Matrix4().makeTranslation(-CENTER[0], -FLOOR, -CENTER[1]).multiply(new THREE.Matrix4().makeScale(0.01, 0.01, 0.01)).multiply(mesh.matrixWorld);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(toGame);
  const P = g.attributes.position as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute, U = g.attributes.uv as THREE.BufferAttribute;
  const pos = new Float32Array(corners * 3), nrm = new Float32Array(corners * 3), uv = new Float32Array(corners * 2), mat = new Uint8Array(corners / 3);
  const v = new THREE.Vector3();
  for (let c = 0; c < corners; c++) {
    const i = index ? index.getX(c) : c;
    v.fromBufferAttribute(P, i).applyMatrix4(toGame);
    pos.set([round3(v.x), round3(v.y), round3(v.z)], c * 3);
    v.fromBufferAttribute(N, i).applyMatrix3(normalMatrix).normalize();
    nrm.set([v.x, v.y, v.z], c * 3);
    uv.set([U.getX(i), 1 - U.getY(i)], c * 2);
  }
  for (const gr of g.groups) mat.fill(gr.materialIndex!, gr.start / 3, (gr.start + gr.count) / 3);

  const materials = [];
  for (const m of mesh.material as THREE.MeshPhongMaterial[]) {
    const url = m.map?.userData.url as string | undefined;
    const blob = url?.startsWith("blob:") ? resolveObjectURL(url) : undefined;
    const image = blob ? Buffer.from(await blob.arrayBuffer()) : null;
    if (!image && !FLAT.test(m.name)) throw new Error(`no embedded image for ${m.name}`);
    const mean: V3 = [1, 1, 1];
    if (image) {
      const { channels } = await sharp(image).stats();
      for (let k = 0; k < 3; k++) mean[k] = Math.round(srgbToLinear(channels[k].mean / 255) * 1000) / 1000;
    }
    materials.push({ name: m.name, image, mean });
  }
  return { pos, nrm, uv, mat, materials };
}

/** Island id per triangle: triangles sharing a corner position are connected. */
function findIslands(pos: Float32Array): Int32Array {
  const tris = pos.length / 9;
  const parent = Int32Array.from({ length: tris }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const owner = new Map<string, number>();
  for (let t = 0; t < tris; t++) for (let c = t * 9; c < t * 9 + 9; c += 3) {
    const key = `${pos[c]},${pos[c + 1]},${pos[c + 2]}`;
    const o = owner.get(key);
    if (o === undefined) owner.set(key, t);
    else parent[find(t)] = find(o);
  }
  return Int32Array.from({ length: tris }, (_, t) => find(t));
}

/**
 * The event floor's outer edge, as a closed loop (x, z): the boundary of its top surface's
 * largest loop (smaller loops are holes under the course).
 */
function floorOutline(src: Source): [number, number][] {
  const key = (c: number) => `${src.pos[c * 3]},${src.pos[c * 3 + 2]}`;
  const edges = new Map<string, { from: number; to: number; n: number }>();
  for (let t = 0; t < src.mat.length; t++) {
    if (src.materials[src.mat[t]].name !== "concrete_ground1") continue;
    const c = [t * 3, t * 3 + 1, t * 3 + 2];
    if (c.some((i) => Math.abs(src.pos[i * 3 + 1]) > 0.05)) continue;
    for (let e = 0; e < 3; e++) {
      const a = c[e], b = c[(e + 1) % 3];
      const id = [key(a), key(b)].sort().join("|");
      const edge = edges.get(id);
      if (edge) edge.n++;
      else edges.set(id, { from: a, to: b, n: 1 });
    }
  }
  const next = new Map<string, number>();
  for (const e of edges.values()) if (e.n === 1) next.set(key(e.from), e.to);
  const loops: [number, number][][] = [];
  const seen = new Set<string>();
  for (const [start] of next) {
    if (seen.has(start)) continue;
    const loop: [number, number][] = [];
    for (let k = start; !seen.has(k) && next.has(k);) {
      seen.add(k);
      const c = next.get(k)!;
      loop.push([src.pos[c * 3], src.pos[c * 3 + 2]]);
      k = key(c);
    }
    loops.push(loop);
  }
  const area = (l: [number, number][]) => Math.abs(l.reduce((s, [x, z], i) => s + x * l[(i + 1) % l.length][1] - l[(i + 1) % l.length][0] * z, 0) / 2);
  const outline = loops.sort((a, b) => area(b) - area(a))[0];
  // Drop collinear points (the floor is tessellated along its straight sides).
  return outline.filter((p, i) => {
    const a = outline[(i + outline.length - 1) % outline.length], b = outline[(i + 1) % outline.length];
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-3;
  });
}

const BOARD_COLOR: V3 = [0.012, 0.014, 0.02];

/** Inward offset of each outline point (miter of its two edges), for a convex loop. */
function offsetOutline(outline: [number, number][], d: number): [number, number][] {
  const n = outline.length;
  const cx = outline.reduce((s, p) => s + p[0], 0) / n, cz = outline.reduce((s, p) => s + p[1], 0) / n;
  const inward = (a: [number, number], b: [number, number]) => {
    let nx = -(b[1] - a[1]), nz = b[0] - a[0];
    const len = Math.hypot(nx, nz);
    nx /= len; nz /= len;
    return nx * (cx - a[0]) + nz * (cz - a[1]) < 0 ? [-nx, -nz] : [nx, nz];
  };
  return outline.map((p, i) => {
    const e0 = inward(outline[(i + n - 1) % n], p), e1 = inward(p, outline[(i + 1) % n]);
    let mx = e0[0] + e1[0], mz = e0[1] + e1[1];
    const len = Math.hypot(mx, mz);
    mx /= len; mz /= len;
    const s = d / Math.max(0.5, mx * e1[0] + mz * e1[1]);
    return [round3(p[0] + mx * s), round3(p[1] + mz * s)];
  });
}

/** The perimeter board: outer face, inner face and top, as flat-shaded triangles. */
function boardGeometry(outline: [number, number][]) {
  const outer = offsetOutline(outline, 0.03), inner = offsetOutline(outline, 0.03 + BOARD_T);
  const pos: number[] = [], nrm: number[] = [];
  const quad = (a: V3, b: V3, c: V3, d: V3, want: V3) => {
    // Wound to face `want`.
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const tri = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    const len = Math.hypot(...want);
    for (const p of tri) { pos.push(...p); nrm.push(want[0] / len, want[1] / len, want[2] / len); }
  };
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [o0, o1, i0, i1] = [outer[i], outer[j], inner[i], inner[j]];
    // Outward normal: from the inner line toward the outer line.
    const out: V3 = [(o0[0] + o1[0] - i0[0] - i1[0]) / 2, 0, (o0[1] + o1[1] - i0[1] - i1[1]) / 2];
    quad([o0[0], 0, o0[1]], [o1[0], 0, o1[1]], [o1[0], BOARD_H, o1[1]], [o0[0], BOARD_H, o0[1]], out);
    quad([i0[0], 0, i0[1]], [i1[0], 0, i1[1]], [i1[0], BOARD_H, i1[1]], [i0[0], BOARD_H, i0[1]], [-out[0], 0, -out[2]]);
    quad([o0[0], BOARD_H, o0[1]], [o1[0], BOARD_H, o1[1]], [i1[0], BOARD_H, i1[1]], [i0[0], BOARD_H, i0[1]], [0, 1, 0]);
  }
  return { pos, nrm };
}

/** An upright box (no bottom) centered at (x, z), turned by `ry` about +Y, flat shaded. */
function boxGeometry(x: number, z: number, sx: number, sz: number, y0: number, y1: number, ry: number) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (u: number, v: number, y: number): V3 => [round3(x + u * c + v * s), y, round3(z - u * s + v * c)];
  const [hx, hz] = [sx / 2, sz / 2];
  const pos: number[] = [], nrm: number[] = [];
  // Each face counterclockwise seen from outside, with its normal.
  const faces: [V3, V3, V3, V3, V3][] = [
    [at(-hx, -hz, y1), at(-hx, hz, y1), at(hx, hz, y1), at(hx, -hz, y1), [0, 1, 0]],
    [at(hx, -hz, y0), at(hx, -hz, y1), at(hx, hz, y1), at(hx, hz, y0), [c, 0, -s]],
    [at(-hx, hz, y0), at(-hx, hz, y1), at(-hx, -hz, y1), at(-hx, -hz, y0), [-c, 0, s]],
    [at(hx, hz, y0), at(hx, hz, y1), at(-hx, hz, y1), at(-hx, hz, y0), [s, 0, c]],
    [at(-hx, -hz, y0), at(-hx, -hz, y1), at(hx, -hz, y1), at(hx, -hz, y0), [-s, 0, -c]],
  ];
  for (const [a, b, cc, d, n] of faces) for (const p of [a, b, cc, a, cc, d]) { pos.push(...p); nrm.push(...n); }
  return { pos, nrm };
}

/** A clip volume as its 8 corners (bit 0: +axis 1, bit 1: +axis 2, bit 2: +axis 3). */
type Box = V3[];

/** Boxes from the board's inner face outward, from below the floor to well above a jump. */
function perimeterClips(outline: [number, number][]): Box[] {
  const inner = offsetOutline(outline, 0.03 + BOARD_T), outer = offsetOutline(outline, -1);
  const out: Box[] = [];
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length;
    const quad = [inner[i], inner[j], outer[i], outer[j]];
    out.push([0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
      const [x, z] = quad[k & 3];
      return [x, k & 4 ? CLIP_H : -1, z] as V3;
    }));
  }
  return out;
}

/**
 * Clip boxes over the crowd barriers: their footprint on a fine grid, merged into rectangles,
 * tall enough that nobody hops over from a ramp.
 */
function barrierClips(src: Source, tris: number[]): Box[] {
  const H = ARENA_HALF, N = Math.ceil((H * 2) / BARRIER_CELL);
  const cells = new Float32Array(N * N);
  const mark = (x: number, z: number) => {
    const i = Math.floor((x + H) / BARRIER_CELL), k = Math.floor((z + H) / BARRIER_CELL);
    if (i >= 0 && k >= 0 && i < N && k < N) cells[k * N + i] = 1;
  };
  for (const t of tris) {
    // Points along each edge, every few centimeters, cover the thin rails.
    for (let e = 0; e < 3; e++) {
      const a = t * 9 + e * 3, b = t * 9 + ((e + 1) % 3) * 3;
      const steps = Math.ceil(Math.hypot(src.pos[b] - src.pos[a], src.pos[b + 2] - src.pos[a + 2]) / (BARRIER_CELL / 3)) + 1;
      for (let s = 0; s <= steps; s++) mark(src.pos[a] + ((src.pos[b] - src.pos[a]) * s) / steps, src.pos[a + 2] + ((src.pos[b + 2] - src.pos[a + 2]) * s) / steps);
    }
  }
  return rectangles(cells, N, 1).map(({ x, z, sx, sz }): Box => {
    const [x0, z0, x1, z1] = [x * BARRIER_CELL - H, z * BARRIER_CELL - H, (x + sx) * BARRIER_CELL - H, (z + sz) * BARRIER_CELL - H];
    return [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [k & 1 ? x1 : x0, k & 4 ? BARRIER_CLIP_H : -0.5, k & 2 ? z1 : z0] as V3);
  });
}

/** Collision triangles for the clip boxes. */
function boxesMesh(boxes: Box[]): CollisionMesh {
  const pos: number[] = [], idx: number[] = [];
  // Corner indices of each face (two triangles each).
  const faces = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  for (const corners of boxes) {
    const base = pos.length / 3;
    for (const v of corners) pos.push(...v);
    for (const i of faces) idx.push(base + i);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

function boxBounds(boxes: Box[]): PieceInfo {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const v of boxes.flat()) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
  return { min, max };
}

/** Collision triangles bucketed on a 2 m grid, for height queries and line-of-sight tests. */
class Surfaces {
  private readonly tris: number[][] = [];
  private readonly grid = new Map<string, number[]>();

  constructor(meshes: CollisionMesh[]) {
    for (const { positions: p, indices } of meshes) for (let t = 0; t < indices.length; t += 3) {
      const v = [indices[t], indices[t + 1], indices[t + 2]].flatMap((i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
      const id = this.tris.push(v) - 1;
      for (let gx = Math.floor(Math.min(v[0], v[3], v[6]) / 2); gx <= Math.floor(Math.max(v[0], v[3], v[6]) / 2); gx++)
        for (let gz = Math.floor(Math.min(v[2], v[5], v[8]) / 2); gz <= Math.floor(Math.max(v[2], v[5], v[8]) / 2); gz++) {
          const key = `${gx},${gz}`;
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(id);
        }
    }
  }

  /** Heights of every surface over (x, z), the ground plane included. */
  at(x: number, z: number): number[] {
    return this.surfaces(x, z).map((s) => s.y);
  }

  /** Every surface over (x, z) with whether it faces up (the ground plane included). */
  private surfaces(x: number, z: number) {
    const out = [{ y: 0, up: true }];
    for (const id of this.grid.get(`${Math.floor(x / 2)},${Math.floor(z / 2)}`) ?? []) {
      const [x0, y0, z0, x1, y1, z1, x2, y2, z2] = this.tris[id];
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(d) < 1e-9) continue;
      const a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d, b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
      if (a < 0 || b < 0 || a + b > 1) continue;
      // Counterclockwise seen from above (front faces are counterclockwise).
      out.push({ y: a * y0 + b * y1 + (1 - a - b) * y2, up: (x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0) < 0 });
    }
    return out;
  }

  /**
   * True when (x, floor, z) is inside something solid: the first surface above it is the top of
   * something (a block's top faces up; a roof seen from below faces down), or another floor
   * lies just above it.
   */
  inside(x: number, z: number, floor: number) {
    const above = this.surfaces(x, z).filter((s) => s.y > floor + 0.02).sort((a, b) => a.y - b.y)[0];
    return !!above && (above.up || above.y < floor + 2.1);
  }

  /** The highest floor at or below `y`. */
  floor(x: number, z: number, y: number) {
    return Math.max(...this.at(x, z).filter((h) => h <= y));
  }

  /** True when a standing player at (x, floor, z) has level floor and nothing within reach around them. */
  clear(x: number, z: number, floor: number) {
    for (const [dx, dz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [0.35, 0.35], [-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35]]) {
      if (this.inside(x + dx, z + dz, floor)) return false;
      if (Math.abs(this.floor(x + dx, z + dz, floor + 0.25) - floor) > 0.2) return false;
    }
    return true;
  }

  /** True when nothing solid crosses the segment a → b. */
  sees(a: V3, b: V3) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[2]);
    const checked = new Set<number>();
    for (let s = 0; s <= Math.ceil(len); s++) {
      const f = len ? Math.min(1, s / len) : 0;
      for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${Math.floor((a[0] + d[0] * f) / 2) + ox},${Math.floor((a[2] + d[2] * f) / 2) + oz}`;
        for (const id of this.grid.get(key) ?? []) {
          if (checked.has(id)) continue;
          checked.add(id);
          if (hits(this.tris[id], a, d)) return false;
        }
      }
    }
    return true;
  }
}

/** Segment (origin `o`, direction `d`, t in [0, 1]) against a triangle (Möller–Trumbore). */
function hits(v: number[], o: V3, d: number[]) {
  const e1 = [v[3] - v[0], v[4] - v[1], v[5] - v[2]], e2 = [v[6] - v[0], v[7] - v[1], v[8] - v[2]];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return false;
  const s = [o[0] - v[0], o[1] - v[1], o[2] - v[2]];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
  if (u < 0 || u > 1) return false;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const w = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
  if (w < 0 || u + w > 1) return false;
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
  return t > 1e-4 && t < 1 - 1e-4;
}

type Spawn = [number, number, number];
const EYE = 1.62;

/** Spawns placed on the real collision, and obstacle footprints for the minimap. */
function playLayout(surfaces: Surfaces, clips: Box[], outline: [number, number][]) {
  const inClip = (x: number, z: number) => clips.some((b) => {
    // Clip boxes are upright: test against their footprint (corners 0, 1, 3, 2), with a margin.
    const q = [b[0], b[1], b[3], b[2]];
    let inside = true;
    for (let i = 0; i < 4 && inside; i++) {
      const [ax, , az] = q[i], [bx, , bz] = q[(i + 1) % 4];
      const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez) || 1;
      const side = (ex * (z - az) - ez * (x - ax)) / len;
      const sign = Math.sign(ex * (q[(i + 2) % 4][2] - az) - ez * (q[(i + 2) % 4][0] - ax));
      inside = side * sign > -0.6;
    }
    return inside;
  });
  const insideFloor = (x: number, z: number) => {
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, zi] = outline[i], [xj, zj] = outline[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const open = (x: number, z: number, floor: number) => insideFloor(x, z) && !inClip(x, z) && surfaces.clear(x, z, floor);

  /** Open spots on the event floor's ground level in a band of z. */
  const zone = (z0: number, z1: number): Spawn[] => {
    const spots: Spawn[] = [];
    for (let x = -31; x <= 31; x += 1.25) for (let z = z0; z <= z1; z += 1.25) {
      const floor = surfaces.floor(x, z, 0.5);
      if (Math.abs(floor) < 0.3 && open(x, z, floor)) spots.push([round(x), round(floor), round(z)]);
    }
    return spots;
  };
  let blue = zone(-45.5, -36), red = zone(36, 45.5);
  // Drop the spots that see the other team's, worst first, until no pair sees each other.
  const eye = ([x, y, z]: Spawn): V3 => [x, y + EYE, z];
  const sees = blue.map((b) => red.map((r) => surfaces.sees(eye(b), eye(r))));
  const alive = { blue: blue.map(() => true), red: red.map(() => true) };
  for (;;) {
    const countB = blue.map((_, i) => (alive.blue[i] ? red.reduce((n, _, j) => n + (alive.red[j] && sees[i][j] ? 1 : 0), 0) : 0));
    const countR = red.map((_, j) => (alive.red[j] ? blue.reduce((n, _, i) => n + (alive.blue[i] && sees[i][j] ? 1 : 0), 0) : 0));
    const mb = Math.max(...countB), mr = Math.max(...countR);
    if (mb === 0 && mr === 0) break;
    if (mb >= mr) alive.blue[countB.indexOf(mb)] = false;
    else alive.red[countR.indexOf(mr)] = false;
  }
  blue = blue.filter((_, i) => alive.blue[i]);
  red = red.filter((_, j) => alive.red[j]);

  // Free-for-all: open spots anywhere on the floor and the course (decks included).
  const ffaSpots: Spawn[] = [];
  for (let x = -30; x <= 30; x += 2) for (let z = -44; z <= 44; z += 2) {
    for (const h of new Set(surfaces.at(x, z).map((h) => round(h)))) {
      if (h < 4 && open(x, z, h)) ffaSpots.push([x, h, z]);
    }
  }

  // Footprints: 1 m cells whose top is over head height (decks, blocks, booths), merged.
  const H = ARENA_HALF, N = H * 2;
  const tall = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) tall[j * N + i] = Math.max(...surfaces.at(i - H + 0.5, j - H + 0.5)) > 1.7 ? 1 : 0;
  const plaza = outline.reduce((r, [x, z]) => ({ x0: Math.min(r.x0, x), z0: Math.min(r.z0, z), x1: Math.max(r.x1, x), z1: Math.max(r.z1, z) }), { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity });
  return {
    spawns: { blue: spread(blue, 10, [0, 0, -46]), red: spread(red, 10, [0, 0, 46]), ffa: spread(ffaSpots, 16, [0, 0, 0]) },
    floor: { x: round(plaza.x0), z: round(plaza.z0), sx: round(plaza.x1 - plaza.x0), sz: round(plaza.z1 - plaza.z0) },
    footprints: rectangles(tall, N, 3).map((r) => ({ x: r.x - H, z: r.z - H, sx: r.sx, sz: r.sz })),
  };
}

/** `count` spots spread out (farthest-point sampling), starting nearest `from`. */
function spread(spots: Spawn[], count: number, from: Spawn): Spawn[] {
  if (spots.length <= count) return spots;
  const d2 = (a: Spawn, b: Spawn) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2;
  const out = [spots.reduce((best, s) => (d2(s, from) < d2(best, from) ? s : best))];
  const near = spots.map((s) => d2(s, out[0]));
  while (out.length < count) {
    const i = near.indexOf(Math.max(...near));
    out.push(spots[i]);
    spots.forEach((s, k) => (near[k] = Math.min(near[k], d2(s, spots[i]))));
  }
  return out;
}

/** Greedy merge of set grid cells into rectangles {x, z, sx, sz} (in cells), at least `min` cells. */
function rectangles(cells: Float32Array, n: number, min: number) {
  const used = new Uint8Array(n * n), out: { x: number; z: number; sx: number; sz: number }[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (!cells[j * n + i] || used[j * n + i]) continue;
    let w = 1;
    while (i + w < n && cells[j * n + i + w] && !used[j * n + i + w]) w++;
    let h = 1;
    for (; j + h < n; h++) {
      let row = true;
      for (let a = i; a < i + w; a++) if (!cells[(j + h) * n + a] || used[(j + h) * n + a]) { row = false; break; }
      if (!row) break;
    }
    for (let b = j; b < j + h; b++) for (let a = i; a < i + w; a++) used[b * n + a] = 1;
    if (w * h >= min) out.push({ x: i, z: j, sx: w, sz: h });
  }
  return out;
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const round = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
