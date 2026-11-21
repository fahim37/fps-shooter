import fs from "node:fs";
import path from "node:path";
import { MeshoptSimplifier } from "meshoptimizer";
import type * as THREE from "three";
import { GENERATED, RAW, writeJSON } from "./common";
import { readFbx, replaceGun, simplify, type GunPieces, type Look } from "./gun-mesh";

// The melee weapons, in weapon space like the guns: the hand's hold at the origin, the blade
// toward -Z (the "muzzle" is the tip), the cutting edge down (-Y), the blade's flats facing ±X.
//
// Balisong: "Balisong (Low Poly)" by Jawa (@HELLBRAD) on Sketchfab, CC BY 4.0. The file holds the
// same knife three times in different poses (each a blade and two handles). The closed one sets
// the blade's frame; the fully open one is where the handles sit in the hand. Each handle's hinge
// (pin axis and pivot) is solved from how it moves between the two, so the client can swing it.
//
// Katana: "katana 2" by Snabisch on OpenGameArt, CC0. One mesh with a 1K texture, which only
// tells the steel, the wrap and the fittings apart: each triangle takes one flat look from it.
const BALISONG = path.join(RAW, "balisong", "Balisong.fbx");
const KATANA = path.join(RAW, "katana");

/** The rig was fitted to the 30 cm model. Extend the blade and handle tails equally beyond the grip. */
const KNIFE_GRIP_MODEL_LENGTH = 0.30;
const KNIFE_LENGTH = 0.42;
/** Tip to pommel (m). */
const KATANA_LENGTH = 1.05;
/** The right hand's centre behind the katana's guard (m), where its origin goes. */
const KATANA_HOLD = 0.065;
/** Metres the surface may move when simplified, by level. */
const DETAIL = { near: 0.0002, far: 0.0012 };

/** The katana's blade collar ahead of the guard, and half the guard's thickness (m). */
const HABAKI = 0.026, GUARD_HALF = 0.009;

const KATANA_LOOKS: Record<string, Look> = {
  steel: { color: [0.6, 0.61, 0.63], metal: 1, rough: 0.18 },
  brass: { color: [0.55, 0.38, 0.12], metal: 1, rough: 0.3 },
  bronze: { color: [0.3, 0.17, 0.06], metal: 1, rough: 0.4 },
  iron: { color: [0.045, 0.045, 0.05], metal: 0.8, rough: 0.45 },
  wrap: { color: [0.018, 0.018, 0.022], metal: 0, rough: 0.8 },
};

const LOOKS: Record<string, Look> = {
  blade: { color: [0.62, 0.63, 0.65], metal: 1, rough: 0.22 },
  pins: { color: [0.3, 0.3, 0.31], metal: 1, rough: 0.35 },
  handle: { color: [0.035, 0.035, 0.04], metal: 0.6, rough: 0.42 },
};

type V3 = [number, number, number];
type Mat = number[]; // 4x4 column-major, as three.js stores it

interface Part { name: string; positions: Float32Array; tris: number[] }

export async function importMelee() {
  await MeshoptSimplifier.ready;
  const knife = await balisong();
  const sword = await katana();
  const metaFile = path.join(GENERATED, "weapons-meta.json");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  meta.knife.hinges = knife.hinges;
  meta.katana.guard = sword.guard;
  writeJSON(metaFile, meta);
  console.log(`[melee] knife ${JSON.stringify(meta.knife)}`);
  console.log(`[melee] katana ${JSON.stringify(meta.katana)}`);
}

// ------------------------------------------------------------------ balisong

