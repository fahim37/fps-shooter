import fs from "node:fs";
import path from "node:path";
import type * as THREE_NS from "three";
import { Document, type Material, type Node, type Scene, type Texture } from "@gltf-transform/core";
import {
  RAW, PUBLIC_MODELS, GENERATED, writeGLB, buildCollision, writeCollisionBin, pieceBounds, writeJSON,
  type CollisionMesh, type PieceInfo,
} from "./common";

/**
 * "Low Poly Industrial Zone": the pack is a single FBX holding one merged mesh — a finished
 * diorama (warehouses, trailers, barriers, cable spools...) on a floating-island terrain. This
 * importer cuts it back into kit pieces so the industrial map can lay them out for play.
 *
 * Pieces are selected in source space (meters, Y up, the yard's asphalt at y = 0) by boxes
 * around one instance of each object in the diorama. Each piece is recentered on its footprint
 * with its base on the asphalt and, where `align` is set, turned square to the axes.
 *
 * Put the unzipped pack at assets-raw/industrial (source/lowpoly asset.fbx, textures/*.png).
 */

const DIR = path.join(RAW, "industrial");
const FBX = path.join(DIR, "source/lowpoly asset.fbx");
/** Source height of the yard's asphalt (flat everywhere); it becomes y = 0. */
const ASPHALT = 0.85;
/** Source x, z of the center of the terrain's asphalt yard: the Island piece's origin. */
const YARD_CENTER: [number, number] = [14.95, -7.85];

type Box = [number, number, number, number]; // x0, z0, x1, z1

interface PieceSpec {
  name: string;
  /** Components whose bounds lie inside this source-space box. */
  box: Box;
  /** Leave out components inside these boxes. */
  skip?: Box[];
  /** Only components reaching at least this high (keeps a canopy's posts and roof, not the cargo under it). */
  minTop?: number;
  /** Turn the footprint square to the axes (the diorama places some objects a little askew). */
  align?: boolean;
  /** Extra turn (radians) after alignment, so the piece's front faces +Z. */
  turn?: number;
  /** Rest the lowest point on the ground (objects that sat on a raised pad in the diorama). */
  drop?: boolean;
  /** No collision (ground decals, terrain). */
  noCollide?: boolean;
  /** Source point that becomes the piece origin (default: the footprint center). */
  origin?: [number, number];
}

// Source boxes were read off top-down renders of the diorama (x east, z south).
const SPECS: PieceSpec[] = [
  // Buildings (solid; none have interiors).
  { name: "Warehouse", box: [-12.5, -58.5, 42.5, -33.5], align: true },
  { name: "Office", box: [-51, -39, -40.8, -25.3], align: true },
  { name: "BrickHall", box: [-14, 28.4, 4.8, 45.6], align: true },
  { name: "Garage", box: [-50, 1.8, -33.4, 19.6], skip: [[-35.6, 17.2, -32.6, 19.6]], align: true },
  { name: "Hut", box: [71, -4.2, 78, 3.9], skip: [[71.2, -3.6, 73.1, -1.5]], align: true },
  { name: "Shed", box: [-22.7, 36.2, -17.6, 42.2], skip: [[-18.8, 37.1, -17.7, 38.8]], align: true },
  { name: "SiloShed", box: [55.3, -59.2, 66.9, -49.8], align: true },
  { name: "Substation", box: [70.5, -61.4, 76.1, -57.5], align: true },
  // Square already; its mast and wiring would throw the alignment off.
  { name: "Workshop", box: [40.8, -58, 56.2, -48.6], minTop: 1.2 },
  { name: "GasTanks", box: [11.2, 33.5, 18.5, 39.4], align: true, drop: true },
  // Open canopies: posts and roof only (the diorama stores cargo underneath).
  { name: "Canopy", box: [-50.8, -61.6, -35, -43.4], minTop: 4.5, align: true },
  { name: "CanopyDouble", box: [-49.3, 20, -27.2, 44.6], minTop: 4.5, align: true },
  // Vehicles and cover.
  { name: "Trailer_Red", box: [62.5, -46, 77.5, -42.6], align: true },
  { name: "Trailer_White", box: [62.3, -41.4, 77.2, -38.1], align: true },
  { name: "Trailer_Blue", box: [62.5, -37.7, 77.5, -34.4], align: true },
  { name: "Barrier_Low", box: [71.3, -47.8, 73.4, -46.9], align: true },
  { name: "Barrier_Tall", box: [77.5, -45.7, 78.5, -43.1], align: true },
  { name: "Spool_Standing", box: [-39.8, -58.2, -37.3, -56.3], align: true },
  { name: "Spool_Flat", box: [-39.2, -13.8, -36.8, -11.5] },
  { name: "Spool_Empty", box: [41.3, -11.2, 43.7, -8.8] },
  { name: "Spools_Pair", box: [-42.3, -56.3, -38, -53] },
  { name: "Pallet_Cargo", box: [-42.7, -52.5, -41.1, -50.5], align: true },
  { name: "Pallet_Tarp", box: [-34.3, 32.95, -32.7, 34.8], align: true },
  { name: "Pallet_TarpStack", box: [-34.3, 31.1, -29.9, 33.05], align: true },
  { name: "Drums_Red", box: [-31.9, 29.8, -29.9, 31.25], align: true },
  { name: "Drums_Blue", box: [-33.7, 29.8, -31.7, 31.25], align: true },
  { name: "Skip_Green", box: [-49.3, -3.5, -45.2, -0.7], align: true },
  { name: "Skips_Dark", box: [41.8, -25.8, 45.9, -16.4], align: true },
  { name: "Beams", box: [-45.4, -60.5, -43.7, -54], align: true },
  { name: "Planks", box: [-49, -21.1, -42.6, -18.7], align: true },
  { name: "Bin", box: [-15.2, 40.2, -13.5, 42], align: true },
  // Street furniture and fences.
  { name: "Light_Street", box: [-13.8, -43.7, -12.6, -39.8] },
  { name: "Light_Flood", box: [73.5, -25.5, 77.1, -23.6] },
  { name: "Pole_Wood", box: [53.1, -62.5, 54.2, -60.8] },
  { name: "Fence_Metal", box: [78.8, -38.8, 79.2, -34.8] },
  { name: "Fence_Wood", box: [-23.2, 36.7, -22.6, 46.2] },
  // Greenery.
  { name: "Tree_Birch", box: [-7.8, -4.6, 0.4, 3.9], minTop: 3 },
  { name: "Tree_Planter", box: [71.2, -3.6, 73.1, -1.5] },
  // Ground details.
  { name: "Drain", box: [-26.2, -56.4, -25.2, -54.5], noCollide: true },
  { name: "Manhole", box: [7.3, 30.6, 9.6, 33], noCollide: true },
];

