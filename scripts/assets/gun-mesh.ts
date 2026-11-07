import fs from "node:fs";
import path from "node:path";
import { type Document } from "@gltf-transform/core";
import { MeshoptSimplifier } from "meshoptimizer";
import { GENERATED, PUBLIC_MODELS, io, writeGLB, writeJSON } from "./common";

// Shared by the guns imported from dense third-party models: swaps them into
// public/models/weapons.glb in two levels of detail. Their slots and rail teeth are real holes,
// which a simplifier cannot close, only crush into shards. Up close that shows, so the player's own
// gun (`<id>_near`, one on screen) keeps them. Every other player's gun (`<id>`, the one that
// multiplies with the player count) stays at the budget of the other guns, too small to see them.

/** Faces further apart than this stay a hard edge. */
const CREASE = Math.cos(22 * Math.PI / 180);

export type Look = { color: [number, number, number]; metal: number; rough: number };
export interface Mesh { positions: Float32Array; indices: Uint32Array }
/** Final meshes by material. A prefix ("Mag_", "Charge_", "Bolt_", "Cyl_", "Hammer_") is how the client finds a moving part. */
export type GunPieces = Map<string, { look: Look; meshes: Mesh[] }>;

/** Swaps both levels of `id` in weapons.glb and updates its bounds and muzzle point. */
export async function replaceGun(id: string, length: number, levels: { near: GunPieces; far: GunPieces }) {
  const file = path.join(PUBLIC_MODELS, "weapons.glb");
  const doc = await io.read(file);
  const far = addLevel(doc, id, weldMoving(levels.far));
  const near = addLevel(doc, `${id}_near`, levels.near);
  await writeGLB(doc, file, { compress: false });

  // Bounds and muzzle point, as the other guns (the centroid of the front-most vertices).
  const all = near.positions;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < all.length; i++) { lo[i % 3] = Math.min(lo[i % 3], all[i]); hi[i % 3] = Math.max(hi[i % 3], all[i]); }
  const front: number[][] = [];
  for (let i = 0; i < all.length; i += 3) if (all[i + 2] < lo[2] + 0.01) front.push([all[i], all[i + 1], all[i + 2]]);
  const muzzle = [0, 1, 2].map((k) => front.reduce((a, v) => a + v[k], 0) / front.length);
  const r = (x: number) => Math.round(x * 10000) / 10000 + 0;
  const metaFile = path.join(GENERATED, "weapons-meta.json");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  meta[id] = { length, muzzle: muzzle.map(r), min: lo.map(r), max: hi.map(r) };
  writeJSON(metaFile, meta);
  return { near: near.tris, far: far.tris, meta: meta[id] };
}

/** Reads an FBX as data. FBXLoader is written for the browser, but only touches the DOM for textures, which are not loaded here. */
export async function readFbx(file: string) {
  const g = globalThis as unknown as { window?: unknown; self?: unknown; document?: unknown };
  g.window ??= globalThis;
  g.self ??= globalThis;
  g.document ??= { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }) };
  const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
  const data = fs.readFileSync(file);
  const root = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.length) as ArrayBuffer, "");
  root.updateMatrixWorld(true);
  return root;
}

/** At range nobody sees a handle, bolt, cylinder or hammer move, so they stay part of the gun: fewer draws per player. */
function weldMoving(pieces: GunPieces) {
  const out: GunPieces = new Map();
  for (const [name, piece] of pieces) {
    const key = name.replace(/^(Charge|Bolt|Cyl|Hammer)_/, "");
    const found = out.get(key);
    if (found) found.meshes.push(...piece.meshes);
    else out.set(key, { look: piece.look, meshes: [...piece.meshes] });
  }
  return out;
}

function addLevel(doc: Document, id: string, pieces: GunPieces) {
  const holder = gunNode(doc, id);
  const mesh = doc.createMesh(`${id}_mesh`);
  const buffer = doc.getRoot().listBuffers()[0];
  const all: number[] = [];
  let tris = 0;
  for (const [name, { look, meshes }] of pieces) {
    const { positions, normals, indices } = shade(meshes);
    tris += indices.length / 3;
    for (const v of positions) all.push(v);
    mesh.addPrimitive(doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer))
      .setMaterial(doc.createMaterial(`Gun_${id}_${name}`)
        .setBaseColorFactor([...look.color, 1])
        .setMetallicFactor(look.metal)
        .setRoughnessFactor(look.rough)));
  }
  holder.addChild(doc.createNode(`${id}_mesh`).setMesh(mesh));
  return { positions: all, tris };
}

const weldKey = (p: ArrayLike<number>, i: number) => `${Math.round(p[i * 3] * 2e4)},${Math.round(p[i * 3 + 1] * 2e4)},${Math.round(p[i * 3 + 2] * 2e4)}`;

/** Welds by position first: the simplifier treats a split vertex as a border it must not move. */
export function simplify(source: Float32Array, tris: number[], error: number): Mesh {
  const ids = new Map<string, number>();
  const positions: number[] = [];
  const remap = (v: number) => {
    const key = weldKey(source, v);
    let id = ids.get(key);
    if (id === undefined) {
      ids.set(key, id = ids.size);
      positions.push(source[v * 3], source[v * 3 + 1], source[v * 3 + 2]);
    }
    return id;
  };
  const welded: number[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    const a = remap(tris[i]), b = remap(tris[i + 1]), c = remap(tris[i + 2]);
    if (a !== b && b !== c && a !== c) welded.push(a, b, c);
  }
  const flat = Float32Array.from(positions);
  const [indices] = MeshoptSimplifier.simplify(Uint32Array.from(welded), flat, 3, 0, error, ["ErrorAbsolute", "Prune"]);
  return { positions: flat, indices };
}

/** One indexed mesh from several: vertices split where faces meet at a hard edge, smooth elsewhere. */
function shade(meshes: Mesh[]) {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (const { positions: p, indices: t } of meshes) {
    const faces: { n: [number, number, number]; v: number[] }[] = [];
    const around = new Map<number, number[]>();
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
      const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
      const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
      const n: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      if (Math.hypot(...n) < 1e-12) continue;
      const f = faces.push({ n, v: [a, b, c] }) - 1;
      for (const v of [a, b, c]) { const l = around.get(v); if (l) l.push(f); else around.set(v, [f]); }
    }
    const unit = (n: number[]) => { const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; };
    const seen = new Map<string, number>();
    for (const face of faces) {
      const own = unit(face.n);
      for (const v of face.v) {
        // The area-weighted average of the faces around this corner that are not across a crease.
        const sum = [0, 0, 0];
        for (const f of around.get(v)!) {
          const other = unit(faces[f].n);
          if (own[0] * other[0] + own[1] * other[1] + own[2] * other[2] < CREASE) continue;
          for (let k = 0; k < 3; k++) sum[k] += faces[f].n[k];
        }
        const n = unit(sum);
        const key = `${v}|${n.map((x) => Math.round(x * 64)).join()}`;
        let id = seen.get(key);
        if (id === undefined) {
          seen.set(key, id = positions.length / 3);
          positions.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
          normals.push(...n);
        }
        indices.push(id);
      }
    }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) };
}

function gunNode(doc: Document, id: string) {
  const scene = doc.getRoot().listScenes()[0];
  const found = scene.listChildren().find((n) => n.getName() === id);
  if (!found) {
    const node = doc.createNode(id);
    scene.addChild(node);
    return node;
  }
  for (const child of found.listChildren()) child.dispose();
  return found;
}