async function balisong() {
  const root = await readFbx(BALISONG);
  const mesh = (name: string) => {
    let found: THREE.Mesh | undefined;
    root.traverse((o) => { if (o.name === name && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh; });
    if (!found) throw new Error(`balisong: no mesh ${name}`);
    return found;
  };
  // Closed: Cube370 blade between handles Cube371 / Cube372. Open: Cube376 blade, handles Cube377 / Cube378.
  const closed = { blade: mesh("Cube370"), handles: [mesh("Cube371"), mesh("Cube372")] };
  const open = { blade: mesh("Cube376"), handles: [mesh("Cube377"), mesh("Cube378")] };

  // The open and half-open knives, moved so their blades lie on the closed one's.
  const half = { blade: mesh("Cube373"), handles: [mesh("Cube374"), mesh("Cube375")] };
  const onto = (k: typeof open) => {
    const m = rigidFit(worldPositions(k.blade), worldPositions(closed.blade)).m;
    return k.handles.map((h) => apply(m, worldPositions(h)));
  };
  const openHandles = onto(open), halfHandles = onto(half);

  // The two handles are the same mesh, so either open handle is a rigid copy of either closed one.
  // A handle only ever turns about its own pin: the right pairing is the one where its closed,
  // half-open and open poses all turn about the same line. The half-open pose also says which
  // way round it swings.
  const hinges = closed.handles.map((h) => {
    const from = worldPositions(h);
    let best: { open: Float32Array; toClosed: ReturnType<typeof hinge>; error: number; miss: number } | null = null;
    for (const o of openHandles) {
      const toClosed = hinge(rigidFit(o, from).m);
      for (const m of halfHandles) {
        const toHalf = hinge(rigidFit(o, m).m);
        const miss = Math.hypot(...toClosed.pivot.map((v, k) => v - toHalf.pivot[k]));
        if (best && miss >= best.miss) continue;
        // Swinging the half-open way round: the closing turn goes the same way about the pin.
        const dir = toHalf.axis[0] * toClosed.axis[0] + toHalf.axis[1] * toClosed.axis[1] + toHalf.axis[2] * toClosed.axis[2];
        best = { open: o, toClosed: { ...toClosed, angle: toClosed.angle * (dir < 0 ? -1 : 1) }, error: rigidFit(o, from).error, miss };
      }
    }
    return best!;
  });
  if (hinges[0].open === hinges[1].open) throw new Error("balisong: both handles matched the same open handle");

  // Source frame: blade along +Y, flats facing ±Z, pins along Z. The edge is the thinner long side.
  const blade = worldPositions(closed.blade);
  const edge = thinnerSide(blade, 1, 0, 2);
  // Source +X goes up when the edge is on -X; the flats' normal goes to ±X so the turn stays proper.
  const s = edge < 0 ? 1 : -1;
  const turn: Mat = [0, s, 0, 0, 0, 0, -1, 0, -s, 0, 0, 0, 0, 0, 0, 1];

  // Open length and the handles' middle, in the blade's frame.
  const all = [blade, ...hinges.map((h) => h.open)];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of all) for (let i = 0; i < p.length; i++) { lo[i % 3] = Math.min(lo[i % 3], p[i]); hi[i % 3] = Math.max(hi[i % 3], p[i]); }
  const hlo = [Infinity, Infinity, Infinity], hhi = [-Infinity, -Infinity, -Infinity];
  for (const h of hinges) for (let i = 0; i < h.open.length; i++) { hlo[i % 3] = Math.min(hlo[i % 3], h.open[i]); hhi[i % 3] = Math.max(hhi[i % 3], h.open[i]); }
  const scale = KNIFE_GRIP_MODEL_LENGTH / (hi[1] - lo[1]);
  const centre = [0, 1, 2].map((k) => (hlo[k] + hhi[k]) / 2);
  const place = (p: Float32Array) => {
    const out = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      const v = transform(turn, [(p[i] - centre[0]) * scale, (p[i + 1] - centre[1]) * scale, (p[i + 2] - centre[2]) * scale]);
      out.set(v, i);
    }
    return out;
  };
  const placeDir = (d: V3) => transform(turn, d, 0);

  // Blade: its own steel, with the pins and the tang's fittings darker (the source's second material).
  const parts: { look: string; part: Part }[] = [];
  const bladeAt = place(blade);
  const extra = (KNIFE_LENGTH - KNIFE_GRIP_MODEL_LENGTH) / 2;
  const tipZ = -(hi[1] - centre[1]) * scale;
  const buttZ = -(lo[1] - centre[1]) * scale;
  for (let i = 0; i < bladeAt.length; i += 3) {
    const t = Math.max(0, Math.min(1, (bladeAt[i + 2] + 0.085) / (tipZ + 0.085)));
    const belly = Math.sin(Math.PI * t) ** 2;
    bladeAt[i + 1] = bladeAt[i + 1] * (1 + 0.55 * belly) - 0.007 * belly;
    bladeAt[i + 2] -= extra * t;
  }
  for (const [material, tris] of byMaterial(closed.blade)) {
    parts.push({ look: /grey/i.test(material) ? "blade" : "pins", part: { name: material, positions: bladeAt, tris } });
  }
  const names = ["Safe_", "Bite_"];
  hinges.forEach((h, i) => {
    const positions = place(h.open);
    for (let k = 2; k < positions.length; k += 3) {
      positions[k] += extra * Math.max(0, (positions[k] - 0.014) / (buttZ - 0.014));
    }
    parts.push({ look: `${names[i]}handle`, part: { name: names[i], positions, tris: allTris(closed.handles[i]) } });
  });

  const build = (error: number) => {
    const pieces: GunPieces = new Map();
    for (const { look, part } of parts) {
      const piece = pieces.get(look) ?? { look: LOOKS[look.replace(/^(Safe|Bite)_/, "")], meshes: [] };
      piece.meshes.push(simplify(part.positions, part.tris, error));
      pieces.set(look, piece);
    }
    return pieces;
  };
  const { near, far } = await replaceGun("knife", KNIFE_LENGTH, { near: build(DETAIL.near), far: build(DETAIL.far) });
  console.log(`[melee] balisong near ${near} tris, far ${far} tris; handle fits off by ${hinges.map((h) => h.error.toExponential(1)).join(", ")}`);

  const r = (x: number) => Math.round(x * 10000) / 10000 + 0;
  const out: Record<string, { pivot: V3; axis: V3; closed: number }> = {};
  hinges.forEach((h, i) => {
    const pivot = place(Float32Array.from(h.toClosed.pivot));
    const axis = placeDir(h.toClosed.axis);
    out[names[i].slice(0, -1).toLowerCase()] = { pivot: [...pivot].map(r) as V3, axis: axis.map(r) as V3, closed: r(h.toClosed.angle) };
  });
  return { hinges: out };
}