interface Geo { P: Float32Array; N: Float32Array; UV: Float32Array; UV1: Float32Array; M: Uint8Array }

/** The FBX's single mesh as flat triangle arrays in meters, asphalt at y = 0. */
async function loadSource(): Promise<{ geo: Geo; materials: string[] }> {
  // The ES module build, the one FBXLoader imports (this script itself runs as CommonJS).
  const THREE: typeof THREE_NS = await import("three");
  // Textures are wired up by hand below; the loader only needs to not touch the DOM.
  THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
  const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
  const buf = fs.readFileSync(FBX);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
  root.updateMatrixWorld(true);
  const mesh = root.children[0] as THREE_NS.Mesh;
  // Blender exported centimeters (node scale 100): back to meters, then drop the asphalt to 0.
  const m = mesh.matrixWorld.clone().premultiply(new THREE.Matrix4().makeScale(0.01, 0.01, 0.01));
  m.premultiply(new THREE.Matrix4().makeTranslation(0, -ASPHALT, 0));
  const g = mesh.geometry.clone().applyMatrix4(m);
  const tris = g.attributes.position.count / 3;
  const M = new Uint8Array(tris);
  for (const gr of mesh.geometry.groups) M.fill(gr.materialIndex!, gr.start / 3, (gr.start + gr.count) / 3);
  return {
    geo: {
      P: g.attributes.position.array as Float32Array,
      N: g.attributes.normal.array as Float32Array,
      UV: g.attributes.uv.array as Float32Array,
      UV1: g.attributes.uv1.array as Float32Array,
      M,
    },
    materials: (mesh.material as THREE_NS.Material[]).map((x) => x.name),
  };
}

interface Component { tris: number[]; min: number[]; max: number[] }

