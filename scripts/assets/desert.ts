import path from "node:path";
import sharp from "sharp";
import { getBounds, type Document, type Material, type Node, type Primitive } from "@gltf-transform/core";
import { dedup, join, prune, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { init as initRecast } from "recast-navigation";
import { navMeshFromTriangles } from "../../server/navmesh";
import {
  ROOT, RAW, PUBLIC_MODELS, GENERATED, readModel, writeGLB, buildCollision, writeCollisionBin, pieceBounds, writeJSON,
  compressTextures, multiply, type CollisionMesh, type PieceInfo,
} from "./common";
import { ROUTES, blockMesh, cutDoors, insideFaces, stairMesh, stairRamp, stairWalls, type FlatGround } from "./desert-routes";

/**
 * "Desert City": a finished Unity level (a walled desert town built for 5v5) exported through
 * Sketchfab as one GLB. Besides the town it carries the source project's scene: UI canvases, a
 * second copy of the town for a camera fly-through, mannequins, ad boards, a sky dome and
 * gameplay markers. Only the town and its props are kept; the markers become spawns, callouts
 * and the play area.
 *
 * Built for low-end PCs first:
 * - Materials are opaque and single-sided (as the source engine drew them); decals are
 *   alpha-tested, nothing blends.
 * - The town is merged per material into a few large chunks: a handful of draw calls per chunk,
 *   with chunks still big enough to frustum-cull.
 * - Small clutter (decals, posters, lamps, vases, papers...) goes into `Detail_` pieces that never
 *   collide: Low skips them and other presets cull them by distance, while everything that can
 *   stop a bullet or a player is the same on every preset.
 * - Textures are 1024 px WebP (the source's 2048 px PNGs would need ~180 MB of video memory).
 *
 * The source's "Fake_Collider" boxes (player clips over rooftops and gaps) are kept as a
 * collision-only piece so players stay inside the level as it was designed.
 *
 * Put the downloaded pack at assets-raw/desert-city (source/map.glb, textures/*.png).
 */

const SRC = path.join(RAW, "desert-city/source/map.glb");
/** Source units are centimeters under a 0.01 root scale. */
const S = 100;
/** Center of the source's minimap frame (the play area) becomes the origin. */
const CENTER: [number, number] = [32.7, 1.6];
/** Source height of the lowest street, which becomes y = 0 (the game's ground plane). */
const STREET = 0.1;
/** Half the play area: the source's minimap frame is 120 m square. */
export const DESERT_HALF = 60;
/** Chunk size for merged geometry, in meters. */
const CHUNK = 60;
const DETAIL_CHUNK = 30;

/** Source groups that make up the map. Everything else in the scene is dropped. */
const KEEP = ["DesertTown", "Instances", "Background_mountain"];
/**
 * Source objects left out: the poster hung on the Blue spawn's round-start door (the door itself,
 * "Door_CTSoawn", is a separate group that isn't kept: matches here have no rounds), the
 * closed gate north of the Red spawn, which opens Red's way to the north side, and the crates
 * where the north flank stair stands (see desert-routes.ts).
 */
const DROP_NODE = /^(Decal_poster_concerte_A_002|Big_gate_metal_0[01]|Crate_wood_A \((2|5)\)|Crate_wood_B \(1\))$/;
/** Clutter: no collision, skipped on Low. */
const DETAIL_NODE = /^(Decal_|decal_|additive_|Vase_metal|Carboard|Box_deco|Box_medic|Paper_pile|paper_decal|Carpet|Lamp|Stool|PlasticGarbage)/i;
/**
 * Primitives that are dropped outright: editor helpers, placeholder quads, the sand overlays
 * (sand blended over the lost terrain, at its old height) and the additive light-shaft cards in
 * gateways and skylights (fill-rate heavy, and they wash out whoever stands behind them).
 */
const DROP_MATERIAL = /^(CheckerUnity|GridMat|No Name|UnitPortraitMaterial|SkyDome_Desert|05 - xcxzc|DesertTown_EXT_AadditiveUnlit_01)$/;

/** Clean names for the source materials (the client tunes some of them by name). */
const RENAME: Record<string, string> = {
  DesertTown_EXT_Walls: "Desert_Walls",
  DesertTown_EXT_Props: "Desert_Props",
  DesertTown_EXT_Props2: "Desert_Props2",
  DesertTown_EXT_floors: "Desert_Floor",
  DesertTown_INT_Floor: "Desert_Interior",
  DesertTown_EXT_Tilingrock: "Desert_Rock",
  DesertTown_EXT_Alpha_01: "Desert_Decal",
};
/**
 * Collision simplification, in meters. Flat walls and floors simplify exactly at any error, so
 * this only rounds off ornament (arches, cornices, railings); stairs get ramps of their own.
 * It has to stay under the thickness of the thinnest wall: roller shutters are boxes a few
 * centimeters deep, and a larger error flattens them away.
 */
const COLLISION_ERROR = 0.02;
/** Materials whose primitives never collide. The fading floor sheets do: they pave stairs and ramps. */
const NO_COLLIDE = /^Desert_Decal$/;

/** The piece holding the inner faces of walkable shells. */
const INSIDE = "Desert_Inside";

type Tier = "solid" | "detail" | "backdrop";
type V3 = [number, number, number];

export async function importDesert() {
  const doc = await readModel(SRC);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const top = scene.listChildren()[0];
  const groups = new Map(top.listChildren().map((n) => [n.getName(), n]));

  // Source world space (scaled to meters) → game space.
  const toGame: number[] = [S, 0, 0, 0, 0, S, 0, 0, 0, 0, S, 0, -CENTER[0], -STREET, -CENTER[1], 1];
  const at = (n: Node): V3 => {
    const m = multiply(toGame, n.getWorldMatrix());
    return [round(m[12]), round(m[13]), round(m[14])];
  };

  const markers = readMarkers(groups, toGame, at);
  materials(doc);

  // Every mesh node to keep, with its game-space matrix, its tier and its chunk.
  const placed: { node: Node; matrix: number[]; tier: Tier; chunk: string }[] = [];
  for (const name of KEEP) {
    groups.get(name)!.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh || DROP_NODE.test(node.getName())) return;
      for (const prim of mesh.listPrimitives()) if (DROP_MATERIAL.test(prim.getMaterial()?.getName() ?? "")) prim.dispose();
      if (mesh.listPrimitives().length === 0) return;
      const matrix = multiply(toGame, node.getWorldMatrix());
      const tier: Tier = name === "Background_mountain" ? "backdrop" : DETAIL_NODE.test(node.getName()) ? "detail" : "solid";
      const b = getBounds(node);
      const cx = ((b.min[0] + b.max[0]) / 2) * S - CENTER[0], cz = ((b.min[2] + b.max[2]) / 2) * S - CENTER[1];
      const size = tier === "detail" ? DETAIL_CHUNK : CHUNK;
      // Chunks are centered on the play area so the middle of the map isn't split four ways.
      const chunk = `${Math.floor(cx / size + 0.5)}_${Math.floor(cz / size + 0.5)}`;
      placed.push({ node, matrix, tier, chunk });
    });
  }

  // The decal sheet on buildings and cars is dirty window glass, which the source engine blended:
  // left out, so windows are open on every preset (and cost no blending).
  for (const p of placed) {
    if (p.tier !== "solid") continue;
    for (const prim of p.node.getMesh()!.listPrimitives()) if (prim.getMaterial()!.getName() === "Desert_Decal") prim.dispose();
  }
  const kept = placed.filter((p) => p.node.getMesh()!.listPrimitives().length > 0);
  placed.length = 0;
  placed.push(...kept);

  const flights = stairs(placed);
  // The flank routes' stairs: solid town geometry like the rest, with ramps of their own.
  const floor = root.listMaterials().find((m) => m.getName() === "Desert_Floor")!;
  const chunkAt = (x: number, z: number) => `${Math.floor(x / CHUNK + 0.5)}_${Math.floor(z / CHUNK + 0.5)}`;
  ROUTES.stairs.forEach((s, i) => {
    const chunk = chunkAt((s.x[0] + s.x[1]) / 2, (s.z[0] + s.z[1]) / 2);
    placed.push({ node: stairMesh(doc, s, floor, `Route_Stair_${i}`), matrix: IDENTITY, tier: "solid", chunk });
    flights.push({ chunk, solid: true, ...stairRamp(s, RAMP_GRID) });
  });

  ROUTES.blocks.forEach((k, i) => {
    const chunk = chunkAt((k.min[0] + k.max[0]) / 2, (k.min[2] + k.max[2]) / 2);
    placed.push({ node: blockMesh(doc, k, floor, `Route_Block_${i}`), matrix: IDENTITY, tier: "solid", chunk });
  });

  // Rebuild the scene as flat pieces at the origin: Desert_<chunk>, Detail_Desert_<chunk> and
  // Desert_Backdrop, each holding its mesh nodes with transforms baked in.
  const original = root.listNodes();
  const ground = terrain(doc, markers, placed, ROUTES.flat);
  const pieces = new Map<string, Node>();
  const pieceFor = (tier: Tier, chunk: string) => {
    const name = tier === "backdrop" ? "Desert_Backdrop" : tier === "detail" ? `Detail_Desert_${chunk}` : `Desert_${chunk}`;
    let piece = pieces.get(name);
    if (!piece) pieces.set(name, (piece = doc.createNode(name)));
    return piece;
  };
  for (const p of placed) {
    const mesh = p.node.getMesh()!;
    const leaf = doc.createNode(p.node.getName()).setMesh(mesh).setMatrix(p.matrix as never);
    pieceFor(p.tier, p.chunk).addChild(leaf);
  }
  for (const anim of root.listAnimations()) anim.dispose();
  for (const node of original) node.dispose();
  for (const piece of [...pieces.values()].sort((a, b) => a.getName().localeCompare(b.getName()))) scene.addChild(piece);
  scene.addChild(ground);

  // Primitives must share attributes to merge: give the few without vertex colors plain white.
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) ensureColor(doc, prim);
  await doc.transform(prune(), dedup(), weld(), join({ keepNamed: false }));
  const doors = cutDoors(doc, [...pieces.values()].filter((p) => p.getName() !== "Desert_Backdrop"), ROUTES.doors, floor,
    (d) => pieceFor("solid", chunkAt((d.min[0] + d.max[0]) / 2, (d.min[2] + d.max[2]) / 2)));

  // Walkable shells get their inner faces; they draw but never collide (the walls they back do).
  const inside = insideFaces(doc, [...pieces.values()].filter((p) => /^Desert_-?[0-9]/.test(p.getName())), ROUTES.inside, INSIDE);
  if (inside) scene.addChild(inside.node);

  await compressTextures(doc, 1024, 84);
  const bytes = await writeGLB(doc, path.join(PUBLIC_MODELS, "desert.glb"));

  // Collision from the written document's triangles: solid pieces (minus overlays), plus the
  // source's player-clip boxes as their own piece.
  const collision = new Map<string, CollisionMesh | null>();
  const info: Record<string, PieceInfo> = {};
  for (const piece of scene.listChildren()) {
    const name = piece.getName();
    const solid = !name.startsWith("Detail_") && name !== "Desert_Backdrop" && name !== INSIDE;
    if (!solid) { info[name] = pieceBounds(piece); continue; }
    const walls = ROUTES.stairs.filter((st) => `Desert_${chunkAt((st.x[0] + st.x[1]) / 2, (st.z[0] + st.z[1]) / 2)}` === name).map(stairWalls);
    collision.set(name, merge([withRamps(buildCollision(piece, NO_COLLIDE, COLLISION_ERROR, { keepShells: true }), flights.filter((f) => `Desert_${f.chunk}` === name)), ...walls]));
    info[name] = pieceBounds(piece);
  }
  // The town's outer edge had terrain hills between its buildings and rocks; without them the
  // sand outside is open. Seal those gaps with player clips of our own.
  const seal = await perimeter([...[...collision.values()].filter((m): m is CollisionMesh => !!m), boxesMesh(markers.clips)]);
  collision.set("Clip_Desert", boxesMesh([...markers.clips, ...seal]));
  const { ranges, positionsByteLength } = writeCollisionBin(path.join(PUBLIC_MODELS, "desert.collision.bin"), collision);
  for (const [name, range] of ranges) (info[name] ??= boxBounds([...markers.clips, ...seal])).col = range;

  const solid = new Surfaces([...collision].filter(([name, m]) => m && !name.startsWith("Clip_")).map(([, m]) => m!));
  const layout = playLayout(solid, markers);
  writeJSON(path.join(GENERATED, "desert-pieces.json"), { positionsByteLength, pieces: info, ...layout });
  // Past the rebuilt terrain, the game's flat ground plane wears the pack's tiling sand.
  await sharp(path.join(RAW, "desert-city/textures/DesertTown_EXT_TilingSand_2.png")).resize(512, 512).webp({ quality: 80 })
    .toFile(path.join(ROOT, "public/env/desert_sand.webp"));
  let tris = 0;
  for (const r of ranges.values()) tris += r[3] / 3;
  let drawn = 0, prims = 0;
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) { prims++; drawn += (prim.getIndices()?.getCount() ?? 0) / 3; }
  console.log(`[desert] ${(bytes / 1e6).toFixed(2)} MB glb, ${pieces.size} pieces, ${flights.length} stair ramps, ${ROUTES.doors.length} doors (${doors.cut} tris cut, ${doors.caps} cap tris), ${inside?.tris ?? 0} inside tris, ${prims} primitives, ${drawn} tris drawn, ${tris} collision tris, ${markers.clips.length} + ${seal.length} clip boxes, spawns ${layout.spawns.blue.length}/${layout.spawns.red.length}/${layout.spawns.ffa.length}, ${layout.footprints.length} footprints`);
}

