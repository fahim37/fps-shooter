import { getBounds, type Document, type Material, type Node, type Primitive } from "@gltf-transform/core";
import { transformMesh } from "@gltf-transform/functions";

/**
 * Flank routes added to Desert City. The town joins its sunken west half (Blue) to the raised
 * east half (Red) down the middle street, and otherwise only around its far edges: flanking took
 * nearly twice as long as pushing mid. Each route is built from the town's own vocabulary: solid
 * concrete stairs (with a ramp for collision, like the source's stairs) and doorways cut through
 * walls, their cut faces capped in concrete.
 */

type V3 = [number, number, number];

/** A straight flight of solid steps rising along `up` from `from` to `to`, then a landing. */
export interface RouteStair {
  /** Footprint of the flight, without the landing. */
  x: [number, number];
  z: [number, number];
  up: "+x" | "-x" | "+z" | "-z";
  from: number;
  to: number;
  /** Length of the landing past the top step. */
  landing: number;
}

/** A box cut out of everything it crosses; `through` is the axis that passes through the wall. */
export interface RouteDoor {
  min: V3;
  max: V3;
  through: 0 | 2;
}

/** Ground the rebuilt terrain must lie flat at (it heaped sand against walls where it had no evidence). */
export interface FlatGround {
  x: [number, number];
  z: [number, number];
  y: number;
}

/** A box of the town that players walk through but the source only ever showed from outside. */
export interface InsideZone {
  min: V3;
  max: V3;
}

/** A solid concrete mass, for ground the rebuilt terrain could only guess at. */
export interface RouteBlock {
  min: V3;
  max: V3;
}

export const ROUTES: { stairs: RouteStair[]; doors: RouteDoor[]; flat: FlatGround[]; inside: InsideZone[]; blocks: RouteBlock[] } = {
  stairs: [
    // South: from the courtyard behind Blue's arcade up beside the hall, whose upper story
    // overhangs the courtyard at the hall's floor height; a passage through it leads in.
    // Steep (45°) to start clear of the corner of the building west of the courtyard.
    { x: [-18.05, -15.85], z: [14.4, 18.15], up: "+z", from: 0, to: 3.75, landing: 1.25 },
    // North: from the yard north of Blue's spawn up its retaining wall onto the B side's ledge,
    // where three of the yard's crates stood.
    { x: [-24.15, -21.85], z: [-16.2, -13.75], up: "+x", from: 1.5, to: 3.8, landing: 0.1 },
  ],
  doors: [
    // The ledge's handrail where the north stair arrives.
    { min: [-21.95, 3.85, -16.2], max: [-21.3, 5.0, -13.75], through: 0 },
    // Into the courtyard from the street west of mid, beside its window, facing the stair.
    { min: [-17.4, 0.02, 8.4], max: [-15.8, 2.3, 9.4], through: 2 },
    // Through the hall's overhanging upper story (its underside is a few cm above the floors).
    { min: [-15.9, 3.85, 17.9], max: [-12.6, 5.95, 19.4], through: 0 },
  ],
  flat: [
    { x: [-18.2, -14.8], z: [10.3, 23.3], y: 0 },
    // In front of the hall's retaining wall, and under it (where the terrain heaped a sand bank).
    { x: [-15, -8], z: [10, 12.5], y: 0 },
    { x: [-14.5, -9], z: [13, 23.5], y: 2 },
  ],
  // The hall's retaining wall along the courtyard, its top just under the hall's floor.
  blocks: [
    { min: [-14.8, -0.1, 12.5], max: [-8.8, 3.72, 24] },
  ],
  // The town's walls are one-sided shells. These stretches were closed off in the source, and the
  // flank routes and the opened gate north of Red's spawn lead players in behind them.
  inside: [
    // Behind Blue's arcade: the courtyard, the hall and the buildings around them.
    { min: [-41, -0.5, 8], max: [-4, 10, 36.5] },
    // The passage into the hall, as far as mid's south side.
    { min: [-4.5, 1.5, 23.5], max: [1, 3, 26.5] },
    // North of Red's spawn, through the opened gate.
    { min: [13, 3, -36.5], max: [44.5, 13.5, -10.5] },
  ],
};