/** Connected pieces of the mesh (triangles sharing welded vertices). The largest is the terrain. */
function components(geo: Geo): Component[] {
  const { P } = geo;
  const T = P.length / 9;
  const ids = new Map<string, number>();
  const vert = new Uint32Array(T * 3);
  for (let i = 0; i < T * 3; i++) {
    const k = `${Math.round(P[i * 3] * 500)},${Math.round(P[i * 3 + 1] * 500)},${Math.round(P[i * 3 + 2] * 500)}`;
    let v = ids.get(k);
    if (v === undefined) ids.set(k, (v = ids.size));
    vert[i] = v;
  }
  const parent = Int32Array.from({ length: ids.size }, (_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < T; t++) {
    const a = find(vert[t * 3]);
    parent[find(vert[t * 3 + 1])] = a;
    parent[find(vert[t * 3 + 2])] = a;
  }
  const byRoot = new Map<number, number[]>();
  for (let t = 0; t < T; t++) {
    const r = find(vert[t * 3]);
    let list = byRoot.get(r);
    if (!list) byRoot.set(r, (list = []));
    list.push(t);
  }
  return [...byRoot.values()].map((tris) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (let k = 0; k < 9; k++) {
      const a = k % 3, v = P[t * 9 + k];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
    return { tris, min, max };
  }).sort((a, b) => b.tris.length - a.tris.length);
}

const inside = (c: Component, [x0, z0, x1, z1]: Box) => c.min[0] >= x0 && c.max[0] <= x1 && c.min[2] >= z0 && c.max[2] <= z1;

/** Rotation (about Y) that makes the footprint's bounding rectangle smallest. */
function squareAngle(geo: Geo, tris: number[]) {
  const pts: number[] = [];
  for (const t of tris) for (let k = 0; k < 3; k++) pts.push(geo.P[t * 9 + k * 3], geo.P[t * 9 + k * 3 + 2]);
  let best = 0, bestArea = Infinity;
  for (let d = -45; d <= 45; d += 0.1) {
    const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i] * c - pts[i + 1] * s, z = pts[i] * s + pts[i + 1] * c;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const area = (x1 - x0) * (z1 - z0);
    if (area < bestArea - 1e-6) { bestArea = area; best = a; }
  }
  return Math.abs(best) < (0.3 * Math.PI) / 180 ? 0 : best;
}

/** Triangle soup for one piece, in piece space. `mat` indexes MATERIALS. */
interface Soup { P: number[]; N: number[]; UV: number[]; UV1: number[]; M: number[] }

function extract(geo: Geo, tris: number[], spec: PieceSpec): Soup {
  const angle = (spec.align ? squareAngle(geo, tris) : 0) + (spec.turn ?? 0);
  const c = Math.cos(angle), s = Math.sin(angle);
  const out: Soup = { P: [], N: [], UV: [], UV1: [], M: [] };
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k;
      const x = geo.P[v * 3], z = geo.P[v * 3 + 2], nx = geo.N[v * 3], nz = geo.N[v * 3 + 2];
      out.P.push(x * c - z * s, geo.P[v * 3 + 1], x * s + z * c);
      out.N.push(nx * c - nz * s, geo.N[v * 3 + 1], nx * s + nz * c);
      out.UV.push(geo.UV[v * 2], geo.UV[v * 2 + 1]);
      out.UV1.push(geo.UV1[v * 2], geo.UV1[v * 2 + 1]);
    }
    out.M.push(geo.M[t]);
  }
  // Footprint center to the origin; base on the asphalt (or on its lowest point).
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity;
  for (let i = 0; i < out.P.length; i += 3) {
    x0 = Math.min(x0, out.P[i]); x1 = Math.max(x1, out.P[i]);
    y0 = Math.min(y0, out.P[i + 1]);
    z0 = Math.min(z0, out.P[i + 2]); z1 = Math.max(z1, out.P[i + 2]);
  }
  const [cx, cz] = spec.origin ?? [(x0 + x1) / 2, (z0 + z1) / 2], cy = spec.drop ? y0 : 0;
  for (let i = 0; i < out.P.length; i += 3) { out.P[i] -= cx; out.P[i + 1] -= cy; out.P[i + 2] -= cz; }
  return out;
}

// Material slots (source order).
const MATERIALS = ["Color", "Color_Profile", "Color_Wood", "Color_Brick", "Branches", "kust", "Glass"] as const;

/** UV of a palette swatch (16 px cells in Color.png). */
const swatch = (col: number, row: number): [number, number] => [(col * 16 + 8) / 256, 1 - (row * 16 + 8) / 256];
const STEEL = swatch(4, 2); //     #616268
const TREAD = swatch(15, 2); //    #8e8e8e
const RAIL = swatch(2, 1); //      #bc4a3c, safety red
const DARK = swatch(4, 1); //      #444549
const CONCRETE = swatch(0, 2); //  #a5a5a4
const CLADDING = swatch(0, 1); //  #b5b4b3
const ROOF = swatch(5, 1); //      #345168, the kit warehouse's blue
const TRIM = swatch(5, 3); //      #386589
const WOOD = swatch(1, 0); //      #ba8c63
const WOOD_DARK = swatch(1, 2); // #6b5039
const CONTAINER_COLORS = { Container_Red: swatch(2, 1), Container_Blue: swatch(5, 3), Container_Green: swatch(10, 2) };

