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

// Material slots (source order, plus the procedural steel).
const MATERIALS = ["Color", "Color_Profile", "Color_Wood", "Color_Brick", "Branches", "kust", "Glass"] as const;

/** UV of a palette swatch (16 px cells in Color.png). */
const swatch = (col: number, row: number): [number, number] => [(col * 16 + 8) / 256, 1 - (row * 16 + 8) / 256];
const STEEL = swatch(4, 2); //  #616268
const TREAD = swatch(15, 2); // #8e8e8e
const RAIL = swatch(2, 1); //   #bc4a3c, safety red

/**
 * Steel stairs rising `rise` meters toward local -Z (the top edge at z = 0, the foot at
 * z = +run), centered on x. Visual treads, stringers and rails; the collision is a smooth ramp.
 */
function stairs(rise: number, width: number, steps: number): { soup: Soup; collision: CollisionMesh } {
  const soup: Soup = { P: [], N: [], UV: [], UV1: [], M: [] };
  const run = steps * 0.43;
  const quad = (a: number[], b: number[], c: number[], d: number[], uv: [number, number]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const v of [a, b, c, a, c, d]) { soup.P.push(...v); soup.N.push(n[0] / len, n[1] / len, n[2] / len); soup.UV.push(...uv); soup.UV1.push(0, 0); }
    soup.M.push(0, 0);
  };
  /** Axis-aligned box from min to max corner. */
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, uv: [number, number]) => {
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], uv); // top
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], uv); // bottom
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uv); // +z
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], uv); // -z
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], uv); // +x
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], uv); // -x
  };
  /** A slanted beam along the flight: a box sheared from foot (z = run, y = yFoot) to top (z = 0, y = yTop). */
  const beam = (x0: number, x1: number, yFoot: number, yTop: number, h: number, uv: [number, number]) => {
    const f0 = [x0, yFoot, run], f1 = [x1, yFoot, run], t0 = [x0, yTop, 0], t1 = [x1, yTop, 0];
    const up = (v: number[]) => [v[0], v[1] + h, v[2]];
    quad(up(f0), up(f1), up(t1), up(t0), uv); // top
    quad(f0, t0, t1, f1, uv); // bottom
    quad(f0, up(f0), up(t0), t0, uv); // -x side
    quad(f1, t1, up(t1), up(f1), uv); // +x side
    quad(f0, f1, up(f1), up(f0), uv); // foot end
    quad(t0, up(t0), up(t1), t1, uv); // top end
  };
  const hw = width / 2, sw = 0.08;
  const stepH = rise / steps, depth = run / steps;
  for (let i = 0; i < steps; i++) {
    const y = stepH * (i + 1), zFront = run - depth * i;
    box(-hw + sw, y - 0.05, zFront - depth, hw - sw, y, zFront, TREAD);
  }
  for (const x of [-hw, hw - sw]) beam(x, x + sw, -0.25, rise - 0.25, 0.3, STEEL); // stringers
  for (const x of [-hw, hw - sw]) {
    beam(x, x + sw, 0.95, rise + 0.95, 0.06, RAIL); // handrail
    for (const z of [run - 0.2, run / 2, 0.15]) {
      const y = rise * (1 - z / run);
      box(x, y, z - 0.03, x + sw, y + 0.95, z + 0.03, RAIL);
    }
  }
  // Collision: the walking surface as one ramp, slightly wider than the treads.
  const collision: CollisionMesh = {
    positions: new Float32Array([-hw, 0, run + 0.2, hw, 0, run + 0.2, hw, rise, 0, -hw, rise, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]), // facing up: the navmesh only walks up-facing triangles
  };
  return { soup, collision };
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

  const steel = stairs(3.6, 1.4, 12);
  nodes.push(addPiece(doc, scene, "Stairs_Steel", steel.soup, mats));

  for (const node of nodes) {
    const name = node.getName();
    pieces[name] = pieceBounds(node);
    if (name === "Stairs_Steel") collision.set(name, steel.collision);
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