/** Merges the source's duplicate materials and sets them up for the game's renderer. */
function materials(doc: Document) {
  for (const m of doc.getRoot().listMaterials()) {
    const name = RENAME[m.getName()];
    if (!name) continue;
    m.setName(name);
    // The source engine's surfaces are matte; glTF export left most of them fully metallic.
    m.setMetallicFactor(0).setRoughnessFactor(name === "Desert_Props2" ? 0.75 : 0.92);
    m.setDoubleSided(name === "Desert_Decal");
    m.setAlphaMode(name === "Desert_Decal" ? "MASK" : /Blend/.test(name) ? "BLEND" : "OPAQUE");
  }
  // Floor primitives whose vertex alpha varies were vertex-painted for the source shader, which
  // blended floor tiles by it; it never meant transparency (whole staircases are painted to 0,
  // so drawn see-through they looked like glass, and cut out they vanished). They are drawn
  // opaque, their own tile. Their vertex shading darkens risers to near black: half of it keeps
  // steps readable. They keep a material of their own (the extras stop dedup merging it) because
  // some lie on other floors and need the client's depth offset.
  let blend: Material | null = null;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial()?.getName() !== "Desert_Floor" || !fades(prim)) continue;
    blend ??= prim.getMaterial()!.clone().setName("Desert_FloorBlend").setExtras({ paving: true });
    prim.setMaterial(blend);
    const color = prim.getAttribute("COLOR_0")!.clone();
    const c: number[] = [];
    for (let i = 0; i < color.getCount(); i++) {
      color.getElement(i, c);
      color.setElement(i, [0.5 + c[0] / 2, 0.5 + c[1] / 2, 0.5 + c[2] / 2, 1]);
    }
    prim.setAttribute("COLOR_0", color);
    PAVING.add(prim);
  }
}