// Slots in MATERIALS: the profile and wood materials tile their normal maps over UV1.
const M_PLAIN = 0, M_PROFILE = 1, M_WOOD = 2, M_GLASS = 6;

type V = [number, number, number];
type UV = [number, number];
interface BoxOpts { mat?: number; tile?: number; collide?: boolean; bottom?: boolean; draw?: boolean }

/** Corner indices (bit 0: x1, bit 1: y1, bit 2: z1) of each box face, counterclockwise from outside. */
const BOX_FACES = [[2, 6, 7, 3], [0, 1, 5, 4], [4, 5, 7, 6], [1, 0, 2, 3], [5, 1, 3, 7], [0, 4, 6, 2]];

/**
 * Geometry for the procedural pieces: triangles in the kit's palette and normal maps, with a
 * collision mesh built alongside. `at` moves the origin for the calls that follow.
 */
class Builder {
  readonly soup: Soup = { P: [], N: [], UV: [], UV1: [], M: [] };
  private cP: number[] = [];
  private cI: number[] = [];
  private o: V = [0, 0, 0];

  at(x: number, y: number, z: number) { this.o = [x, y, z]; return this; }

  private move = (v: number[]): V => [v[0] + this.o[0], v[1] + this.o[1], v[2] + this.o[2]];

  /**
   * A flat polygon (triangle or quad), turned to face `facing`. UV1 is projected on the face's
   * main axis at `tile` meters per repeat, so ribs and planks run vertically on walls.
   */
  face(pts: number[][], facing: number[], uv: UV, { mat = M_PLAIN, tile = 2, collide = false, draw = true }: BoxOpts = {}) {
    let v = pts.map(this.move);
    const n = normal(v);
    if (n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2] < 0) { v = v.reverse(); n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
    const order = v.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
    if (draw) {
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      for (const i of order) {
        const p = v[i];
        this.soup.P.push(...p);
        this.soup.N.push(...n);
        this.soup.UV.push(...uv);
        const [s, t] = ay >= ax && ay >= az ? [p[0], p[2]] : ax >= az ? [p[2], p[1]] : [p[0], p[1]];
        this.soup.UV1.push(s / tile, t / tile);
      }
      for (let k = 0; k < order.length / 3; k++) this.soup.M.push(mat);
    }
    if (collide) {
      const base = this.cP.length / 3;
      for (const p of v) this.cP.push(...p);
      for (const i of order) this.cI.push(base + i);
    }
  }