// ------------------------------------------------------------------ katana

async function katana() {
  const root = await readFbx(path.join(KATANA, "Katana.FBX"));
  let src: THREE.Mesh | undefined;
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) src = o as THREE.Mesh; });
  if (!src) throw new Error("katana: no mesh");
  const world = worldPositions(src);

  // Source frame: blade along -X, handle at +X, flats facing ±Y.
  const edge = thinnerSide(world, 0, 2, 1, (x, lo, hi) => x < lo + (hi - lo) * 0.6);
  // Edge (source ±Z) goes down; the flats' normal goes to ±X so the turn stays proper.
  const u = edge > 0 ? 1 : -1;
  const turn: Mat = [0, 0, 1, 0, -u, 0, 0, 0, 0, -u, 0, 0, 0, 0, 0, 1];

  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < world.length; i += 3) { lo = Math.min(lo, world[i]); hi = Math.max(hi, world[i]); }
  const scale = KATANA_LENGTH / (hi - lo);
  // The guard is where the cross-section is widest.
  const guardX = widestAlong(world, 0);
  const holdX = guardX + KATANA_HOLD / scale;
  let cy = 0, cz = 0, n = 0;
  for (let i = 0; i < world.length; i += 3) if (Math.abs(world[i] - holdX) < 0.02 / scale) { cy += world[i + 1]; cz += world[i + 2]; n++; }
  const centre = [holdX, n ? cy / n : 0, n ? cz / n : 0];
  const placed = new Float32Array(world.length);
  for (let i = 0; i < world.length; i += 3) {
    placed.set(transform(turn, [(world[i] - centre[0]) * scale, (world[i + 1] - centre[1]) * scale, (world[i + 2] - centre[2]) * scale]), i);
  }

  // The texture is dark all over (the shine was in its specular map), so it only says where the
  // bronze fittings are; the rest is told apart by where it lies along the sword.
  const tex = readTga(path.join(KATANA, "Katana_d.tga"));
  const uv = src.geometry.getAttribute("uv");
  const tris = allTris(src);
  const look = (t: number) => {
    const u0 = (uv.getX(tris[t]) + uv.getX(tris[t + 1]) + uv.getX(tris[t + 2])) / 3;
    const v0 = (uv.getY(tris[t]) + uv.getY(tris[t + 1]) + uv.getY(tris[t + 2])) / 3;
    const [r, , b] = tex.at(u0, v0);
    const z = (placed[tris[t] * 3 + 2] + placed[tris[t + 1] * 3 + 2] + placed[tris[t + 2] * 3 + 2]) / 3;
    if (r > b * 1.8 && r > 0.06) return "bronze";
    if (z < -KATANA_HOLD - HABAKI) return "steel";
    if (z < -KATANA_HOLD - GUARD_HALF) return "brass";
    if (z < -KATANA_HOLD + GUARD_HALF || z > KATANA_LENGTH * 0.22) return "iron";
    return "wrap";
  };
  const build = (error: number) => {
    const groups = new Map<string, number[]>();
    for (let t = 0; t < tris.length; t += 3) {
      const name = look(t), list = groups.get(name) ?? [];
      list.push(tris[t], tris[t + 1], tris[t + 2]);
      groups.set(name, list);
    }
    const pieces: GunPieces = new Map();
    for (const [name, mine] of groups) pieces.set(name, { look: KATANA_LOOKS[name], meshes: [simplify(placed, mine, error)] });
    return pieces;
  };
  const { near, far } = await replaceGun("katana", KATANA_LENGTH, { near: build(DETAIL.near), far: build(DETAIL.far) });
  console.log(`[melee] katana near ${near} tris, far ${far} tris`);
  return { guard: Math.round(-KATANA_HOLD * 10000) / 10000 };
}