/**
 * The floor atlas's worn concrete tile (the image's top right: this export's V runs bottom-up)
 * and its texel density, 0.5 of the atlas per 4.2 m.
 */
const CONCRETE_U = 0.5, CONCRETE_V = 0.5;
const UV_PER_M = 0.12;
const STEP_RISE = 0.25;

/** Vertex streams for new geometry (positions, flat normals, atlas UVs, vertex shade). */
class Builder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  private seed = 1;

  /** A planar quad (corners in order around it) facing `normal`, shaded by `shade`. */
  quad(corners: V3[], normal: V3, shade: number) {
    const [a, b, , d] = corners;
    const n = cross(sub(b, a), sub(d, a));
    const pts = dot(n, normal) < 0 ? [corners[0], corners[3], corners[2], corners[1]] : corners;
    // Planar UVs along the quad's own edges, placed at a varying spot inside the concrete tile.
    const s = sub(pts[1], pts[0]), t = sub(pts[3], pts[0]);
    const sl = Math.hypot(...s), tl = Math.hypot(...t);
    const room = (len: number) => Math.max(0, 0.5 - len * UV_PER_M);
    const s0 = this.rand() * room(sl), t0 = this.rand() * room(tl);
    const uvs = [[0, 0], [sl, 0], [sl, tl], [0, tl]].map(([p, q]) => [CONCRETE_U + s0 + p * UV_PER_M, CONCRETE_V + t0 + q * UV_PER_M]);
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(...pts[i]);
      this.nrm.push(...normal);
      this.uv.push(...uvs[i]);
      this.col.push(shade, shade, shade, 1);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  primitive(doc: Document, material: Material): Primitive {
    const buffer = doc.getRoot().listBuffers()[0];
    const acc = (type: "VEC2" | "VEC3" | "VEC4", a: number[]) => doc.createAccessor().setType(type).setArray(new Float32Array(a)).setBuffer(buffer);
    return doc.createPrimitive().setMaterial(material)
      .setAttribute("POSITION", acc("VEC3", this.pos))
      .setAttribute("NORMAL", acc("VEC3", this.nrm))
      .setAttribute("TEXCOORD_0", acc("VEC2", this.uv))
      .setAttribute("COLOR_0", acc("VEC4", this.col))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(this.idx)).setBuffer(buffer));
  }
}

/** Maps a stair's own frame (u up the flight, w across it, y) to world space. */
function stairFrame(s: RouteStair) {
  const alongX = s.up.endsWith("x");
  const [a0, a1] = alongX ? s.x : s.z, [w0, w1] = alongX ? s.z : s.x;
  const sign = s.up.startsWith("+") ? 1 : -1;
  const start = sign > 0 ? a0 : a1;
  const at = (u: number, w: number, y: number): V3 => {
    const a = start + sign * u;
    return alongX ? [a, y, w] : [w, y, a];
  };
  const dir = (du: number, dw: number): V3 => (alongX ? [sign * du, 0, dw] : [dw, 0, sign * du]);
  return { length: a1 - a0, w0, w1, at, dir };
}