/** The vertex-painted floor primitives: paving that lay on the lost terrain (see `terrain`). */
const PAVING = new WeakSet<Primitive>();

function fades(prim: Primitive) {
  const c = prim.getAttribute("COLOR_0");
  if (!c || c.getElementSize() < 4) return false;
  const v: number[] = [];
  for (let i = 0; i < c.getCount(); i++) if (c.getElement(i, v)[3] < 0.98) return true;
  return false;
}

function ensureColor(doc: Document, prim: Primitive) {
  if (prim.getAttribute("COLOR_0")) return;
  const n = prim.getAttribute("POSITION")!.getCount();
  const white = new Uint16Array(n * 4).fill(65535);
  prim.setAttribute("COLOR_0", doc.createAccessor().setType("VEC4").setArray(white).setNormalized(true).setBuffer(doc.getRoot().listBuffers()[0]));
}

/** A clip volume as its 8 corners (bit 0: +axis 1, bit 1: +axis 2, bit 2: +axis 3). */
type Box = V3[];

/** A node's three scaled axes in game space and its center. */
function axes(toGame: number[], n: Node) {
  const m = multiply(toGame, n.getWorldMatrix());
  return { center: [m[12], m[13], m[14]] as V3, axes: [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]] as V3[] };
}

/** Spawns, callouts and clip boxes from the source's marker objects, in game space. */
function readMarkers(groups: Map<string, Node>, toGame: number[], at: (n: Node) => V3) {
  const zone = (name: string) => {
    // Zone markers are flat quads; their size on the ground is along the two level axes.
    const a = axes(toGame, groups.get(name)!).axes.filter((v) => Math.abs(v[1]) < 0.1 * Math.hypot(...v));
    return { center: at(groups.get(name)!), size: a.map((v) => round(Math.hypot(...v))) };
  };
  const ffa = [...groups.keys()].filter((k) => k.startsWith("Spawn_FFA")).sort().map((k) => at(groups.get(k)!));
  // Player clips: unit cubes, scaled and turned (the grenade-only colliders are left out).
  const clips: Box[] = groups.get("Fake_Collider")!.listChildren().filter((n) => /^FakeCOlliderCUbe/i.test(n.getName())).map((n) => {
    const { center, axes: [a, b, c] } = axes(toGame, n);
    return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const s = [i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5];
      return [0, 1, 2].map((k) => round(center[k] + a[k] * s[0] + b[k] * s[1] + c[k] * s[2])) as V3;
    });
  });
  return {
    teams: [zone("Spawn_WholeTeam0"), zone("Spawn_WholeTeam1")],
    ffa,
    sites: { A: at(groups.get("BombsiteA")!), B: at(groups.get("BombsiteB")!) },
    clips,
  };
}