  /** Axis-aligned box from min to max corner; it collides unless told otherwise. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, uv: UV, { collide = true, bottom = false, ...opts }: BoxOpts = {}) {
    const corner = (i: number) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
    const center = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    BOX_FACES.forEach((f, i) => {
      // Boxes standing on the ground skip their hidden bottom (collision keeps it closed).
      const pts = f.map(corner);
      const out = sub(pts[0], center).map((c, k) => c + sub(pts[2], center)[k]);
      this.face(pts, out, uv, { ...opts, collide, draw: (opts.draw ?? true) && (i !== 1 || bottom) });
    });
  }

  collision(): CollisionMesh {
    return { positions: new Float32Array(this.cP), indices: new Uint32Array(this.cI) };
  }
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function normal(v: number[][]): V {
  const u = sub(v[1], v[0]), w = sub(v[2], v[0]);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/**
 * Steel stairs rising `rise` meters toward local -Z (the top edge at z = 0, the foot at
 * z = +run), centered on x. Visual treads, stringers and rails. The collision is a smooth ramp
 * between two rail-high side walls, so the handrails stop you like real ones.
 */
function stairs(b: Builder, rise: number, width: number, steps: number) {
  const run = steps * 0.43;
  /** A slanted beam along the flight: a box sheared from foot (z = run, y = yFoot) to top (z = 0, y = yTop). */
  const beam = (x0: number, x1: number, yFoot: number, yTop: number, h: number, uv: UV, opts: BoxOpts = {}) => {
    const f0 = [x0, yFoot, run], f1 = [x1, yFoot, run], t0 = [x0, yTop, 0], t1 = [x1, yTop, 0];
    const up = (v: number[]) => [v[0], v[1] + h, v[2]];
    const ramp = [0, run, rise]; // up the slope's normal
    b.face([up(f0), up(f1), up(t1), up(t0)], ramp, uv, opts); // top
    b.face([f0, t0, t1, f1], ramp.map((c) => -c), uv, opts); // bottom
    b.face([f0, up(f0), up(t0), t0], [-1, 0, 0], uv, opts);
    b.face([f1, t1, up(t1), up(f1)], [1, 0, 0], uv, opts);
    b.face([f0, f1, up(f1), up(f0)], [0, 0, 1], uv, opts); // foot end
    b.face([t0, up(t0), up(t1), t1], [0, 0, -1], uv, opts); // top end
  };
  const hw = width / 2, sw = 0.08;
  const stepH = rise / steps, depth = run / steps;
  for (let i = 0; i < steps; i++) {
    const y = stepH * (i + 1), zFront = run - depth * i;
    b.box(-hw + sw, y - 0.05, zFront - depth, hw - sw, y, zFront, TREAD, { collide: false, bottom: true });
  }
  for (const x of [-hw, hw - sw]) {
    beam(x, x + sw, -0.25, rise - 0.25, 0.3, STEEL); // stringer
    beam(x, x + sw, 0.95, rise + 0.95, 0.06, RAIL); // handrail
    for (const z of [run - 0.2, run / 2, 0.15]) {
      const y = rise * (1 - z / run);
      b.box(x, y, z - 0.03, x + sw, y + 0.95, z + 0.03, RAIL, { collide: false });
    }
    // The rail as a wall: from under the treads to just over the handrail.
    beam(x, x + sw, -0.2, rise - 0.2, 1.25, RAIL, { draw: false, collide: true });
  }
  // The walking surface: one ramp, a little longer than the treads at the foot.
  b.face([[-hw, 0, run + 0.2], [hw, 0, run + 0.2], [hw, rise, 0], [-hw, rise, 0]], [0, 1, 0], TREAD, { draw: false, collide: true });
}

/** A wooden crate of side `s`: plank panels inside a frame of battens. */
function crate(s: number) {
  const b = new Builder(), h = s / 2, e = 0.08, inset = 0.035;
  b.box(-h + inset, 0, -h + inset, h - inset, s - inset, h - inset, WOOD, { mat: M_WOOD, tile: s * 0.9, collide: false });
  const batten = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    b.box(x0, y0, z0, x1, y1, z1, WOOD_DARK, { mat: M_WOOD, tile: 0.6, collide: false, bottom: y0 > 0 });
  for (const x of [-h, h - e]) for (const z of [-h, h - e]) batten(x, 0, z, x + e, s, z + e);
  for (const y of [0, s - e]) {
    batten(-h + e, y, -h, h - e, y + e, -h + e);
    batten(-h + e, y, h - e, h - e, y + e, h);
    batten(-h, y, -h + e, -h + e, y + e, h - e);
    batten(h - e, y, -h + e, h, y + e, h - e);
  }
  b.box(-h, 0, -h, h, s, h, WOOD, { draw: false });
  return b;
}

/** A 20 ft shipping container along local x, its doors at +x. */
function container(color: UV) {
  const b = new Builder(), L = 3.03, W = 1.22, H = 2.59, p = 0.14, r = 0.12;
  b.box(-L + 0.04, r, -W + 0.04, L - 0.04, H - r, W - 0.04, color, { mat: M_PROFILE, tile: 1.6, collide: false });
  const frame = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => b.box(x0, y0, z0, x1, y1, z1, color, { collide: false, bottom: y0 > 0 });
  for (const x of [-L, L - p]) for (const z of [-W, W - p]) frame(x, 0, z, x + p, H, z + p);
  for (const y of [0, H - r]) {
    frame(-L + p, y, -W, L - p, y + r, -W + p);
    frame(-L + p, y, W - p, L - p, y + r, W);
    frame(-L, y, -W + p, -L + p, y + r, W - p);
    frame(L - p, y, -W + p, L, y + r, W - p);
  }
  // Door end: a seam down the middle and four locking bars.
  b.box(L - 0.04, r, -0.02, L + 0.01, H - r, 0.02, DARK, { collide: false });
  for (const z of [-0.85, -0.4, 0.4, 0.85]) b.box(L - 0.02, 0.3, z - 0.03, L + 0.04, H - 0.3, z + 0.03, STEEL, { collide: false });
  b.box(-L, 0, -W, L, H, W, color, { draw: false });
  return b;
}

/**
 * "Depot": a warehouse you can fight through, mirror-symmetric across x = 0. Roller doors in
 * both gable ends, a door in each long wall, and a mezzanine along the north wall with a stair
 * at each end and a parapet to shoot over. Footprint 20 x 14 m, 6.8 m to the ridge.
 */
function depot() {
  const b = new Builder();
  const X = 10, Z = 7, T = 0.25, EAVE = 5.2, RIDGE = 6.6;
  const xi = X - T, zi = Z - T;
  const wall = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    b.box(x0, y0, z0, x1, y1, z1, CLADDING, { mat: M_PROFILE, tile: 1.4 });
  const trim = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, uv = TRIM) =>
    b.box(x0, y0, z0, x1, y1, z1, uv, { collide: false, bottom: y0 > 0 });