/** A block as concrete faces, tiled so each stays inside the atlas's concrete tile. */
export function blockMesh(doc: Document, k: RouteBlock, material: Material, name: string): Node {
  const b = new Builder();
  const TILE = 3.5;
  const spans = (lo: number, hi: number) => {
    const n = Math.ceil((hi - lo) / TILE), out: [number, number][] = [];
    for (let i = 0; i < n; i++) out.push([lo + ((hi - lo) * i) / n, lo + ((hi - lo) * (i + 1)) / n]);
    return out;
  };
  const [x0, y0, z0] = k.min, [x1, y1, z1] = k.max;
  for (const [a, c] of spans(x0, x1)) for (const [p, q] of spans(z0, z1)) b.quad([[a, y1, p], [c, y1, p], [c, y1, q], [a, y1, q]], [0, 1, 0], 1);
  for (const [p, q] of spans(z0, z1)) for (const [u, v] of spans(y0, y1)) {
    b.quad([[x0, u, p], [x0, u, q], [x0, v, q], [x0, v, p]], [-1, 0, 0], 0.86);
    b.quad([[x1, u, p], [x1, u, q], [x1, v, q], [x1, v, p]], [1, 0, 0], 0.86);
  }
  for (const [a, c] of spans(x0, x1)) for (const [u, v] of spans(y0, y1)) {
    b.quad([[a, u, z0], [c, u, z0], [c, v, z0], [a, v, z0]], [0, 0, -1], 0.86);
    b.quad([[a, u, z1], [c, u, z1], [c, v, z1], [a, v, z1]], [0, 0, 1], 0.86);
  }
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(b.primitive(doc, material)));
}

/** A staircase as a solid mass: treads, risers, stepped sides and the landing. */
export function stairMesh(doc: Document, s: RouteStair, material: Material, name: string): Node {
  const { length, w0, w1, at, dir } = stairFrame(s);
  const n = Math.round((s.to - s.from) / STEP_RISE), h = (s.to - s.from) / n, r = length / n;
  const b = new Builder();
  const up: V3 = [0, 1, 0], back = dir(-1, 0), fwd = dir(1, 0), left = dir(0, -1), right = dir(0, 1);
  for (let k = 0; k < n; k++) {
    const u0 = k * r, u1 = (k + 1) * r, y0 = s.from + k * h, y1 = s.from + (k + 1) * h;
    b.quad([at(u0, w0, y1), at(u1, w0, y1), at(u1, w1, y1), at(u0, w1, y1)], up, 1);
    b.quad([at(u0, w0, y0), at(u0, w1, y0), at(u0, w1, y1), at(u0, w0, y1)], back, 0.72);
    b.quad([at(u0, w0, s.from), at(u1, w0, s.from), at(u1, w0, y1), at(u0, w0, y1)], left, 0.86);
    b.quad([at(u0, w1, s.from), at(u1, w1, s.from), at(u1, w1, y1), at(u0, w1, y1)], right, 0.86);
  }
  const l0 = length, l1 = length + s.landing;
  b.quad([at(l0, w0, s.to), at(l1, w0, s.to), at(l1, w1, s.to), at(l0, w1, s.to)], up, 1);
  b.quad([at(l0, w0, s.from), at(l1, w0, s.from), at(l1, w0, s.to), at(l0, w0, s.to)], left, 0.86);
  b.quad([at(l0, w1, s.from), at(l1, w1, s.from), at(l1, w1, s.to), at(l0, w1, s.to)], right, 0.86);
  b.quad([at(l1, w0, s.from), at(l1, w1, s.from), at(l1, w1, s.to), at(l1, w0, s.to)], fwd, 0.86);
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(b.primitive(doc, material)));
}

/**
 * The stair's walking surface for collision: through the middle of each step's rise, starting
 * half a step's run out on the ground and flat across the landing.
 */
export function stairRamp(s: RouteStair, grid: number) {
  const { length, at } = stairFrame(s);
  const n = Math.round((s.to - s.from) / STEP_RISE), h = (s.to - s.from) / n, r = length / n;
  const lead = r / 2;
  const corners = [at(-lead, 0, 0), at(length + s.landing, 0, 0)];
  const alongX = s.up.endsWith("x");
  const x0 = alongX ? Math.min(corners[0][0], corners[1][0]) : s.x[0], x1 = alongX ? Math.max(corners[0][0], corners[1][0]) : s.x[1];
  const z0 = alongX ? s.z[0] : Math.min(corners[0][2], corners[1][2]), z1 = alongX ? s.z[1] : Math.max(corners[0][2], corners[1][2]);
  const nx = Math.round((x1 - x0) / grid) + 1, nz = Math.round((z1 - z0) / grid) + 1;
  const ramp = new Float32Array(nx * nz);
  const sign = s.up.startsWith("+") ? 1 : -1, start = sign > 0 ? (alongX ? s.x[0] : s.z[0]) : (alongX ? s.x[1] : s.z[1]);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const a = alongX ? x0 + i * grid : z0 + k * grid;
    const u = (a - start) * sign;
    ramp[k * nx + i] = Math.max(s.from, Math.min(s.to, s.from + h / 2 + (u * h) / r));
  }
  return { x0, z0, nx, nz, ramp };
}

