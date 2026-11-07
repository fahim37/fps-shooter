import path from "node:path";
import { Document, type Node, type Primitive } from "@gltf-transform/core";
import { weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  RAW, PUBLIC_MODELS, GENERATED, readModel, writeGLB, buildCollision, writeCollisionBin, pieceBounds, writeJSON,
  type CollisionMesh, type PieceInfo,
} from "./common";
import { Surfaces, boxesMesh, boxBounds, rectangles, spread, type Box } from "./arena";

/**
 * "Blockade": "LOWPOLY | MAP | ASSET" by ResoForge (Sketchfab, CC BY 4.0; RP_MAP_1.glb), a finished depot in one GLB: a ring of tall barricades
 * around container rows, truck wrecks, sandbag nests, walk-in rooms and a scaffolded hall. Wrecks
 * close the ring's two ends; past them lies a vehicle yard, reached only by jumping over the wrecks,
 * so bots stay out of it. Flat material colors, no textures.
 *
 * The source is built about 1.7x human size (a table stands 1.54, a storey 6), so it is scaled
 * to 0.6. That also makes it 60 x 120 m inside the ring, about the size of Desert City.
 *
 * Built for low-end PCs first:
 * - Every color goes into vertex colors on one material, so a chunk is one draw call however
 *   many colors it holds (the source's 1,700 primitives become a couple of dozen draws).
 * - Each object is simplified on its own, within `SIMPLIFY` meters: most of the source's 427,000
 *   triangles are bevels on sandbags, tires and car bodies that no one sees from a few meters away.
 * - The material is single-sided. Open objects on a double-sided source material, and all the
 *   containers, whose panels players can see from inside, get their back faces baked in instead.
 *
 * For play:
 * - Players wear blue and red, so every red, blue and orange is repainted. This also keeps
 *   color channels off exactly zero: the post-processing chain turns pure (1, 0, 0) surfaces
 *   into black blobs on Medium and up.
 * - The source has no edge past its ground plane: `wallBoxes` closes each yard from ring corner
 *   to ring corner, and `Clip_Blockade` runs behind the ring and the walls so nobody leaves.
 * - Spawns stand on `walkableFloor`, where a real player capsule fits and can walk to.
 *
 * Put the downloaded GLB at assets-raw/resoforge/rp-map-1.glb.
 */

export const BLOCKADE_SCALE = 0.6;
const SRC = path.join(RAW, "resoforge/rp-map-1.glb");
/** Half the map's long side with its yards, rounded up: the play area. */
export const BLOCKADE_HALF = 77;
/** Chunk size for merged geometry, in meters. */
const CHUNK = 32;
/** Most an object's surface may move when simplified, in meters. */
const SIMPLIFY = 0.05;
/** Tires: the source's most detailed objects, and round enough to hide it. */
const SIMPLIFY_TIRES = 0.06;
/** Barrels: narrow enough that more than this turns them into boxes. */
const SIMPLIFY_BARRELS = 0.03;
/** Crates: their inset panels are only a few centimeters deep. */
const SIMPLIFY_WOOD = 0.012;
/** Cosine of the angle (40 degrees) past which faces get a hard edge. */
const CREASE = Math.cos((40 * Math.PI) / 180);

/** Source nodes left out: the ground plane (Ground.tsx draws it) and four blank 24 m pillars. */
const SKIP = /^(PLANE|Armature|Cube\.191|Cube\.201|Cube\.206|Cube\.207)$/;

/** Repaints by source material (sRGB hex). */
const PAINT: Record<string, string> = {
  YELLOW: "#a8894f", //    walls of the rooms → ochre
  "WHITE-EF": "#b4b2ab", //  near-white glares under the sun
  "DARK-2": "#2e3034",
  DARK: "#26282b",
  BLUE: "#4d6157", //      → slate green
  RED: "#6d7448", //       → olive drab
  WOOD: "#b08a55",
  ORANGE: "#8f8463", //    sandbags → khaki
  "D-W-50": "#6b6d70", //  concrete
  NONE: "#6b6d70", //      the one stair with no material
};
/** Containers: their colored panels, by source material. */
const CONTAINER_PAINT: Record<string, string> = { RED: "#6e5540", ORANGE: "#7d6a45", BLUE: "#4d6157" };
/** Wrecks come in one red in the source: a few drab colors, in turn. */
const CAR_PAINT = ["#5e6650", "#6f5a45", "#4f5a61", "#8a8069", "#3f4347"];

