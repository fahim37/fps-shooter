import fs from "node:fs";
import path from "node:path";
import { Document, NodeIO, type Node, type Primitive, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress, mergeDocuments, meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

export const ROOT = path.resolve(__dirname, "../..");
export const RAW = path.join(ROOT, "assets-raw");
export const PUBLIC_MODELS = path.join(ROOT, "public/models");
export const GENERATED = path.join(ROOT, "game/shared/generated");

export const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

/** Reads a .gltf/.glb, repairing image URIs that point at files missing from the pack. */
export async function readModel(file: string): Promise<Document> {
  if (file.endsWith(".glb")) return io.read(file);
  const dir = path.dirname(file);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const b of json.buffers ?? []) resources[b.uri] = fs.readFileSync(path.join(dir, decodeURIComponent(b.uri)));
  for (const im of json.images ?? []) {
    if (!im.uri) continue;
    let uri: string = im.uri;
    if (!fs.existsSync(path.join(dir, decodeURIComponent(uri)))) {
      const alt = [uri.replace("_png.png", ".png"), uri.replace(".png", "_png.png")]
        .find((a) => fs.existsSync(path.join(dir, a)));
      if (!alt) throw new Error(`missing image ${uri} in ${file}`);
      im.uri = uri = alt;
    }
    resources[uri] = fs.readFileSync(path.join(dir, decodeURIComponent(uri)));
  }
  return io.readJSON({ json, resources });
}

/** Merges each source file's scene into one document; each file becomes one top-level node named after it. */
export async function mergeAsPieces(files: string[], nameOf: (file: string) => string): Promise<Document> {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene("kit");
  for (const file of files) {
    const src = await readModel(file);
    const map = mergeDocuments(doc, src);
    const srcScene = src.getRoot().listScenes()[0];
    const merged = map.get(srcScene) as ReturnType<Document["createScene"]>;
    const piece = doc.createNode(nameOf(file));
    for (const child of merged.listChildren()) {
      merged.removeChild(child);
      piece.addChild(child);
    }
    merged.dispose();
    scene.addChild(piece);
  }
  // mergeDocuments creates one buffer per source; collapse to one for GLB output.
  const [main, ...rest] = doc.getRoot().listBuffers();
  for (const b of rest) {
    for (const a of doc.getRoot().listAccessors()) if (a.getBuffer() === b) a.setBuffer(main);
    b.dispose();
  }
  await doc.transform(dedup(), prune({ keepLeaves: false }));
  return doc;
}

export async function compressTextures(doc: Document, size: number, quality = 86) {
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [size, size], quality }),
  );
}

/**
 * `compress` applies meshopt + quantization. Quantization moves a dequantize scale/offset
 * onto mesh nodes, so consumers must use node matrices rather than raw geometry.
 */
export async function writeGLB(doc: Document, outFile: string, { compress = true } = {}) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await doc.transform(prune());
  if (compress) {
    await MeshoptEncoder.ready;
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  }
  await io.write(outFile, doc);
  return fs.statSync(outFile).size;
}

type Mat4 = number[];

function worldPositions(prim: Primitive, m: Mat4): Float32Array {
  const pos = prim.getAttribute("POSITION")!;
  const out = new Float32Array(pos.getCount() * 3);
  const v = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v);
    out[i * 3] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
    out[i * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
    out[i * 3 + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
  }
  return out;
}