// ------------------------------------------------------------------ geometry helpers

function worldPositions(mesh: THREE.Mesh) {
  const pos = mesh.geometry.getAttribute("position"), e = mesh.matrixWorld.elements;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    for (let k = 0; k < 3; k++) out[i * 3 + k] = e[k] * x + e[4 + k] * y + e[8 + k] * z + e[12 + k];
  }
  return out;
}

function allTris(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  const n = g.index ? g.index.count : g.getAttribute("position").count;
  return Array.from({ length: n }, (_, i) => g.index ? g.index.getX(i) : i);
}

function byMaterial(mesh: THREE.Mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const tris = allTris(mesh);
  const out = new Map<string, number[]>();
  const groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: tris.length, materialIndex: 0 }];
  for (const g of groups) {
    const name = materials[g.materialIndex ?? 0]?.name ?? "default";
    const list = out.get(name) ?? [];
    for (let i = g.start; i < g.start + g.count; i++) list.push(tris[i]);
    out.set(name, list);
  }
  return out;
}

function transform(m: Mat, v: V3 | number[], w = 1): V3 {
  return [0, 1, 2].map((k) => m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k] * w) as V3;
}

function apply(m: Mat, p: Float32Array) {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) out.set(transform(m, [p[i], p[i + 1], p[i + 2]]), i);
  return out;
}

/**
 * The rigid move taking `from` onto `to`, two copies of one mesh with their vertices in the same
 * order (Horn's method), and the largest distance left between them as a share of the mesh's size.
 */
function rigidFit(from: Float32Array, to: Float32Array) {
  if (from.length !== to.length) return { m: identity(), error: Infinity };
  const n = from.length / 3;
  const ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ca[k] += from[i * 3 + k] / n; cb[k] += to[i * 3 + k] / n; }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += (from[i * 3 + r] - ca[r]) * (to[i * 3 + c] - cb[c]);
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const [w, x, y, z] = largestEigenvector(N);
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  const t = [0, 1, 2].map((r) => cb[r] - (R[r][0] * ca[0] + R[r][1] * ca[1] + R[r][2] * ca[2]));
  const m: Mat = [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, t[0], t[1], t[2], 1];
  let worst = 0, size = 0;
  for (let i = 0; i < n; i++) {
    const v = transform(m, [from[i * 3], from[i * 3 + 1], from[i * 3 + 2]]);
    worst = Math.max(worst, Math.hypot(v[0] - to[i * 3], v[1] - to[i * 3 + 1], v[2] - to[i * 3 + 2]));
    size = Math.max(size, Math.hypot(to[i * 3] - cb[0], to[i * 3 + 1] - cb[1], to[i * 3 + 2] - cb[2]));
  }
  return { m, error: worst / (size || 1) };
}