  // Long walls (north and south), each with a door in the middle.
  const door = { half: 1.5, h: 2.3 };
  for (const [z0, z1] of [[-Z, -zi], [zi, Z]]) {
    wall(-X, 0, z0, -door.half, EAVE, z1);
    wall(door.half, 0, z0, X, EAVE, z1);
    wall(-door.half, door.h, z0, door.half, EAVE, z1);
    for (const x of [-door.half - 0.15, door.half]) trim(x, 0, z0 - 0.06, x + 0.15, door.h + 0.15, z1 + 0.06);
    trim(-door.half - 0.15, door.h, z0 - 0.06, door.half + 0.15, door.h + 0.15, z1 + 0.06);
    // Window bands, glazed on both faces.
    for (const [w0, w1] of [[-8.6, -4.2], [4.2, 8.6]]) {
      for (const [g0, g1] of [[z0 - 0.04, z0], [z1, z1 + 0.04]]) b.box(w0, 3.1, g0, w1, 4.3, g1, ROOF, { mat: M_GLASS, collide: false, bottom: true });
      trim(w0 - 0.1, 3.0, z0 - 0.07, w1 + 0.1, 3.1, z1 + 0.07, DARK);
    }
  }
  // Gable ends (west and east): a roller-door opening, then the gable up to the ridge.
  const roller = { half: 2.25, h: 4 };
  for (const [x0, x1, side] of [[-X, -xi, -1], [xi, X, 1]]) {
    wall(x0, 0, -zi, x1, EAVE, -roller.half);
    wall(x0, 0, roller.half, x1, EAVE, zi);
    wall(x0, roller.h, -roller.half, x1, EAVE, roller.half);
    for (const z of [-roller.half - 0.2, roller.half]) trim(x0 - 0.08, 0, z, x1 + 0.08, roller.h + 0.2, z + 0.2, DARK);
    trim(x0 - 0.08, roller.h, -roller.half - 0.2, x1 + 0.08, roller.h + 0.2, roller.half + 0.2, DARK);
    // The rolled-up shutter's drum over the opening, outside.
    const outer = side < 0 ? x0 : x1;
    trim(Math.min(outer, outer + side * 0.45), roller.h + 0.2, -roller.half, Math.max(outer, outer + side * 0.45), roller.h + 0.65, roller.half, STEEL);
    for (const x of [x0, x1]) {
      const pts = [[x, EAVE, -Z], [x, EAVE, Z], [x, RIDGE, 0]];
      b.face(pts, [x === outer ? side : -side, 0, 0], CLADDING, { mat: M_PROFILE, tile: 1.4, collide: true });
    }
  }
  for (const x of [-X - 0.1, X - 0.15]) for (const z of [-Z - 0.1, Z - 0.15]) trim(x, 0, z, x + 0.25, EAVE, z + 0.25); // corner posts

  // Roof: two pitched slabs with an overhang, and a ridge cap.
  const t = 0.18, over = 0.5, xr = X + 0.4, k = (RIDGE - EAVE) / Z;
  for (const s of [-1, 1]) {
    const ze = s * (Z + over), ye = EAVE - over * k;
    const top = [[-xr, RIDGE + t, 0], [xr, RIDGE + t, 0], [xr, ye + t, ze], [-xr, ye + t, ze]];
    const under = top.map(([x, y, z]) => [x, y - t, z]);
    b.face(top, [0, 1, s * k], ROOF, { mat: M_PROFILE, tile: 1.2, collide: true });
    b.face(under, [0, -1, 0], ROOF, { mat: M_PROFILE, tile: 1.2, collide: true });
    b.face([under[2], under[3], top[3], top[2]], [0, 0, s], TRIM);
    b.face([under[0], under[3], top[3], top[0]], [-1, 0, 0], TRIM);
    b.face([under[1], under[2], top[2], top[1]], [1, 0, 0], TRIM);
  }
  trim(-xr, RIDGE + t - 0.04, -0.25, xr, RIDGE + t + 0.08, 0.25);

  // Floor slab (the asphalt underneath is the walking surface).
  b.box(-xi, 0, -zi, xi, 0.03, zi, CONCRETE, { collide: false });