const WALL_COLOR = "#6b6d70", WALL_H = 4.5, WALL_T = 0.6;
/** Where the ring ends and the walls start (m): the outer corners of its corner barricades. */
const RING_X = 31.7, RING_Z = 61.7;
/** The outer edge of each yard (m), at the source's ground plane. */
const YARD_Z0 = -75.8, YARD_Z1 = 75.4;
const CLIP_H = 40;

type V3 = [number, number, number];

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLinear = (hex: string): V3 => [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as V3;

interface Batch { pos: number[]; nrm: number[]; col: number[] }
const newBatch = (): Batch => ({ pos: [], nrm: [], col: [] });

/** One source primitive in game space, indexed, simplified. */
interface Part { pos: Float32Array; idx: Uint32Array; material: string; doubleSided: boolean }

export async function importBlockade() {
  const src = await readModel(SRC);
  const scene = src.getRoot().listScenes()[0];
  const out = new Document();
  const buffer = out.createBuffer();
  const paint = out.createMaterial("Blockade_Paint").setMetallicFactor(0).setRoughnessFactor(0.85);

  const batches = new Map<string, Batch>();
  const batchFor = (name: string) => {
    let b = batches.get(name);
    if (!b) batches.set(name, (b = newBatch()));
    return b;
  };

  let sourceTris = 0, cars = 0;
  for (const node of scene.listChildren()) {
    const name = node.getName();
    if (SKIP.test(name) || !node.getMesh()) continue;
    const parts = node.getMesh()!.listPrimitives().map((prim) => readPart(prim, node));
    for (const p of parts) sourceTris += p.idx.length / 3;
    const open = isOpen(parts);
    const isCar = /^CAR/.test(name), isContainer = /Container/.test(name);
    const carColor = hexLinear(CAR_PAINT[(isCar ? cars++ : 0) % CAR_PAINT.length]);

    const box = bounds(parts);
    const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
    const b = batchFor(`Blockade_${Math.floor(cx / CHUNK + 0.5)}_${Math.floor(cz / CHUNK + 0.5)}`);

    for (const p of parts) {
      const color = isCar && p.material === "RED" ? carColor
        : hexLinear((isContainer && CONTAINER_PAINT[p.material]) || PAINT[p.material]);
      simplify(p, p.material === "WOOD" ? SIMPLIFY_WOOD : !/^Cylinder/.test(name) ? SIMPLIFY : /^DARK/.test(p.material) ? SIMPLIFY_TIRES : SIMPLIFY_BARRELS);
      addTriangles(b, p, color, false);
      if (open && (p.doubleSided || isContainer)) addTriangles(b, p, color, true);
    }
  }

  const walls = wallBoxes();
  for (const w of walls) addBox(batchFor(`Blockade_${Math.floor((w.x0 + w.x1) / 2 / CHUNK + 0.5)}_${Math.floor((w.z0 + w.z1) / 2 / CHUNK + 0.5)}`), w, hexLinear(WALL_COLOR));

  // Build the document: one node per piece, one primitive each.
  const scene2 = out.createScene("blockade");
  for (const name of [...batches.keys()].sort()) {
    const b = batches.get(name)!;
    const acc = (type: "VEC3" | "VEC4", a: number[]) => out.createAccessor().setType(type).setArray(new Float32Array(a)).setBuffer(buffer);
    const prim = out.createPrimitive().setMaterial(paint)
      .setAttribute("POSITION", acc("VEC3", b.pos)).setAttribute("NORMAL", acc("VEC3", b.nrm)).setAttribute("COLOR_0", acc("VEC4", b.col));
    scene2.addChild(out.createNode(name).addChild(out.createNode(`${name}_mesh`).setMesh(out.createMesh(name).addPrimitive(prim))));
  }
  await out.transform(weld());
  const bytes = await writeGLB(out, path.join(PUBLIC_MODELS, "blockade.glb"));

  // Collision from the written document's triangles. keepShells: the container panels are open.
  const collision = new Map<string, CollisionMesh | null>();
  const info: Record<string, PieceInfo> = {};
  for (const piece of scene2.listChildren()) {
    const name = piece.getName();
    collision.set(name, buildCollision(piece, null, 0.05, { keepShells: true }));
    info[name] = pieceBounds(piece);
  }
  const clips = perimeterClips();
  collision.set("Clip_Blockade", boxesMesh(clips));
  const { ranges, positionsByteLength } = writeCollisionBin(path.join(PUBLIC_MODELS, "blockade.collision.bin"), collision);
  for (const [name, range] of ranges) (info[name] ??= boxBounds(clips)).col = range;

  const solid = new Surfaces([...collision].filter(([name, m]) => m && !name.startsWith("Clip_")).map(([, m]) => m!));
  const layout = playLayout(solid, await walkableFloor([...collision.values()].filter((m) => m !== null)));
  writeJSON(path.join(GENERATED, "blockade-pieces.json"), { positionsByteLength, pieces: info, ...layout });

  let colTris = 0;
  for (const r of ranges.values()) colTris += r[3] / 3;
  let drawn = 0;
  for (const b of batches.values()) drawn += b.pos.length / 9;
  console.log(`[blockade] ${(bytes / 1e6).toFixed(2)} MB glb, ${batches.size} pieces, ${sourceTris} source tris, ${drawn} drawn, ${colTris} collision tris, spawns ${layout.spawns.blue.length}/${layout.spawns.red.length}/${layout.spawns.ffa.length}, ${layout.footprints.length} footprints`);
}

/** A primitive's triangles in game space. The scale and rotation sit on the source's nodes. */
function readPart(prim: Primitive, node: Node): Part {
  const m = node.getWorldMatrix(), S = BLOCKADE_SCALE;
  const P = prim.getAttribute("POSITION")!, I = prim.getIndices();
  const count = P.getCount();
  const pos = new Float32Array(count * 3);
  const v = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    P.getElement(i, v);
    pos[i * 3] = (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) * S;
    pos[i * 3 + 1] = (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) * S;
    pos[i * 3 + 2] = (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) * S;
  }
  const idx = I ? Uint32Array.from(I.getArray()!) : Uint32Array.from({ length: count }, (_, i) => i);
  const material = prim.getMaterial();
  return { pos, idx, material: material?.getName() ?? "NONE", doubleSided: material?.getDoubleSided() ?? false };
}