/** A rigid move as a turn about a line: its direction, a point on it and the angle (rad, right-handed). */
function hinge(m: Mat) {
  const R = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
  const t = [m[12], m[13], m[14]];
  const angle = Math.acos(Math.max(-1, Math.min(1, (R[0][0] + R[1][1] + R[2][2] - 1) / 2)));
  let axis: V3;
  if (Math.sin(angle) > 1e-3) {
    axis = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
  } else {
    // Half a turn: the axis is the column of R + I with the most length.
    const cols = [0, 1, 2].map((c) => [R[0][c] + (c === 0 ? 1 : 0), R[1][c] + (c === 1 ? 1 : 0), R[2][c] + (c === 2 ? 1 : 0)] as V3);
    axis = cols.sort((a, b) => Math.hypot(...b) - Math.hypot(...a))[0];
  }
  const l = Math.hypot(...axis);
  axis = axis.map((v) => v / l) as V3;
  // The point on the axis nearest the origin: least squares of (I - R) p = t, plus p · axis = 0.
  const A = [0, 1, 2].map((r) => [0, 1, 2].map((c) => (r === c ? 1 : 0) - R[r][c]));
  const rows = [...A.map((row, r) => [...row, t[r]]), [...axis, 0]];
  const AtA = [0, 1, 2].map((r) => [0, 1, 2].map((c) => rows.reduce((s, row) => s + row[r] * row[c], 0)));
  const Atb = [0, 1, 2].map((r) => rows.reduce((s, row) => s + row[r] * row[3], 0));
  const pivot = solve3(AtA, Atb) as V3;
  return { axis, pivot, angle };
}

/** Which way (sign along `across`) a blade lying along `along` has its thinner long edge (thickness along `thick`). */
function thinnerSide(p: Float32Array, along: number, across: number, thick: number, keep?: (x: number, lo: number, hi: number) => boolean) {
  let lo = Infinity, hi = -Infinity;
  for (let i = along; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); }
  // Sample the middle of the length, away from the tip and the fittings.
  const sample = (i: number) => keep ? keep(p[i + along], lo, hi) && p[i + along] > lo + (hi - lo) * 0.2
    : p[i + along] > lo + (hi - lo) * 0.45 && p[i + along] < lo + (hi - lo) * 0.75;
  let amin = Infinity, amax = -Infinity;
  for (let i = 0; i < p.length; i += 3) if (sample(i)) { amin = Math.min(amin, p[i + across]); amax = Math.max(amax, p[i + across]); }
  const band = (amax - amin) * 0.15;
  const thickness = (side: number) => {
    let tmin = Infinity, tmax = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      if (!sample(i)) continue;
      const a = p[i + across];
      if (side < 0 ? a < amin + band : a > amax - band) { tmin = Math.min(tmin, p[i + thick]); tmax = Math.max(tmax, p[i + thick]); }
    }
    return tmax - tmin;
  };
  return thickness(-1) < thickness(1) ? -1 : 1;
}

/** Position along `axis` where the mesh's cross-section is widest (a sword's guard). */
function widestAlong(p: Float32Array, axis: number) {
  const o = [0, 1, 2].filter((k) => k !== axis);
  let best = 0, at = 0;
  for (let i = 0; i < p.length; i += 3) {
    const r = Math.hypot(p[i + o[0]], p[i + o[1]]);
    if (r > best) { best = r; at = p[i + axis]; }
  }
  return at;
}

function identity(): Mat { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

function solve3(A: number[][], b: number[]) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [0, 1, 2].map((r) => M[r][3] / M[r][r]);
}

/** Eigenvector of the largest eigenvalue of a symmetric 4x4 matrix (Jacobi rotations). */
function largestEigenvector(input: number[][]) {
  const a = input.map((r) => [...r]);
  const v: number[][] = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 4; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 4; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [0, 1, 2, 3].map((k) => v[k][best]);
}

// ------------------------------------------------------------------ colour helpers

/** An uncompressed 24 / 32-bit TGA, sampled by UV (v up), as sRGB 0..1. */
function readTga(file: string) {
  const b = fs.readFileSync(file);
  const idLength = b[0], type = b[2], width = b.readUInt16LE(12), height = b.readUInt16LE(14), bpp = b[16] / 8, topDown = (b[17] & 0x20) !== 0;
  if (type !== 2 || (bpp !== 3 && bpp !== 4)) throw new Error(`${file}: only uncompressed true-colour TGA is read (type ${type}, ${bpp * 8} bit)`);
  const data = b.subarray(18 + idLength);
  return {
    at(u: number, v: number): V3 {
      const x = Math.min(width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * width)));
      const fy = Math.min(height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * height)));
      const y = topDown ? height - 1 - fy : fy;
      const i = (y * width + x) * bpp;
      return [data[i + 2] / 255, data[i + 1] / 255, data[i] / 255];
    },
  };
}