/**
 * Collision walls for a stair's sides and far end, up to its ramp. The importer swaps a flight's
 * treads and risers for its ramp, which takes the solid stair's sides with them: without these,
 * players could walk in under the ramp.
 */
export function stairWalls(s: RouteStair): { positions: Float32Array; indices: Uint32Array } {
  const { length, w0, w1, at } = stairFrame(s);
  const n = Math.round((s.to - s.from) / STEP_RISE), r = length / n;
  const top = length - r / 2, end = length + s.landing;
  const pos: number[] = [], idx: number[] = [];
  const poly = (pts: V3[]) => {
    const base = pos.length / 3;
    for (const p of pts) pos.push(...p);
    for (let i = 1; i + 1 < pts.length; i++) idx.push(base, base + i, base + i + 1);
  };
  for (const w of [w0, w1]) poly([at(0, w, s.from), at(0, w, s.from + (s.to - s.from) / n / 2), at(top, w, s.to), at(end, w, s.to), at(end, w, s.from)]);
  poly([at(end, w0, s.from), at(end, w0, s.to), at(end, w1, s.to), at(end, w1, s.from)]);
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Finishes the inside of the shells in `zones`: every surface there gets a reversed twin with the
 * same texture and shading, so walls and ceilings stay solid seen from behind. One primitive per
 * material keeps it to a handful of draw calls. Returns null if nothing lies in the zones.
 */
export function insideFaces(doc: Document, pieces: Node[], zones: InsideZone[], name: string): { node: Node; tris: number } | null {
  type Stream = { pos: number[]; nrm: number[]; uv: number[]; col: number[] };
  const streams = new Map<Material, Stream>();
  let tris = 0;
  forEachPrimitive(pieces, (prim, m) => {
    const material = prim.getMaterial()!;
    const p = worldPositions(prim, m), idx = prim.getIndices()!;
    const nrm = prim.getAttribute("NORMAL"), uv = prim.getAttribute("TEXCOORD_0"), col = prim.getAttribute("COLOR_0");
    if (!nrm || !uv || !col) return;
    const n = [0, 0, 0], t = [0, 0], c = [0, 0, 0, 0];
    for (let i = 0; i < idx.getCount(); i += 3) {
      const tri = [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)];
      const inZone = zones.some((z) => [0, 1, 2].every((k) => {
        const v = tri.map((q) => p[q * 3 + k]);
        return Math.max(...v) >= z.min[k] && Math.min(...v) <= z.max[k];
      }));
      if (!inZone) continue;
      let s = streams.get(material);
      if (!s) streams.set(material, (s = { pos: [], nrm: [], uv: [], col: [] }));
      for (const q of [tri[0], tri[2], tri[1]]) {
        s.pos.push(p[q * 3], p[q * 3 + 1], p[q * 3 + 2]);
        nrm.getElement(q, n);
        const w = [0, 1, 2].map((k) => -(m[k] * n[0] + m[4 + k] * n[1] + m[8 + k] * n[2]));
        const l = Math.hypot(...w) || 1;
        s.nrm.push(w[0] / l, w[1] / l, w[2] / l);
        s.uv.push(...uv.getElement(q, t));
        s.col.push(...col.getElement(q, c));
      }
      tris++;
    }
  });
  if (!tris) return null;
  const buffer = doc.getRoot().listBuffers()[0];
  const acc = (type: "VEC2" | "VEC3" | "VEC4", a: number[]) => doc.createAccessor().setType(type).setArray(new Float32Array(a)).setBuffer(buffer);
  const mesh = doc.createMesh(name);
  for (const [material, s] of streams) {
    mesh.addPrimitive(doc.createPrimitive().setMaterial(material)
      .setAttribute("POSITION", acc("VEC3", s.pos)).setAttribute("NORMAL", acc("VEC3", s.nrm))
      .setAttribute("TEXCOORD_0", acc("VEC2", s.uv)).setAttribute("COLOR_0", acc("VEC4", s.col))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from({ length: s.pos.length / 3 }, (_, i) => i)).setBuffer(buffer)));
  }
  const node = doc.createNode(name);
  node.addChild(doc.createNode(`${name}_mesh`).setMesh(mesh));
  return { node, tris };
}