/** True when any edge of the object isn't shared by exactly two triangles. */
function isOpen(parts: Part[]) {
  const edges = new Map<string, number>();
  for (const { pos, idx } of parts) {
    const key = (i: number) => `${Math.round(pos[i * 3] * 1000)},${Math.round(pos[i * 3 + 1] * 1000)},${Math.round(pos[i * 3 + 2] * 1000)}`;
    for (let t = 0; t < idx.length; t += 3) {
      const k = [key(idx[t]), key(idx[t + 1]), key(idx[t + 2])];
      for (let e = 0; e < 3; e++) {
        const [a, b] = [k[e], k[(e + 1) % 3]];
        const id = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(id, (edges.get(id) ?? 0) + 1);
      }
    }
  }
  for (const c of edges.values()) if (c !== 2) return true;
  return false;
}

function bounds(parts: Part[]) {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const { pos } of parts) for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], pos[i + k]);
    max[k] = Math.max(max[k], pos[i + k]);
  }
  return { min, max };
}

/**
 * Fewer triangles within `error` meters, in place. The source is flat shaded, with no vertex shared
 * between triangles, so it is welded by position first: otherwise every edge is a border and
 * nothing can collapse. Real open borders stay where they are, so panels keep their shape.
 */
function simplify(part: Part, error: number) {
  const { pos, idx } = part;
  const seen = new Map<string, number>();
  const welded: number[] = [];
  const remap = new Uint32Array(pos.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const key = `${Math.round(pos[i * 3] * 2000)},${Math.round(pos[i * 3 + 1] * 2000)},${Math.round(pos[i * 3 + 2] * 2000)}`;
    let j = seen.get(key);
    if (j === undefined) {
      seen.set(key, (j = welded.length / 3));
      welded.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
    remap[i] = j;
  }
  const kept: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [remap[idx[t]], remap[idx[t + 1]], remap[idx[t + 2]]];
    if (a !== b && b !== c && a !== c) kept.push(a, b, c);
  }
  const positions = new Float32Array(welded);
  const [out] = MeshoptSimplifier.simplify(Uint32Array.from(kept), positions, 3, 0, error, ["ErrorAbsolute", "LockBorder"]);
  part.pos = positions;
  part.idx = out;
}

/**
 * Appends triangles, optionally wound the other way. Normals are rebuilt from the simplified
 * shape: faces meeting at less than `CREASE` shade smoothly, so tires and car bodies stay round
 * and box edges stay sharp.
 */