  // Mezzanine: a steel deck on posts, a parapet along its edge and stairs up at each end.
  const deck = { x: 6.5, front: -3.9, y: 2.6 }, stair = { x: 5, width: 1.6 };
  b.box(-deck.x, deck.y - 0.2, -zi, deck.x, deck.y, deck.front, STEEL, { bottom: true });
  for (const x of [-6.3, -2.1, 2.1, 6.3]) b.box(x - 0.1, 0, deck.front - 0.25, x + 0.1, deck.y - 0.2, deck.front - 0.05, DARK);
  const gap = stair.x - stair.width / 2, gapEnd = stair.x + stair.width / 2;
  const parapet = (x0: number, z0: number, x1: number, z1: number) => {
    b.box(x0, deck.y, z0, x1, deck.y + 1.05, z1, STEEL);
    b.box(x0 - 0.02, deck.y + 1.05, z0 - 0.02, x1 + 0.02, deck.y + 1.12, z1 + 0.02, RAIL, { bottom: true });
  };
  for (const [x0, x1] of [[-deck.x, -gapEnd], [-gap, gap], [gapEnd, deck.x]]) parapet(x0, deck.front - 0.1, x1, deck.front);
  for (const x of [-deck.x, deck.x - 0.1]) parapet(x, -zi, x + 0.1, deck.front - 0.1);
  for (const x of [-stair.x, stair.x]) {
    b.at(x, 0, deck.front);
    stairs(b, deck.y, stair.width, 8);
  }
  b.at(0, 0, 0);
  return b;
}

function addPiece(doc: Document, scene: Scene, name: string, soup: Soup, mats: Material[]) {
  // INDUSTRIAL_DUMP=dir writes each piece's triangles for offline previews.
  const dump = process.env.INDUSTRIAL_DUMP;
  if (dump) {
    fs.mkdirSync(dump, { recursive: true });
    fs.writeFileSync(path.join(dump, `${name}.pos`), new Float32Array(soup.P));
    fs.writeFileSync(path.join(dump, `${name}.nrm`), new Float32Array(soup.N));
    fs.writeFileSync(path.join(dump, `${name}.uv`), new Float32Array(soup.UV));
    fs.writeFileSync(path.join(dump, `${name}.mat`), new Uint8Array(soup.M));
  }
  const node = doc.createNode(name);
  const mesh = doc.createMesh(name);
  const buffer = doc.getRoot().listBuffers()[0];
  const byMat = new Map<number, number[]>();
  soup.M.forEach((m, t) => { let l = byMat.get(m); if (!l) byMat.set(m, (l = [])); l.push(t); });
  for (const [m, tris] of byMat) {
    // Weld identical vertices so the index buffer does real work.
    const seen = new Map<string, number>();
    const P: number[] = [], N: number[] = [], UV: number[] = [], UV1: number[] = [], idx: number[] = [];
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const v = t * 3 + k;
      // FBXLoader UVs have their origin at the bottom left (three's flipY); glTF's is the top left.
      const vals = [soup.P[v * 3], soup.P[v * 3 + 1], soup.P[v * 3 + 2], soup.N[v * 3], soup.N[v * 3 + 1], soup.N[v * 3 + 2], soup.UV[v * 2], 1 - soup.UV[v * 2 + 1], soup.UV1[v * 2], 1 - soup.UV1[v * 2 + 1]];
      const key = vals.map((x) => Math.round(x * 1e4)).join(",");
      let i = seen.get(key);
      if (i === undefined) {
        seen.set(key, (i = P.length / 3));
        P.push(vals[0], vals[1], vals[2]); N.push(vals[3], vals[4], vals[5]); UV.push(vals[6], vals[7]); UV1.push(vals[8], vals[9]);
      }
      idx.push(i);
    }
    const acc = (type: "VEC3" | "VEC2" | "SCALAR", arr: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>) =>
      doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", acc("VEC3", new Float32Array(P)))
      .setAttribute("NORMAL", acc("VEC3", new Float32Array(N)))
      .setAttribute("TEXCOORD_0", acc("VEC2", new Float32Array(UV)))
      .setIndices(acc("SCALAR", P.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)))
      .setMaterial(mats[m]);
    // The second UV set tiles the profile / wood / brick normal maps.
    if (m >= 1 && m <= 3) prim.setAttribute("TEXCOORD_1", acc("VEC2", new Float32Array(UV1)));
    mesh.addPrimitive(prim);
  }
  // The mesh sits on a child: quantization puts its dequantize transform on the mesh's node,
  // and the client reads parts relative to the piece node.
  node.addChild(doc.createNode(`${name}_mesh`).setMesh(mesh));
  scene.addChild(node);
  return node;
}