/** Triangles of the given pieces near the doors, in world space, for the caps' inside test. */
function nearbyTriangles(pieces: Node[], doors: RouteDoor[]) {
  const out: number[][] = [];
  const near = (v: number[]) => doors.some((d) => [0, 1, 2].every((k) => {
    const lo = Math.min(v[k], v[k + 3], v[k + 6]), hi = Math.max(v[k], v[k + 3], v[k + 6]);
    return hi >= d.min[k] - 4 && lo <= d.max[k] + 4;
  }));
  forEachPrimitive(pieces, (prim, m) => {
    const p = worldPositions(prim, m), idx = prim.getIndices()!;
    for (let t = 0; t < idx.getCount(); t += 3) {
      const v = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)].flatMap((i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
      if (near(v)) out.push(v);
    }
  });
  return out;
}

function forEachPrimitive(pieces: Node[], fn: (prim: Primitive, matrix: number[], node: Node) => void) {
  for (const piece of pieces) piece.traverse((node) => {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) fn(prim, node.getWorldMatrix(), node);
  });
}

function worldPositions(prim: Primitive, m: number[]) {
  const a = prim.getAttribute("POSITION")!, out = new Float32Array(a.getCount() * 3), v = [0, 0, 0];
  for (let i = 0; i < a.getCount(); i++) {
    a.getElement(i, v);
    for (let k = 0; k < 3; k++) out[i * 3 + k] = m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k];
  }
  return out;
}

/**
 * Cuts each door's box out of every primitive of `pieces` (triangles are clipped at the box's
 * faces, attributes interpolated) and caps the cut: wherever a face of the box lies inside a
 * solid (a wall, a lintel, a sill), a concrete face closes it. `capPiece` says where caps go.
 */
export function cutDoors(doc: Document, pieces: Node[], doors: RouteDoor[], capMaterial: Material, capPiece: (door: RouteDoor) => Node) {
  const original = nearbyTriangles(pieces.filter((p) => !p.getName().startsWith("Detail_")), doors);
  // Joined meshes keep a node transform: bake it into those the doors cross, so cuts are in world space.
  for (const piece of pieces) piece.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh || node.getMatrix().every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9)) return;
    const b = getBounds(node);
    if (!doors.some((d) => [0, 1, 2].every((k) => b.max[k] > d.min[k] && b.min[k] < d.max[k]))) return;
    if (mesh.listParents().filter((p) => p.propertyType === "Node").length > 1) throw new Error(`door cut through shared mesh ${mesh.getName()}`);
    transformMesh(mesh, node.getWorldMatrix());
    node.setMatrix(IDENTITY as never);
  });
  let cut = 0;
  forEachPrimitive(pieces, (prim, m) => {
    if (m.some((v, i) => Math.abs(v - IDENTITY[i]) > 1e-6)) return;
    for (const d of doors) cut += clipPrimitive(doc, prim, d);
  });
  let caps = 0;
  for (const d of doors) {
    const b = new Builder();
    capDoor(b, d, original);
    caps += b.idx.length / 3;
    if (b.idx.length) capPiece(d).addChild(doc.createNode("Route_DoorCap").setMesh(doc.createMesh("Route_DoorCap").addPrimitive(b.primitive(doc, capMaterial))));
  }
  return { cut, caps };
}