function addTriangles(b: Batch, { pos, idx }: Part, color: V3, flip: boolean) {
  const faces = idx.length / 3;
  const normals = new Float32Array(faces * 3);
  const around = new Map<number, number[]>();
  for (let f = 0; f < faces; f++) {
    const [p, q, r] = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]].map((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    // Left unit length-free: longer faces weigh more in the smooth normals.
    normals.set([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], f * 3);
    for (let c = 0; c < 3; c++) {
      const i = idx[f * 3 + c];
      const list = around.get(i);
      if (list) list.push(f);
      else around.set(i, [f]);
    }
  }
  const unit = (f: number) => {
    const l = Math.hypot(normals[f * 3], normals[f * 3 + 1], normals[f * 3 + 2]) || 1;
    return [normals[f * 3] / l, normals[f * 3 + 1] / l, normals[f * 3 + 2] / l];
  };
  const sign = flip ? -1 : 1;
  for (let f = 0; f < faces; f++) {
    if (Math.hypot(normals[f * 3], normals[f * 3 + 1], normals[f * 3 + 2]) < 1e-9) continue;
    const own = unit(f);
    for (const c of flip ? [0, 2, 1] : [0, 1, 2]) {
      const i = idx[f * 3 + c];
      const n = [0, 0, 0];
      for (const g of around.get(i)!) {
        const o = unit(g);
        if (own[0] * o[0] + own[1] * o[1] + own[2] * o[2] < CREASE) continue;
        n[0] += normals[g * 3]; n[1] += normals[g * 3 + 1]; n[2] += normals[g * 3 + 2];
      }
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      b.pos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      b.nrm.push((n[0] / l) * sign, (n[1] / l) * sign, (n[2] / l) * sign);
      b.col.push(color[0], color[1], color[2], 1);
    }
  }
}

interface Rect { x0: number; x1: number; z0: number; z1: number }

/** The yards' outer walls: from each corner of the ring around the end of the map. */
function wallBoxes(): Rect[] {
  const T = WALL_T;
  return [
    { x0: -RING_X - T, x1: RING_X + T, z0: YARD_Z0 - T, z1: YARD_Z0 },
    { x0: -RING_X - T, x1: -RING_X, z0: YARD_Z0, z1: -RING_Z },
    { x0: RING_X, x1: RING_X + T, z0: YARD_Z0, z1: -RING_Z },
    { x0: -RING_X - T, x1: RING_X + T, z0: YARD_Z1, z1: YARD_Z1 + T },
    { x0: -RING_X - T, x1: -RING_X, z0: RING_Z, z1: YARD_Z1 },
    { x0: RING_X, x1: RING_X + T, z0: RING_Z, z1: YARD_Z1 },
  ];
}

/** An upright box, flat shaded (the ground closes the bottom). */
function addBox(b: Batch, { x0, x1, z0, z1 }: Rect, color: V3) {
  const y0 = 0, y1 = WALL_H;
  const faces: [V3, V3, V3, V3, V3][] = [
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]],
    [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
    [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1]],
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]],
  ];
  for (const [p0, p1, p2, p3, n] of faces) for (const p of [p0, p1, p2, p0, p2, p3]) {
    b.pos.push(...p);
    b.nrm.push(...n);
    b.col.push(color[0], color[1], color[2], 1);
  }
}

const clipBox = ({ x0, x1, z0, z1 }: Rect): Box => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [k & 1 ? x1 : x0, k & 4 ? CLIP_H : -1, k & 2 ? z1 : z0] as V3);

/** Behind the ring's long sides, and over the walls of the yards. */
function perimeterClips(): Box[] {
  const ring = 30.7;
  return [
    ...wallBoxes().map(clipBox),
    clipBox({ x0: -ring - 1, x1: -ring, z0: -RING_Z, z1: RING_Z }),
    clipBox({ x0: ring, x1: ring + 1, z0: -RING_Z, z1: RING_Z }),
  ];
}

type Spawn = [number, number, number];
const EYE = 1.62;
/** How close cover has to stand to a spawn (m). */
const COVER_REACH = 3.5;
/** A free-for-all spawn has cover at this height, along this many of 12 directions. */
const FFA_COVER_Y = 1.2, FFA_COVER_DIRS = 3;

const PLAYER_R = 0.35, PLAYER_H = 1.8;
/** Grid of the walkable floor (m). Under a capsule's width, so a flood can't step through a wall. */
const WALK_CELL = 0.5;
/** What a player steps up onto without jumping (m). */
const STEP = 0.42;

/**
 * The floor a player can really walk to: cells where a player capsule fits, against the real
 * collision and clips, in the largest connected region. `Surfaces` looks straight down, so it
 * can't see thin upright panels or tell a closed-off pocket from open floor.
 */