function createMaterials(doc: Document): Material[] {
  const tex = (file: string, name: string): Texture =>
    doc.createTexture(name).setImage(fs.readFileSync(path.join(DIR, "textures", file))).setMimeType("image/png").setURI(`${name}.png`);
  const palette = tex("Color.png", "industrial_palette");
  const normals = {
    Color_Profile: tex("Normal.png", "industrial_profile_n"),
    Color_Wood: tex("normal_wood.png", "industrial_wood_n"),
    Color_Brick: tex("Normal_block.png", "industrial_brick_n"),
  };
  const leaves = { Branches: tex("Branches.png", "industrial_branches"), kust: tex("kust.png", "industrial_bush") };
  return MATERIALS.map((name) => {
    // Names matter on the client: "Leaves" gets alpha-test foliage handling, "Glass" a glossy finish.
    const m = doc.createMaterial(name === "Glass" ? "Industrial_Glass" : name in leaves ? `Leaves_${name}` : `Industrial_${name}`)
      .setRoughnessFactor(0.85).setMetallicFactor(0).setDoubleSided(true);
    if (name === "Glass") return m.setBaseColorFactor([0.34, 0.4, 0.62, 1]).setRoughnessFactor(0.15);
    if (name in leaves) return m.setBaseColorTexture(leaves[name as keyof typeof leaves]).setAlphaMode("MASK").setAlphaCutoff(0.5);
    m.setBaseColorTexture(palette);
    if (name in normals) {
      m.setNormalTexture(normals[name as keyof typeof normals]);
      m.getNormalTextureInfo()!.setTexCoord(1);
    }
    return m;
  });
}

export async function importIndustrial() {
  const { geo, materials } = await loadSource();
  if (materials.join() !== MATERIALS.join()) throw new Error(`unexpected materials: ${materials.join()}`);
  const comps = components(geo);
  const terrain = comps.shift()!;
  console.log(`[industrial] ${geo.M.length} source triangles in ${comps.length + 1} parts`);

  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene("kit");
  const mats = createMaterials(doc);
  const collision = new Map<string, CollisionMesh | null>();
  const pieces: Record<string, PieceInfo> = {};
  const nodes: Node[] = [];
  const noCollide = new Set<string>(["Island"]);

  for (const spec of SPECS) {
    const parts = comps.filter((c) => inside(c, spec.box) && !spec.skip?.some((b) => inside(c, b)) && c.max[1] >= (spec.minTop ?? -Infinity));
    if (!parts.length) throw new Error(`no parts for ${spec.name}`);
    const tris = parts.flatMap((c) => c.tris);
    nodes.push(addPiece(doc, scene, spec.name, extract(geo, tris, spec), mats));
    if (spec.noCollide) noCollide.add(spec.name);
  }

  // The floating-island terrain, centered on its asphalt yard (138 x 114 m inside a curb and a
  // grass verge; measured by palette color, since the verge is partly flat too).
  nodes.push(addPiece(doc, scene, "Island", extract(geo, terrain.tris, { name: "Island", box: [0, 0, 0, 0], origin: YARD_CENTER }), mats));

  // Pieces the pack doesn't have, built here from its palette: stairs, box cover and an
  // enterable warehouse.
  const steel = new Builder();
  stairs(steel, 3.6, 1.8, 12);
  const built = new Map<string, Builder>([
    ["Stairs_Steel", steel],
    ["Crate", crate(1.3)],
    ["Crate_Small", crate(0.9)],
    ...Object.entries(CONTAINER_COLORS).map(([name, color]) => [name, container(color)] as [string, Builder]),
    ["Depot", depot()],
  ]);
  for (const [name, b] of built) nodes.push(addPiece(doc, scene, name, b.soup, mats));

  for (const node of nodes) {
    const name = node.getName();
    pieces[name] = pieceBounds(node);
    const b = built.get(name);
    if (b) collision.set(name, b.collision());
    else collision.set(name, noCollide.has(name) ? null : buildCollision(node, /Leaves/, 0.04));
  }
  const { ranges, positionsByteLength } = writeCollisionBin(path.join(PUBLIC_MODELS, "industrial.collision.bin"), collision);
  for (const [name, r] of ranges) pieces[name].col = r;

  const bytes = await writeGLB(doc, path.join(PUBLIC_MODELS, "industrial.glb"));
  writeJSON(path.join(GENERATED, "industrial-pieces.json"), { positionsByteLength, pieces });
  let tris = 0;
  for (const r of ranges.values()) tris += r[3] / 3;
  console.log(`[industrial] ${nodes.length} pieces, ${(bytes / 1e6).toFixed(2)} MB glb, ${ranges.size} colliders (${tris} tris)`);
  for (const [name, p] of Object.entries(pieces)) {
    const s = p.max.map((v, i) => (v - p.min[i]).toFixed(2));
    console.log(`  ${name.padEnd(18)} ${s.join(" x ")}  y ${p.min[1].toFixed(2)}..${p.max[1].toFixed(2)}`);
  }
}