/** Removes the part of `prim` inside the door box; returns how many triangles it touched. */
function clipPrimitive(doc: Document, prim: Primitive, d: RouteDoor): number {
  const pos = prim.getAttribute("POSITION")!;
  const sems = prim.listSemantics();
  const attrs = sems.map((s) => prim.getAttribute(s)!);
  const sizes = attrs.map((a) => a.getElementSize());
  const idx = prim.getIndices()!;
  const count = pos.getCount();
  // Quick reject on the primitive's bounds.
  const v = [0, 0, 0];
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) { pos.getElement(i, v); lo = lo.map((x, k) => Math.min(x, v[k])); hi = hi.map((x, k) => Math.max(x, v[k])); }
  if ([0, 1, 2].some((k) => hi[k] <= d.min[k] || lo[k] >= d.max[k])) return 0;

  const verts: number[][] = [];
  for (let i = 0; i < count; i++) verts.push(attrs.flatMap((a) => a.getElement(i, new Array(a.getElementSize()).fill(0))));
  const out: number[] = [];
  let touched = 0;
  // Planes as (axis, value, keepAbove): the part outside the box on each side is kept.
  const planes: [number, number, boolean][] = [[0, d.min[0], false], [0, d.max[0], true], [1, d.min[1], false], [1, d.max[1], true], [2, d.min[2], false], [2, d.max[2], true]];
  const lerp = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
  const emit = (poly: number[][]) => {
    const ids = poly.map((p) => verts.push(p) - 1);
    for (let i = 1; i + 1 < ids.length; i++) out.push(ids[0], ids[i], ids[i + 1]);
  };
  for (let t = 0; t < idx.getCount(); t += 3) {
    const tri = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
    const ps = tri.map((i) => verts[i]);
    if ([0, 1, 2].some((k) => Math.max(ps[0][k], ps[1][k], ps[2][k]) <= d.min[k] || Math.min(ps[0][k], ps[1][k], ps[2][k]) >= d.max[k])) {
      out.push(...tri);
      continue;
    }
    touched++;
    let inside: number[][] = ps;
    for (const [axis, value, above] of planes) {
      const keep: number[][] = [], rest: number[][] = [];
      for (let i = 0; i < inside.length; i++) {
        const a = inside[i], b = inside[(i + 1) % inside.length];
        const da = (a[axis] - value) * (above ? 1 : -1), db = (b[axis] - value) * (above ? 1 : -1);
        (da > 0 ? keep : rest).push(a);
        if ((da > 0) !== (db > 0)) {
          const c = lerp(a, b, da / (da - db));
          keep.push(c); rest.push(c);
        }
      }
      if (keep.length >= 3) emit(keep);
      inside = rest;
      if (inside.length < 3) break;
    }
  }
  if (!touched) return 0;
  // Rewrite the primitive's streams as floats (normals renormalized).
  const buffer = doc.getRoot().listBuffers()[0];
  let off = 0;
  sems.forEach((sem, a) => {
    const size = sizes[a], data = new Float32Array(verts.length * size);
    verts.forEach((vert, i) => {
      for (let k = 0; k < size; k++) data[i * size + k] = vert[off + k];
      if (sem === "NORMAL") {
        const l = Math.hypot(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) || 1;
        for (let k = 0; k < 3; k++) data[i * 3 + k] /= l;
      }
    });
    off += size;
    const old = attrs[a];
    prim.setAttribute(sem, doc.createAccessor().setType(old.getType()).setArray(data).setBuffer(buffer));
    if (old.listParents().length <= 1) old.dispose();
  });
  const oldIdx = idx;
  prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(out)).setBuffer(buffer));
  if (oldIdx.listParents().length <= 1) oldIdx.dispose();
  return touched;
}