/** Several collision meshes as one. */
function merge(meshes: (CollisionMesh | null)[]): CollisionMesh | null {
  const parts = meshes.filter((m): m is CollisionMesh => !!m);
  if (parts.length <= 1) return parts[0] ?? null;
  const pos: number[] = [], idx: number[] = [];
  for (const m of parts) {
    const base = pos.length / 3;
    for (const v of m.positions) pos.push(v);
    for (const i of m.indices) idx.push(base + i);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
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

type Markers = ReturnType<typeof readMarkers>;

/** A staircase's walking surface as a ramp: heights on a grid (NaN off the flight). */
interface Flight {
  chunk: string; x0: number; z0: number; nx: number; nz: number; ramp: Float32Array;
  /** Our own solid stairs: everything under the ramp goes, their tall sides included (`stairWalls` replaces them). */
  solid?: boolean;
}
const RAMP_GRID = 0.2;

/**
 * The town's stairs have slanted risers that the character controller can't step up. Like the
 * clip ramps FPS maps put on stairs, each flight gets a ramp through its steps: the highest
 * tread at every 20 cm, averaged over about one step's run (the average of a staircase over
 * one period is its slope). A flight is a structure with four or more treads 10 to 42 cm apart.
 */
function stairs(placed: { node: Node; matrix: number[]; tier: Tier; chunk: string }[]): Flight[] {
  const out: Flight[] = [];
  const v = [0, 0, 0];
  for (const { node, matrix: m, tier, chunk } of placed) {
    if (tier !== "solid" || !/^Desert_Structure/.test(node.getName())) continue;
    const treads: number[][] = [];
    for (const prim of node.getMesh()!.listPrimitives()) {
      if (NO_COLLIDE.test(prim.getMaterial()!.getName())) continue;
      const pos = prim.getAttribute("POSITION")!, idx = prim.getIndices()!;
      const w: number[][] = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        w.push([0, 1, 2].map((k) => m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]));
      }
      for (let t = 0; t < idx.getCount(); t += 3) {
        const [a, b, c] = [w[idx.getScalar(t)], w[idx.getScalar(t + 1)], w[idx.getScalar(t + 2)]];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const ny = uz * vx - ux * vz, len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
        if (len > 1e-9 && ny / len > 0.95) treads.push([...a, ...b, ...c]);
      }
    }
    const levels = [...new Set(treads.map((t) => Math.round(t[1] * 20) / 20))].sort((a, b) => a - b);
    let run = 1, best = 1;
    for (let i = 1; i < levels.length; i++) {
      const rise = levels[i] - levels[i - 1];
      run = rise >= 0.1 && rise <= 0.42 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    if (best < 4) continue;

    const xs = treads.flatMap((t) => [t[0], t[3], t[6]]), zs = treads.flatMap((t) => [t[2], t[5], t[8]]);
    const x0 = Math.min(...xs), z0 = Math.min(...zs);
    const nx = Math.ceil((Math.max(...xs) - x0) / RAMP_GRID) + 1, nz = Math.ceil((Math.max(...zs) - z0) / RAMP_GRID) + 1;
    const top = new Float32Array(nx * nz).fill(NaN);
    for (const [ax, ay, az, bx, by, bz, cx, cy, cz] of treads) {
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      for (let i = Math.floor((Math.min(ax, bx, cx) - x0) / RAMP_GRID); i <= Math.ceil((Math.max(ax, bx, cx) - x0) / RAMP_GRID); i++)
        for (let k = Math.floor((Math.min(az, bz, cz) - z0) / RAMP_GRID); k <= Math.ceil((Math.max(az, bz, cz) - z0) / RAMP_GRID); k++) {
          if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
          const x = x0 + i * RAMP_GRID, z = z0 + k * RAMP_GRID;
          const l0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
          if (l0 < -0.02 || l1 < -0.02 || l0 + l1 > 1.02) continue;
          const y = l0 * ay + l1 * by + (1 - l0 - l1) * cy, c = k * nx + i;
          if (!(y <= top[c])) top[c] = y; // the highest tread (NaN compares false)
        }
    }
    const ramp = top.map((h, c) => {
      if (Number.isNaN(h)) return NaN;
      const i = c % nx, k = (c - i) / nx;
      let t = 0, n = 0;
      for (let b = Math.max(0, k - 1); b <= Math.min(nz - 1, k + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) {
        const y = top[b * nx + a];
        if (!Number.isNaN(y)) { t += y; n++; }
      }
      return t / n;
    });
    // Structures are whole buildings: only the stepped cells are the flight. Left in, its flat
    // roofs would count as treads, and everything under them (walls, floors) as its steps.
    const stepped = steppedCells(top, nx, nz);
    out.push({ chunk, x0, z0, nx, nz, ramp: ramp.map((y, c) => (stepped[c] ? y : NaN)) });
  }
  return out;
}

/**
 * Cells on a staircase: joined by step-sized rises into a patch of four or more levels, and within
 * a step's reach of a change in height (so a flight keeps its landings' edges, not the floor beyond).
 */
function steppedCells(top: Float32Array, nx: number, nz: number) {
  const REACH = 3;
  const out = new Uint8Array(nx * nz), seen = new Uint8Array(nx * nz);
  for (let start = 0; start < top.length; start++) {
    if (seen[start] || Number.isNaN(top[start])) continue;
    const patch = [start];
    seen[start] = 1;
    for (let q = 0; q < patch.length; q++) {
      const c = patch[q], i = c % nx, k = (c - i) / nx;
      for (const [a, b] of [[i - 1, k], [i + 1, k], [i, k - 1], [i, k + 1]]) {
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const n = b * nx + a;
        if (!seen[n] && Math.abs(top[n] - top[c]) <= 0.45) { seen[n] = 1; patch.push(n); }
      }
    }
    if (new Set(patch.map((c) => Math.round(top[c] * 20))).size < 4) continue;
    for (const c of patch) {
      const i = c % nx, k = (c - i) / nx;
      let lo = Infinity, hi = -Infinity;
      for (let b = Math.max(0, k - REACH); b <= Math.min(nz - 1, k + REACH); b++) for (let a = Math.max(0, i - REACH); a <= Math.min(nx - 1, i + REACH); a++) {
        const y = top[b * nx + a];
        if (!Number.isNaN(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
      }
      if (hi - lo >= 0.1 && hi - lo <= 1.6) out[c] = 1;
    }
  }
  return out;
}

/** A chunk's collision with each flight's treads and risers swapped for its ramp. */
function withRamps(mesh: CollisionMesh | null, flights: Flight[]): CollisionMesh | null {
  if (!mesh || !flights.length) return mesh;
  const { positions: p, indices } = mesh;
  // Under a flight's ramp (with room for a riser's top edge, read on the ramp's 20 cm grid): part of the steps.
  const under = (v: number, among = flights) => among.some((f) => {
    const i = Math.round((p[v * 3] - f.x0) / RAMP_GRID), k = Math.round((p[v * 3 + 2] - f.z0) / RAMP_GRID);
    if (i < 0 || k < 0 || i >= f.nx || k >= f.nz) return false;
    const r = f.ramp[k * f.nx + i];
    return !Number.isNaN(r) && p[v * 3 + 1] <= r + 0.3;
  });
  // A tread or riser is step-sized; anything taller under a ramp is a wall beside or below it.
  const stepSized = (a: number, b: number, c: number) => Math.max(p[a * 3 + 1], p[b * 3 + 1], p[c * 3 + 1]) - Math.min(p[a * 3 + 1], p[b * 3 + 1], p[c * 3 + 1]) <= 0.6;
  const kept: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const ours = flights.filter((f) => f.solid);
    if (!((stepSized(a, b, c) && under(a) && under(b) && under(c)) || (under(a, ours) && under(b, ours) && under(c, ours)))) kept.push(a, b, c);
  }
  const pos = Array.from(p);
  for (const f of flights) {
    const grid = new Float32Array(f.nx * f.nz * 3), quads: number[] = [];
    for (let k = 0; k < f.nz; k++) for (let i = 0; i < f.nx; i++) grid.set([f.x0 + i * RAMP_GRID, Number.isNaN(f.ramp[k * f.nx + i]) ? 0 : f.ramp[k * f.nx + i], f.z0 + k * RAMP_GRID], (k * f.nx + i) * 3);
    for (let k = 0; k < f.nz - 1; k++) for (let i = 0; i < f.nx - 1; i++) {
      const a = k * f.nx + i, b = a + 1, c = a + f.nx, d = c + 1;
      if ([a, b, c, d].some((q) => Number.isNaN(f.ramp[q]))) continue;
      quads.push(a, c, b, b, c, d);
    }
    // Ramps are close to flat: a few large triangles each.
    const [few] = MeshoptSimplifier.simplify(new Uint32Array(quads), grid, 3, 0, 0.02, ["LockBorder", "ErrorAbsolute"]);
    const used = new Map<number, number>();
    for (const q of few) {
      let j = used.get(q);
      if (j === undefined) { used.set(q, (j = pos.length / 3)); pos.push(grid[q * 3], grid[q * 3 + 1], grid[q * 3 + 2]); }
      kept.push(j);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(kept) };
}

/** Half size of the rebuilt terrain (a little past the play area, under the town's outer walls). */
const TERRAIN_HALF = 66;

/**
 * The source's streets and yards were a terrain, which doesn't survive the export: buildings in
 * the raised east half would float over the game's flat ground. This rebuilds it as a
 * heightfield from what rested on it: at each meter, the lowest point of any geometry there (wall
 * bottoms, floors, props) marks the ground. Spots more than a story above the lowest ground nearby
 * (roofs of closed buildings) are ignored, except paving that fades into the ground; the spawn
 * markers add their own spots, and open
 * streets are filled smoothly in between, fading to the flat ground outside the play area.
 * Simplified flat areas collapse to a few large triangles.
 */
function terrain(doc: Document, markers: Markers, placed: { node: Node; matrix: number[]; tier: Tier }[], flat: FlatGround[]): Node {
  const H = TERRAIN_HALF, N = H * 2 + 1; // vertices at integer meters
  const known = new Float32Array(N * N).fill(Infinity);
  const cell = (x: number, z: number) => {
    const i = Math.round(x + H), k = Math.round(z + H);
    return i < 0 || k < 0 || i >= N || k >= N ? -1 : k * N + i;
  };
  const paving = new Float32Array(N * N).fill(Infinity);
  /** Lowest upward-facing surface (floors, sills, steps) in each cell. */
  const up = new Float32Array(N * N).fill(Infinity);
  let into = known;
  const mark = (x: number, z: number, y: number, floor: boolean) => {
    const c = cell(x, z);
    if (c < 0) return;
    if (y < into[c]) into[c] = y;
    if (floor && y < up[c]) up[c] = y;
  };
  const v = [0, 0, 0];
  for (const { node, matrix: m, tier } of placed) {
    if (tier === "backdrop") continue;
    {
      for (const prim of node.getMesh()?.listPrimitives() ?? []) {
        // Paving that fades out at its edges was made to blend into the terrain, so it lay on it.
        into = PAVING.has(prim) && !/^Rooftop/i.test(node.getName()) ? paving : known;
        const pos = prim.getAttribute("POSITION")!, w = new Float32Array(pos.getCount() * 3);
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          w[i * 3] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
          w[i * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
          w[i * 3 + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        }
        // Every triangle sampled every half meter: a floor quad or a long wall has vertices only
        // at its corners, but marks every meter it covers (a wall, its bottom edge).
        const idx = prim.getIndices()!;
        for (let t = 0; t < idx.getCount(); t += 3) {
          const [a, b, c] = [idx.getScalar(t) * 3, idx.getScalar(t + 1) * 3, idx.getScalar(t + 2) * 3];
          const edge = (p: number, q: number) => Math.hypot(w[p] - w[q], w[p + 2] - w[q + 2]);
          const ux = w[b] - w[a], uy = w[b + 1] - w[a + 1], uz = w[b + 2] - w[a + 2], vx = w[c] - w[a], vy = w[c + 1] - w[a + 1], vz = w[c + 2] - w[a + 2];
          const ny = uz * vx - ux * vz, len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
          const floor = len > 1e-9 && Math.abs(ny) / len > 0.7;
          const steps = Math.max(1, Math.ceil(Math.max(edge(a, b), edge(b, c), edge(c, a)) / 0.5));
          for (let i = 0; i <= steps; i++) for (let j = 0; i + j <= steps; j++) {
            const l0 = i / steps, l1 = j / steps, l2 = 1 - l0 - l1;
            mark(l0 * w[a] + l1 * w[b] + l2 * w[c], l0 * w[a + 2] + l1 * w[b + 2] + l2 * w[c + 2], l0 * w[a + 1] + l1 * w[b + 1] + l2 * w[c + 1], floor);
          }
        }
      }
    }
  }
  // Roofs: evidence more than 4 m above the lowest evidence within 6 m (the town's raised half is
  // a story up, about 3.5 m). Paving counts up to 4.5 m above it (raised plazas and ramps, not
  // the faded sheets on terraces).
  const evidence = known.slice();
  const R = 6;
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
    let low = Infinity;
    for (let b = Math.max(0, k - R); b <= Math.min(N - 1, k + R); b++) for (let a = Math.max(0, i - R); a <= Math.min(N - 1, i + R); a++) low = Math.min(low, known[b * N + a]);
    const c = k * N + i;
    if (known[c] > low + 4) evidence[c] = Infinity;
    if (paving[c] <= Math.min(low, paving[c]) + 4.5) evidence[c] = paving[c];
    else paving[c] = Infinity;
  }
  // Outside the play area the ground fades down to the game's flat ground at the edge.
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
    const edge = Math.max(Math.abs(i - H), Math.abs(k - H));
    if (edge > DESERT_HALF) evidence[k * N + i] = edge >= H ? 0 : Infinity;
  }
  // Spawn markers stand a little above the ground they mark.
  for (const [x, y, z] of [...markers.ffa, ...markers.teams.map((t) => t.center)]) {
    const c = cell(x, z);
    if (c >= 0) evidence[c] = Math.min(evidence[c], y - 0.15);
  }
  for (let c = 0; c < evidence.length; c++) if (evidence[c] < -1) evidence[c] = Infinity; // cliff bases outside the walls
  for (const f of flat) for (let z = Math.ceil(f.z[0]); z <= Math.floor(f.z[1]); z++) for (let x = Math.ceil(f.x[0]); x <= Math.floor(f.x[1]); x++) {
    const c = cell(x, z);
    if (c >= 0) evidence[c] = f.y;
  }

  // Fill the gaps (Laplace relaxation with the evidence held fixed), then soften.
  const h = new Float32Array(N * N);
  let sum = 0, n = 0;
  for (const e of evidence) if (e < Infinity) { sum += e; n++; }
  for (let c = 0; c < h.length; c++) h[c] = evidence[c] < Infinity ? evidence[c] : sum / n;
  for (let iter = 0; iter < 1500; iter++) for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
    const c = k * N + i;
    if (evidence[c] < Infinity) continue;
    h[c] = (h[k * N + Math.max(0, i - 1)] + h[k * N + Math.min(N - 1, i + 1)] + h[Math.max(0, k - 1) * N + i] + h[Math.min(N - 1, k + 1) * N + i]) / 4;
  }
  // Lone spikes (a table top, a post with nothing around it): down to their neighbours' median.
  for (let k = 1; k < N - 1; k++) for (let i = 1; i < N - 1; i++) {
    const around = [h[(k - 1) * N + i - 1], h[(k - 1) * N + i], h[(k - 1) * N + i + 1], h[k * N + i - 1], h[k * N + i + 1], h[(k + 1) * N + i - 1], h[(k + 1) * N + i], h[(k + 1) * N + i + 1]].sort((a, b) => a - b);
    const median = (around[3] + around[4]) / 2;
    if (h[k * N + i] > median + 0.4 && paving[k * N + i] === Infinity) { h[k * N + i] = median; evidence[k * N + i] = Math.min(evidence[k * N + i], median); }
  }
  const soft = h.map((_, c) => {
    const i = c % N, k = (c - i) / N;
    let t = 0, w = 0;
    for (let b = Math.max(0, k - 1); b <= Math.min(N - 1, k + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(N - 1, i + 1); a++) { t += h[b * N + a]; w++; }
    // Never above what rests on it, never under the game's ground plane.
    return Math.max(0, Math.min(t / w, evidence[c]) - 0.04);
  });
  // Walls were sunk into the old terrain, so their bottoms read low: next to a ground-level floor
  // (a door sill, a porch, the first step), bring the ground up to a step below it.
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
    let floor = Infinity;
    for (let b = Math.max(0, k - 1); b <= Math.min(N - 1, k + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(N - 1, i + 1); a++) {
      const n = b * N + a;
      if (up[n] - Math.min(known[n], paving[n]) < 1.2) floor = Math.min(floor, up[n]);
    }
    // Only a sill's worth: a roof slab over open ground lifts nothing.
    const c = k * N + i;
    if (floor - soft[c] < 0.85) soft[c] = Math.max(soft[c], floor - 0.25);
  }

  const positions = new Float32Array(N * N * 3);
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) positions.set([i - H, soft[k * N + i], k - H], (k * N + i) * 3);
  const grid: number[] = [];
  for (let k = 0; k < N - 1; k++) for (let i = 0; i < N - 1; i++) {
    const a = k * N + i, b = a + 1, c = a + N, d = c + 1;
    grid.push(a, c, b, b, c, d); // counterclockwise seen from above
  }
  const [simplified] = MeshoptSimplifier.simplify(new Uint32Array(grid), positions, 3, 0, 0.03, ["LockBorder", "ErrorAbsolute"]);

  // Compact to the vertices still used; normals from the heightfield, UVs tile every 4 m.
  const remap = new Map<number, number>(), P: number[] = [], NRM: number[] = [], UV: number[] = [];
  const at = (i: number, k: number) => soft[Math.min(N - 1, Math.max(0, k)) * N + Math.min(N - 1, Math.max(0, i))];
  const idx = Array.from(simplified, (src) => {
    let dst = remap.get(src);
    if (dst === undefined) {
      remap.set(src, (dst = remap.size));
      const i = src % N, k = (src - i) / N;
      P.push(i - H, soft[src], k - H);
      const nx = at(i - 1, k) - at(i + 1, k), nz = at(i, k - 1) - at(i, k + 1), len = Math.hypot(nx, 2, nz);
      NRM.push(nx / len, 2 / len, nz / len);
      UV.push((i - H) / 4, (k - H) / 4);
    }
    return dst;
  });
  const buffer = doc.getRoot().listBuffers()[0];
  const acc = (type: "VEC2" | "VEC3", array: Float32Array<ArrayBuffer>) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const sand = doc.getRoot().listTextures().find((t) => t.getName() === "DesertTown_EXT_TilingSand")!;
  const material = doc.createMaterial("Desert_Ground").setBaseColorTexture(sand).setBaseColorFactor([0.93, 0.87, 0.78, 1])
    .setMetallicFactor(0).setRoughnessFactor(1);
  const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute("POSITION", acc("VEC3", new Float32Array(P)))
    .setAttribute("NORMAL", acc("VEC3", new Float32Array(NRM)))
    .setAttribute("TEXCOORD_0", acc("VEC2", new Float32Array(UV)))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(buffer));
  ensureColor(doc, prim);
  const piece = doc.createNode("Desert_Ground");
  piece.addChild(doc.createNode("Desert_Ground_mesh").setMesh(doc.createMesh("Desert_Ground").addPrimitive(prim)));
  console.log(`[desert] terrain ${idx.length / 3} tris (from ${grid.length / 3}), height ${Math.min(...soft).toFixed(2)}..${Math.max(...soft).toFixed(2)}`);
  return piece;
}

/**
 * Collision triangles bucketed on a 2 m grid, for height queries straight down. Off the
 * geometry, the game's ground plane (y = 0) is the floor.
 */
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
    const out = [0];
    for (const id of this.grid.get(`${Math.floor(x / 2)},${Math.floor(z / 2)}`) ?? []) {
      const [x0, y0, z0, x1, y1, z1, x2, y2, z2] = this.tris[id];
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(d) < 1e-9) continue;
      const a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d, b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
      if (a < 0 || b < 0 || a + b > 1) continue;
      out.push(a * y0 + b * y1 + (1 - a - b) * y2);
    }
    return out;
  }

  /** The highest floor at or below `y`. */
  floor(x: number, z: number, y: number) {
    return Math.max(...this.at(x, z).filter((h) => h <= y));
  }

  /** True when a standing player at (x, floor, z) has nothing within reach around them. */
  clear(x: number, z: number, floor: number) {
    for (const [dx, dz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [0.35, 0.35], [-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35]]) {
      const hs = this.at(x + dx, z + dz);
      if (hs.some((h) => h > floor + 0.25 && h < floor + 2.1)) return false;
      if (Math.abs(this.floor(x + dx, z + dz, floor + 0.25) - floor) > 0.2) return false;
    }
    return true;
  }
}