export interface CollisionMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Gathers the triangles under `piece` (in the piece's local space) and simplifies them
 * to a collision mesh. Primitives whose material matches `skipMaterial` are left out.
 */
export function buildCollision(piece: Node, skipMaterial: RegExp | null, maxError: number): CollisionMesh | null {
  const pieceInv = invert(piece.getWorldMatrix());
  const positions: number[] = [];
  const indices: number[] = [];
  piece.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = multiply(pieceInv, node.getWorldMatrix());
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      if (skipMaterial && skipMaterial.test(prim.getMaterial()?.getName() ?? "")) continue;
      const base = positions.length / 3;
      for (const p of worldPositions(prim, m)) positions.push(p);
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : prim.getAttribute("POSITION")!.getCount();
      for (let i = 0; i < count; i++) indices.push(base + (idx ? idx.getScalar(i) : i));
    }
  });
  if (indices.length === 0) return null;

  // Weld coincident vertices first so the simplifier sees connected surfaces.
  const welded = weldPositions(new Float32Array(positions), new Uint32Array(indices));
  const [simplified] = MeshoptSimplifier.simplify(
    welded.indices, welded.positions, 3, 0, maxError, ["ErrorAbsolute", "Permissive"],
  );
  return compact(welded.positions, simplified.length >= 3 ? simplified : welded.indices);
}

function weldPositions(positions: Float32Array, indices: Uint32Array): CollisionMesh {
  const key = (i: number) =>
    `${Math.round(positions[i * 3] * 1000)},${Math.round(positions[i * 3 + 1] * 1000)},${Math.round(positions[i * 3 + 2] * 1000)}`;
  const seen = new Map<string, number>();
  const remap = new Uint32Array(positions.length / 3);
  const out: number[] = [];
  for (let i = 0; i < remap.length; i++) {
    const k = key(i);
    let j = seen.get(k);
    if (j === undefined) {
      j = out.length / 3;
      seen.set(k, j);
      out.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    remap[i] = j;
  }
  const idx = new Uint32Array(indices.length);
  let n = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]], b = remap[indices[t + 1]], c = remap[indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    idx[n++] = a; idx[n++] = b; idx[n++] = c;
  }
  return { positions: new Float32Array(out), indices: idx.slice(0, n) };
}

function compact(positions: Float32Array, indices: Uint32Array): CollisionMesh {
  const remap = new Map<number, number>();
  const out: number[] = [];
  const idx = new Uint32Array(indices.length);
  indices.forEach((v, i) => {
    let j = remap.get(v);
    if (j === undefined) {
      j = out.length / 3;
      remap.set(v, j);
      out.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    }
    idx[i] = j;
  });
  return { positions: new Float32Array(out), indices: idx };
}

export interface PieceInfo {
  /** Axis-aligned bounds in piece space. */
  min: [number, number, number];
  max: [number, number, number];
  /** [vertexStart, vertexCount, indexStart, indexCount] into the kit's collision .bin, if it collides. */
  col?: [number, number, number, number];
}

/** Writes `<kit>.collision.bin` (Float32 positions then Uint32 indices) and returns per-piece ranges. */
export function writeCollisionBin(
  outFile: string,
  meshes: Map<string, CollisionMesh | null>,
): { ranges: Map<string, [number, number, number, number]>; positionsByteLength: number } {
  let vTotal = 0, iTotal = 0;
  for (const m of meshes.values()) if (m) { vTotal += m.positions.length / 3; iTotal += m.indices.length; }
  const positions = new Float32Array(vTotal * 3);
  const indices = new Uint32Array(iTotal);
  const ranges = new Map<string, [number, number, number, number]>();
  let v = 0, i = 0;
  for (const [name, m] of meshes) {
    if (!m) continue;
    const vc = m.positions.length / 3;
    positions.set(m.positions, v * 3);
    indices.set(m.indices, i);
    ranges.set(name, [v, vc, i, m.indices.length]);
    v += vc; i += m.indices.length;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]));
  return { ranges, positionsByteLength: positions.byteLength };
}

export function pieceBounds(node: Node): { min: [number, number, number]; max: [number, number, number] } {
  const b = getBounds(node);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { min: b.min.map(r) as [number, number, number], max: b.max.map(r) as [number, number, number] };
}

export function writeJSON(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data) + "\n");
}

// Minimal column-major 4x4 helpers (gltf-transform returns plain arrays).
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

export function invert(m: Mat4): Mat4 {
  const inv = new Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return inv;
}

export async function ready() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
}