/** Caps a door's box wherever its faces lie inside solid geometry (tested by the nearest hit along the wall's through axis). */
function capDoor(b: Builder, d: RouteDoor, tris: number[][]) {
  const CELL = 0.025;
  const dir: V3 = d.through === 0 ? [1, 0, 0] : [0, 0, 1];
  const inside = (p: V3) => {
    let best = Infinity, sign = 0;
    for (const t of tris) {
      const hit = rayTriangle(p, dir, t);
      if (hit !== null && hit < best && hit < 4) { best = hit; sign = dot(triNormal(t), dir); }
    }
    return sign > 0;
  };
  // The threshold also closes wherever no floor lies just under it (a cut overhang's underside).
  const floored = (p: V3) => {
    let best = Infinity, up = false;
    for (const t of tris) {
      const hit = rayTriangle(p, [0, -1, 0], t);
      if (hit !== null && hit < best) { best = hit; up = triNormal(t)[1] > 0; }
    }
    return best < 0.3 && up;
  };
  for (const axis of [0, 1, 2]) {
    if (axis === d.through) continue;
    const [ua, va] = [0, 1, 2].filter((k) => k !== axis);
    for (const side of [0, 1]) {
      const value = side ? d.max[axis] : d.min[axis];
      const nu = Math.round((d.max[ua] - d.min[ua]) / CELL), nv = Math.round((d.max[va] - d.min[va]) / CELL);
      const cells = new Uint8Array(nu * nv);
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const p: V3 = [0, 0, 0];
        p[axis] = value;
        p[ua] = d.min[ua] + (i + 0.5) * CELL;
        p[va] = d.min[va] + (j + 0.5) * CELL;
        cells[j * nu + i] = inside(p) || (axis === 1 && side === 0 && !floored(p)) ? 1 : 0;
      }
      const normal: V3 = [0, 0, 0];
      normal[axis] = side ? -1 : 1; // facing into the opening
      for (const r of rects(cells, nu, nv)) {
        const corner = (i: number, j: number): V3 => {
          const p: V3 = [0, 0, 0];
          p[axis] = value;
          p[ua] = d.min[ua] + i * CELL;
          p[va] = d.min[va] + j * CELL;
          return p;
        };
        b.quad([corner(r.i, r.j), corner(r.i + r.w, r.j), corner(r.i + r.w, r.j + r.h), corner(r.i, r.j + r.h)], normal, axis === 1 && side === 0 ? 1 : 0.9);
      }
    }
  }
}

/** Greedy merge of set cells into rectangles. */
function rects(cells: Uint8Array, nu: number, nv: number) {
  const used = new Uint8Array(cells.length), out: { i: number; j: number; w: number; h: number }[] = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (!cells[j * nu + i] || used[j * nu + i]) continue;
    let w = 1;
    while (i + w < nu && cells[j * nu + i + w] && !used[j * nu + i + w]) w++;
    let h = 1;
    for (; j + h < nv; h++) {
      let row = true;
      for (let a = i; a < i + w; a++) if (!cells[(j + h) * nu + a] || used[(j + h) * nu + a]) { row = false; break; }
      if (!row) break;
    }
    for (let q = j; q < j + h; q++) for (let a = i; a < i + w; a++) used[q * nu + a] = 1;
    out.push({ i, j, w, h });
  }
  return out;
}

function rayTriangle(o: V3, d: V3, t: number[]): number | null {
  const e1 = [t[3] - t[0], t[4] - t[1], t[5] - t[2]], e2 = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det, s = [o[0] - t[0], o[1] - t[1], o[2] - t[2]];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
  if (u < 0 || u > 1) return null;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < 0 || u + v > 1) return null;
  const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
  return dist > 1e-6 ? dist : null;
}

function triNormal(t: number[]): V3 {
  return cross([t[3] - t[0], t[4] - t[1], t[5] - t[2]], [t[6] - t[0], t[7] - t[1], t[8] - t[2]]);
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