type Spawn = [number, number, number];

/** Spawns placed on the real collision, and building footprints for the minimap. */
function playLayout(surfaces: Surfaces, markers: Markers) {
  /** Up to `count` open spots on a grid over a spawn zone, nearest the middle first. */
  const zoneSpawns = ({ center: [cx, cy, cz], size: [sx, sz] }: Markers["teams"][number], count: number): Spawn[] => {
    const spots: (Spawn & { d?: number })[] = [];
    const step = 1.5;
    for (let x = -sx / 2 + 0.6; x <= sx / 2 - 0.6; x += step) for (let z = -sz / 2 + 0.6; z <= sz / 2 - 0.6; z += step) {
      const px = round(cx + x), pz = round(cz + z), floor = surfaces.floor(px, pz, cy + 1);
      if (Math.abs(floor - cy) < 1 && surfaces.clear(px, pz, floor)) spots.push([px, round(floor), pz]);
    }
    return spots.sort((a, b) => Math.hypot(a[0] - cx, a[2] - cz) - Math.hypot(b[0] - cx, b[2] - cz)).slice(0, count);
  };
  const ffa = markers.ffa.map(([x, y, z]): Spawn => [x, round(surfaces.floor(x, z, y + 0.5)), z]).filter(([x, y, z]) => surfaces.clear(x, z, y));

  // Footprints: 1 m cells whose top surface is a roof (well above the lowest floor nearby),
  // merged into rectangles.
  const H = DESERT_HALF, N = H * 2;
  const top = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) top[j * N + i] = Math.max(...surfaces.at(i - H + 0.5, j - H + 0.5));
  const low = new Float32Array(N * N);
  const R = 8;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    let m = Infinity;
    for (let a = Math.max(0, i - R); a <= Math.min(N - 1, i + R); a++) for (let b = Math.max(0, j - R); b <= Math.min(N - 1, j + R); b++) m = Math.min(m, top[b * N + a]);
    low[j * N + i] = m;
  }
  const roof = top.map((t, k) => (t - low[k] > 4.5 ? 1 : 0));
  return { spawns: { blue: zoneSpawns(markers.teams[0], 10), red: zoneSpawns(markers.teams[1], 10), ffa }, teams: markers.teams, sites: markers.sites, footprints: rectangles(roof, N, -H) };
}