async function walkableFloor(meshes: CollisionMesh[]) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });
  for (const m of meshes) world.createCollider(RAPIER.ColliderDesc.trimesh(m.positions, m.indices));
  world.step();
  const fits = (x: number, z: number, feet: number, radius: number) => {
    const shape = new RAPIER.Capsule(PLAYER_H / 2 - radius, radius);
    return world.intersectionWithShape({ x, y: feet + PLAYER_H / 2, z }, { x: 0, y: 0, z: 0, w: 1 }, shape) === null;
  };
  const key = (i: number, k: number) => `${i},${k}`;
  const cells = new Set<string>();
  // Only inside the walls: the empty ground around the map is bigger than the map.
  const IX = Math.floor(RING_X / WALK_CELL), K0 = Math.ceil(YARD_Z0 / WALK_CELL), K1 = Math.floor(YARD_Z1 / WALK_CELL);
  for (let i = -IX; i <= IX; i++) for (let k = K0; k <= K1; k++) if (fits(i * WALK_CELL, k * WALK_CELL, STEP, PLAYER_R)) cells.add(key(i, k));
  // Connected regions; the largest is the map.
  const regionOf = new Map<string, number>();
  const sizes: number[] = [];
  for (const start of cells) {
    if (regionOf.has(start)) continue;
    const id = sizes.push(0) - 1;
    const stack = [start];
    regionOf.set(start, id);
    while (stack.length) {
      const [i, k] = stack.pop()!.split(",").map(Number);
      sizes[id]++;
      for (const n of [key(i + 1, k), key(i - 1, k), key(i, k + 1), key(i, k - 1)]) {
        if (cells.has(n) && !regionOf.has(n)) { regionOf.set(n, id); stack.push(n); }
      }
    }
  }
  const map = sizes.indexOf(Math.max(...sizes));
  const extent = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [c, id] of regionOf) {
    if (id !== map) continue;
    const [i, k] = c.split(",").map(Number);
    extent[0] = Math.min(extent[0], i * WALK_CELL); extent[1] = Math.max(extent[1], i * WALK_CELL);
    extent[2] = Math.min(extent[2], k * WALK_CELL); extent[3] = Math.max(extent[3], k * WALK_CELL);
  }
  console.log(`[blockade] walkable floor ${sizes[map] * WALK_CELL ** 2} m2, x ${extent[0]}..${extent[1]}, z ${extent[2]}..${extent[3]}; ${sizes.length - 1} closed pockets`);
  /** True when a player can walk to and stand at (x, z), with room around them. */
  return (x: number, z: number) => regionOf.get(key(Math.round(x / WALK_CELL), Math.round(z / WALK_CELL))) === map && fits(x, z, 0.05, PLAYER_R + 0.15);
}

/** Spawns placed on the real collision, and obstacle footprints for the minimap. */
function playLayout(surfaces: Surfaces, standable: (x: number, z: number) => boolean) {
  const dirs = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);
  const inside = (x: number, z: number) => Math.abs(x) < RING_X - 2 && z > YARD_Z0 + 1 && z < YARD_Z1 - 1;
  /** Open ground-level spots in a band of z, with cover around them. */
  const zone = (z0: number, z1: number, y: number, needed: number): Spawn[] => {
    const spots: Spawn[] = [];
    for (let x = -29; x <= 29; x += 1) for (let z = z0; z <= z1; z += 1) {
      if (!inside(x, z) || !standable(x, z) || !surfaces.clear(x, z, 0)) continue;
      if (dirs.filter((a) => surfaces.shielded(x, z, y, a, COVER_REACH)).length >= needed) spots.push([x, 0, z]);
    }
    return spots;
  };
  let blue = spread(zone(-68, -46, EYE, 2), 60, [0, 0, -68]);
  let red = spread(zone(46, 68, EYE, 2), 60, [0, 0, 68]);
  if (!blue.length || !red.length) throw new Error(`no spawn spots: ${blue.length} blue, ${red.length} red`);
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
  const ffa = zone(-58, 58, FFA_COVER_Y, FFA_COVER_DIRS);

  // Footprints: 1 m cells whose top is over head height, merged.
  const H = BLOCKADE_HALF, N = H * 2;
  const tall = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) tall[j * N + i] = Math.max(...surfaces.at(i - H + 0.5, j - H + 0.5)) > 1.7 ? 1 : 0;
  return {
    spawns: { blue: spread(blue, 10, [0, 0, -68]), red: spread(red, 10, [0, 0, 68]), ffa: spread(ffa, 16, [0, 0, 0]) },
    floor: { x: -RING_X, z: -RING_Z, sx: RING_X * 2, sz: RING_Z * 2 },
    footprints: rectangles(tall, N, 3).map((r) => ({ x: r.x - H, z: r.z - H, sx: r.sx, sz: r.sz })),
  };
}