/**
 * Player clips across the gaps in the town's outer edge. A navmesh of the collision (the same one
 * bots use) says where a player can stand; every meter where nobody can is wall. Closing that mask
 * (grow 5 m, shrink 5 m) bridges gaps up to 10 m wide, and whatever the map's edge can't reach
 * through it is the town. Where open ground outside touches open ground inside, a clip column
 * stands on the outside cell.
 */
async function perimeter(meshes: CollisionMesh[]): Promise<Box[]> {
  const H = TERRAIN_HALF, N = H * 2, R = 5;
  await initRecast();
  const positions: number[] = [], indices: number[] = [];
  for (const m of meshes) {
    const base = positions.length / 3;
    for (const v of m.positions) positions.push(v);
    for (const i of m.indices) indices.push(base + i);
  }
  const nav = navMeshFromTriangles(positions, indices, H);
  const wall = new Uint8Array(N * N);
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
    // Standing room anywhere under the roof lid (8.4 m).
    const x = i - H + 0.5, z = k - H + 0.5;
    const p = nav.findClosestPoint({ x, y: 3.5, z }, { halfExtents: { x: 0.5, y: 4, z: 0.5 } });
    if (!p.success || Math.hypot(p.point.x - x, p.point.z - z) > 0.5) wall[k * N + i] = 1;
  }
  const grow = (src: Uint8Array, value: number) => {
    const out = new Uint8Array(N * N);
    for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
      let hit = false;
      for (let b = Math.max(0, k - R); b <= Math.min(N - 1, k + R) && !hit; b++) for (let a = Math.max(0, i - R); a <= Math.min(N - 1, i + R); a++) if (src[b * N + a] === value) { hit = true; break; }
      out[k * N + i] = hit === (value === 1) ? 1 : 0;
    }
    return out;
  };
  const closed = grow(grow(wall, 1), 0);
  for (let c = 0; c < N * N; c++) closed[c] |= wall[c];
  // Flood the outside in from the map's edge.
  const outside = new Uint8Array(N * N), queue: number[] = [];
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) if ((i === 0 || k === 0 || i === N - 1 || k === N - 1) && !closed[k * N + i]) { outside[k * N + i] = 1; queue.push(k * N + i); }
  while (queue.length) {
    const c = queue.pop()!, i = c % N, k = (c - i) / N;
    for (const [a, b] of [[i - 1, k], [i + 1, k], [i, k - 1], [i, k + 1]]) {
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const n = b * N + a;
      if (!outside[n] && !closed[n]) { outside[n] = 1; queue.push(n); }
    }
  }
  const seal = new Float32Array(N * N);
  for (let k = 1; k < N - 1; k++) for (let i = 1; i < N - 1; i++) {
    const c = k * N + i;
    if (!outside[c]) continue;
    for (let b = k - 1; b <= k + 1; b++) for (let a = i - 1; a <= i + 1; a++) if (!outside[b * N + a] && !wall[b * N + a]) seal[c] = 1;
  }
  if (process.env.DEBUG_SEAL) {
    const img = Buffer.alloc(N * N * 3);
    for (let c = 0; c < N * N; c++) img.set(seal[c] ? [255, 0, 255] : wall[c] ? [200, 200, 200] : closed[c] ? [120, 120, 120] : outside[c] ? [20, 20, 20] : [30, 110, 30], c * 3);
    void sharp(img, { raw: { width: N, height: N, channels: 3 } }).resize(N * 4, N * 4, { kernel: "nearest" }).png().toFile(process.env.DEBUG_SEAL);
  }
  return rectangles(seal, N, -H, 1).map(({ x, z, sx, sz }) => [0, 1, 2, 3, 4, 5, 6, 7].map((j): V3 => [j & 1 ? x + sx : x, j & 2 ? 16 : -1, j & 4 ? z + sz : z]));
}

/** Greedy merge of set grid cells into rectangles {x, z, sx, sz}; smaller than `minArea` cells is dropped. */
function rectangles(cells: Float32Array, n: number, origin: number, minArea = 3) {
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
    // For footprints, single cells are noise (posts, antennas).
    if (w * h >= minArea) out.push({ x: origin + i, z: origin + j, sx: w, sz: h });
  }
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
