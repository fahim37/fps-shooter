import path from "node:path";
import sharp from "sharp";
import RAPIER from "@dimforge/rapier3d-compat";
import { Document, type Material, type Texture } from "@gltf-transform/core";
import { weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import {
  RAW, PUBLIC_MODELS, GENERATED, writeGLB, writeCollisionBin, pieceBounds, writeJSON, compressTextures,
  type CollisionMesh, type PieceInfo,
} from "./common";
import { Surfaces, boxesMesh, boxBounds, rectangles, spread, type Box } from "./arena";
import { readDae, type DaeScene } from "./collada";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../../game/shared/constants";

/**
 * "Boulevard": a SketchUp model of a ceremonial avenue, in one COLLADA file. A sunken road runs
 * between terraced walks and two pairs of tower blocks, crossed halfway by a court with a statue
 * and a pool, and ends in a round plaza under a crescent palace.
 *
 * The source is a 43 x 13 m miniature, so it is scaled to `STREET_SCALE`. That keeps each terrace
 * step under a jump (1.02 m) and the stairs' risers under the autostep, and makes the map about
 * as long as Blockade. The avenue runs along Z: Blue starts at the plaza (-Z), Red at the far
 * end (+Z).
 *
 * The source's faces:
 * - SketchUp writes every face twice, front and reversed, and leaves unpainted sides in its
 *   default blue. Left alone they z-fight, and half of them are inside something. `visibleFaces`
 *   floods the outside air through a voxel grid and keeps only the sides that air touches; a
 *   side left unpainted borrows the paint of its other side.
 * - Textures tile every few centimeters and are never needed for their color, so every floor and
 *   wall gets world-space UVs on one of three gray textures, tinted by vertex color. The rest is
 *   flat vertex color. That is four materials in all, so a chunk costs at most four draw calls.
 *
 * Built for low-end PCs first:
 * - Each object is simplified on its own, within `SIMPLIFY` meters (urns, within more).
 * - Materials are single-sided: `visibleFaces` already keeps both sides of thin things.
 * - Objects smaller than `CLUTTER` go in `Detail_` chunks that never collide and are skipped on
 *   Low.
 *
 * For play:
 * - Players wear blue and red, so red banners, orange trim and blue water are repainted. The
 *   source's banner emblem (a film franchise's seal) is left out: banners are plain cloth.
 * - The source stops at a bare slab edge: `WALLS` runs around it, with a gatehouse closing the
 *   open east end, and `Clip_Street` stands on the same line up to `CLIP_H`.
 * - Facades are ladders: sills and trims stand within a jump of each other, all the way up the
 *   palace. `noGoClips` stands clips on every thick footprint that rises past the terraces, so
 *   nobody climbs them, and everything behind the palace's front line is shut. Clips never stop
 *   bullets, so sight lines stay as they are.
 * - `COVER` breaks up the road, which is otherwise one 130 m sight line.
 * - The flags on poles hang down to the floor (their cloth was 1.2 m clear of it), as cover along
 *   the terraces that stops bullets.
 * - Small things on the floor go (`isLitter`, `withoutPosts`): posts, rods and lamps around the
 *   plazas and terraces that snag players, ankle-high stones along the road's edges, stubs, chips and raised drain tiles
 *   on the terraces.
 * - The map is played as a sniper duel along its length, so what only clutters a scope goes too:
 *   the 124 small conifers on the cross street's stairs, the 18 jets of its fountains (pale
 *   pillars up to 3.8 m, across the middle of every long shot), and the trios of thin dark stands
 *   along the top walks, where Red spawns.
 * - The terrace stairs are 7 cm risers by the dozen, and the step-up stalls a runner on every one.
 *   `stairRamps` lays a player-only ramp over each flight, so running up them glides; bullets
 *   and grenades still meet the real steps.
 *
 * Put the source's model.dae and its model/ folder in assets-raw/street/source.
 */

export const STREET_SCALE = 3.5;
const SRC = path.join(RAW, "street/source/model.dae");
/** Source meters: the point that becomes the origin, and the road's height, which becomes y = 0. */
const CENTER_X = 22.2, CENTER_Y = 12.5, ROAD = 0.427;
/** Half the map's long side, rounded up: the play area. */
export const STREET_HALF = 75;
/** Inner faces of the perimeter wall (m). */
const EDGE_X = 22.6, EDGE_Z = 73.2;
/** Chunk length along the avenue (m). The map splits in two along its middle as well. */
const CHUNK = 38;
/** Most a surface may move when simplified, in meters. */
const SIMPLIFY = 0.03, SIMPLIFY_ROUND = 0.07;
/** Objects smaller than this (bounding-box diagonal, m) are clutter. */
const CLUTTER = 0.5;
/** Air flood: cell size and the map's extent (m). */
const CELL = 0.15, TOP = 44;
/** Sight test for sides the flood misses: how far off the face a line starts (m), and how many cells away it may end. */
const SIGHT_LIFT = 0.01, SIGHT_CELLS = 3;

/** The figure SketchUp leaves in a new model. */
const SKIP = /^Susan$/;
/** The source's default paint, on any side no one painted. */
const UNPAINTED = "material";
/** Lathed in dozens of sides: urns and bowls. */
const ROUND = /^__Charcoal_$/;
/** The conifers on the cross street's stairs: left out. */
const PLANT = /^Vegetation_HoneyLocust$/;

type Slot = "stone" | "pavers" | "brick" | "paint";
/** How each source material is drawn: a slot, and a color (sRGB hex). */
const PAINT: Record<string, [Slot, string]> = {
  [UNPAINTED]: ["stone", "#8a8478"],
  Stone_Brushed_Khaki: ["stone", "#bcab95"],
  Stone_Brushed_Khaki_1: ["stone", "#bcab95"],
  __Stone_Brushed_Khaki_1: ["stone", "#8f8272"],
  Cladding_Stucco_White: ["stone", "#a9a496"],
  __Cladding_Stucco_White_1: ["stone", "#a5a39f"],
  __Brick_Pavers_Modular_1: ["pavers", "#b5a391"],
  __Brick_Pavers_Modular_2: ["pavers", "#a59380"],
  __Brick_Pavers_Modular_4: ["pavers", "#9f9085"],
  Brick_Pavers_Modular: ["pavers", "#847f75"],
  material_0: ["pavers", "#77746f"], // the road, near-white in the source
  Brick_Tumbled: ["brick", "#8e8a86"],
  __Brick_Pavers_Modular_3: ["paint", "#6c6564"], // roofs: no one is close enough to see a texture
  Translucent_Glass_Block_Dark: ["paint", "#46504f"],
  Brick_Rough_Dark: ["paint", "#3a3022"],
  Roofing_Shingles_Asphalt: ["paint", "#566159"],
  Metal_Embossed: ["paint", "#b2a397"],
  Metal_Corrogated_Shiny: ["paint", "#605c4a"],
  __Metal_Corrogated_Shiny_1: ["paint", "#9a9a9a"],
  black: ["paint", "#16181a"],
  __Charcoal_: ["paint", "#25262a"],
  Color_008: ["paint", "#1f2022"],
  Color_B24: ["paint", "#332420"],
  __LightGray_: ["paint", "#a8a1a0"],
  __Beige_1: ["paint", "#b89476"],
  __Color_004_2: ["paint", "#a8a8a8"],
  _96_96_96: ["paint", "#606060"],
  _0135_DarkGray: ["paint", "#525252"],
  material_1: ["paint", "#8a8478"],
  // Banners: red in the source, its emblem on the big ones.
  __Color_A01_1: ["paint", "#2f4a44"],
  Color_A01: ["paint", "#36544d"],
  __Color_004_1: ["paint", "#2f4a44"],
  Color_A23: ["paint", "#2f4a44"],
  jean_blue: ["paint", "#2f4a44"],
  Color_004: ["paint", "#b08f5a"], // their trim
  Water_Sparkling: ["paint", "#5f8484"],
  __Water_Sparkling_1: ["paint", "#b8bcc0"],
  Vegetation_HoneyLocust: ["paint", "#4d7a2a"],
  Vegetation_Grass1: ["paint", "#6f8f58"],
  Fencing_Picket_Concave: ["paint", "#c3bcab"],
  __Fencing_Picket_Concave_1: ["paint", "#65594f"],
};

/** Gray tile textures: source image, the tile's size in meters, and how much contrast to keep. */
const TEXTURES: Record<Exclude<Slot, "paint">, [string, number, number]> = {
  stone: ["model/Stone_Brushed_Khaki.jpg", 3, 1],
  pavers: ["model/__Brick_Pavers_Modular_1.jpg", 1.6, 1],
  brick: ["model/Brick_Tumbled.jpg", 1.4, 0.4], // near-black mortar: loud on a whole facade
};
/** The textures' mean brightness: vertex colors divide by it (linear), so tints land on target. */
const GRAY = 0.72;
const GRAY_LINEAR = ((GRAY + 0.055) / 1.055) ** 2.4;

const WALL_COLOR = "#a39b8d", WALL_H = 9, WALL_T = 1.2, CLIP_H = 44;
/** The palace's front line (m): the plinth, its porch and its open door are all behind it. */
const PLINTH_Z = -51.7;
/** Footprints whose top passes this height (m) are shut: the terraces top out at 2.5. */
const NO_GO_Y = 3.4;
/** Footprint cell (m), and how many cells of a footprint must stand on each side of a cell. */
const NO_GO_CELL = 0.5, NO_GO_THIN = 2;
/** Gatehouse: pier and lintel over the road, dark door between them. */
const GATE_H = 15, GATE_W = 7.5, PIER_W = 3.5;
const DOOR_COLOR = "#25262a", BANNER_COLOR = "#2f4a44", TRIM_COLOR = "#b08f5a";
/** Cover on the road: [x, z, size x, size z, height]. Low for a crouch, tall for a whole player. */
const COVER: [number, number, number, number, number][] = [
  // Tall pairs overlap across the road's center, so no straight line runs its length; the side
  // gaps stay wide enough to walk through.
  [-1.3, -14, 2.6, 1.2, 2.1], [1.3, -3, 2.6, 1.2, 2.1], [-1.3, 37, 2.6, 1.2, 2.1], [1.3, 47, 2.6, 1.2, 2.1],
  [1.6, -22, 2.4, 1.2, 1.15], [-1.6, 8, 2.4, 1.2, 1.15], [1.6, 14, 2.4, 1.2, 1.15], [-1.6, 56, 2.4, 1.2, 1.15], [1.6, 64, 2.4, 1.2, 1.15],
  // The mouth of the plaza.
  [-7, -31, 4, 0.9, 2.1], [7, -31, 4, 0.9, 2.1], [0, -36, 4, 0.9, 1.15],
  [-13, -44, 0.9, 4, 1.15], [13, -44, 0.9, 4, 1.15],
];
const COVER_COLOR = "#9a8f7f";
/** Floor litter, by paint: the road's edge stones, the terraces' stubs and chips, drain tiles, and the plaza's rods. */
const LITTER_LOW = /^(Stone_Brushed_Khaki|Color_008|__Color_004_2|Brick_Rough_Dark|__Color_A01_1)$/;
const DRAIN = /^Water_Sparkling$/;
const ROD = /^Brick_Rough_Dark$/;
/**
 * Posts and lamps, by paint: [paint, narrowest and widest across (m), lowest and highest (m)].
 * Dark rods, the white posts by the facades, the tall lamp posts, and the fountains' jets.
 */
const POSTS: [RegExp, number, number, number, number][] = [
  [/^Brick_Rough_Dark$/, 0, 0.12, 0.8, 1.5],
  [/^Cladding_Stucco_White$/, 0, 0.12, 1, 2],
  [/^__Brick_Pavers_Modular_1$/, 0, 0.3, 2, 3.5],
  [/^__Water_Sparkling_1$/, 0, 0.3, 1, 4], // the fountains' jets: pale pillars across the court
];
/**
 * Whole objects that go wherever they stand: the black urn lamps on their pedestals (wider than
 * the black fittings on the walls), and the tall dark poles before the palace.
 */
const LAMPS: [RegExp, number, number, number, number][] = [
  [/^(__Brick_Pavers_Modular_1|__Brick_Pavers_Modular_4|__Charcoal_)$/, 0.4, 0.8, 0.3, 1],
  [/^Brick_Rough_Dark$/, 0, 0.15, 3, 5.5],
  // Along the top walks: three 2 m stands in a row, and three short rods on a ledge. The palace's
  // balusters are shorter than the first and stay.
  [/^(__Charcoal_|__Beige_1)$/, 0.9, 1.2, 1.9, 2.1],
  [/^__Charcoal_$/, 0.9, 1, 0.5, 0.7],
];
/** Flags on poles: their cloth (source material), how thick the long flag is, and its gap to the floor (m). */
const CLOTH = /^__Color_A01_1$/;
const FLAG_T = 0.04, FLAG_GAP = 0.04;
/** How much wider the long flag is than the source's cloth; it grows away from its pole. */
const FLAG_WIDEN = 1.3;
/** Stair ramps: grid cell, how many cells a flight is read along each way, a riser's range (m). */
const RAMP_CELL = 0.1, RAMP_SPAN = 5, RISER_MIN = 0.02, RISER_MAX = 0.16;
/** Smoothing window (cells each way): the ramp is the average, over this window, of the floor's highest point over it again. */
const RAMP_SMOOTH = 5;
/** Most a ramp may move when simplified (m): flights are near-planar, so most of a grid merges. */
const RAMP_ERROR = 0.025;

type V3 = [number, number, number];
/** `back`: the far side of a sheet whose near side is kept too. */
interface Face { p: Float64Array; n: V3; material: string; object: number; back?: boolean }

interface Batch { pos: number[]; nrm: number[]; col: number[]; uv: number[] }
const newBatch = (): Batch => ({ pos: [], nrm: [], col: [], uv: [] });
type Tier = "solid" | "detail";

export async function importStreet() {
  await RAPIER.init();
  const scene = readDae(SRC);
  const raw = gameFaces(scene);
  const { faces, bothSided } = visibleFaces(raw);

  const batches = new Map<string, Partial<Record<Slot, Batch>>>();
  const batchFor = (piece: string, slot: Slot) => {
    let b = batches.get(piece);
    if (!b) batches.set(piece, (b = {}));
    return (b[slot] ??= newBatch());
  };
  /** Collision triangles by piece: one side of each sheet, as corners. */
  const solid = new Map<string, number[]>();
  const solidFor = (piece: string) => {
    let c = solid.get(piece);
    if (!c) solid.set(piece, (c = []));
    return c;
  };
  const chunkOf = (x: number, z: number) => `${x < 0 ? 0 : 1}_${Math.floor((z + 2 * CHUNK) / CHUNK)}`;

  // Sort objects into tiers, then simplify each object's paints on their own.
  const objects = new Map<number, Face[]>();
  for (const f of faces) {
    let list = objects.get(f.object);
    if (!list) objects.set(f.object, (list = []));
    list.push(f);
  }
  const bounds = objectBounds(raw);
  const flags = new Map<number, Billboard>();
  for (const [object, all] of objects) {
    const board = billboardOf(all, bounds.get(object)!);
    if (board) flags.set(object, board);
  }
  const billboards: Billboard[] = [];
  let drawn = 0, detail = 0;
  for (const [object, all] of objects) {
    const box = bounds.get(object)!;
    const board = flags.get(object);
    if (!board && isLitter(all, box)) continue;
    if (board) billboards.push(board);
    const list = withoutPosts(board ? all.filter((f) => !CLOTH.test(f.material)) : all);
    if (!list.length) continue;
    if (list.every((f) => PLANT.test(f.material))) continue;
    // The two sides of a sheet never meet in one call: welded together they make a closed shell
    // with no volume and no border, and the simplifier collapses it to nothing.
    const byPaint = new Map<string, Face[]>();
    for (const f of list) {
      const key = `${f.material}|${f.back ? 1 : 0}`;
      let group = byPaint.get(key);
      if (!group) byPaint.set(key, (group = []));
      group.push(f);
    }
    const size = Math.hypot(box[3] - box[0], box[4] - box[1], box[5] - box[2]);
    for (const group of byPaint.values()) {
      const { material, back } = group[0];
      const tier: Tier = size < CLUTTER ? "detail" : "solid";
      const prefix = tier === "detail" ? "Detail_Street" : "Street";
      const part = indexed(group);
      simplify(part, ROUND.test(material) ? SIMPLIFY_ROUND : SIMPLIFY);
      const [slot, hex] = PAINT[material];
      const color = tint(hex, slot);
      for (let t = 0; t < part.idx.length; t += 3) {
        const c = [0, 1, 2].map((k) => part.idx[t + k] * 3);
        const cx = (part.pos[c[0]] + part.pos[c[1]] + part.pos[c[2]]) / 3, cz = (part.pos[c[0] + 2] + part.pos[c[1] + 2] + part.pos[c[2] + 2]) / 3;
        const piece = `${prefix}_${chunkOf(cx, cz)}`;
        if (addTriangle(batchFor(piece, slot), slot, part.pos, c, color)) {
          drawn++;
          if (tier === "solid" && !back) solidFor(piece).push(...c.flatMap((i) => [part.pos[i], part.pos[i + 1], part.pos[i + 2]]));
          if (tier === "detail") detail++;
        }
      }
    }
  }

  // Walls, the gatehouse, cover and the flags.
  for (const box of [...wallBoxes(), ...gateBoxes(), ...coverBoxes()]) {
    const slot: Slot = box.slot ?? "stone";
    const piece = `Street_${chunkOf((box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2)}`;
    const b = batchFor(piece, slot), start = b.pos.length;
    addBox(b, slot, box, tint(box.color, slot));
    solidFor(piece).push(...b.pos.slice(start));
  }
  for (const board of billboards) {
    const piece = `Street_${chunkOf(board.x, board.z)}`, b = batchFor(piece, "paint"), start = b.pos.length;
    addPanel(b, board, board.halfW, FLAG_T / 2, board.y0 + FLAG_GAP, board.y1, tint(PAINT["__Color_A01_1"][1], "paint"));
    solidFor(piece).push(...b.pos.slice(start));
    drawn += (b.pos.length - start) / 9;
  }

  // Build the document: one node per piece, one primitive per slot.
  const out = new Document();
  const buffer = out.createBuffer();
  const materials = await slotMaterials(out);
  const scene2 = out.createScene("street");
  for (const name of [...batches.keys()].sort()) {
    const mesh = out.createMesh(name);
    for (const [slot, b] of Object.entries(batches.get(name)!) as [Slot, Batch][]) {
      const acc = (type: "VEC2" | "VEC3" | "VEC4", a: number[]) => out.createAccessor().setType(type).setArray(new Float32Array(a)).setBuffer(buffer);
      const prim = out.createPrimitive().setMaterial(materials[slot])
        .setAttribute("POSITION", acc("VEC3", b.pos)).setAttribute("NORMAL", acc("VEC3", b.nrm)).setAttribute("COLOR_0", acc("VEC4", b.col));
      if (slot !== "paint") prim.setAttribute("TEXCOORD_0", acc("VEC2", b.uv));
      mesh.addPrimitive(prim);
    }
    scene2.addChild(out.createNode(name).addChild(out.createNode(`${name}_mesh`).setMesh(mesh)));
  }
  await out.transform(weld());
  await compressTextures(out, 256);
  const bytes = await writeGLB(out, path.join(PUBLIC_MODELS, "street.glb"));

  // Collision from the kept surfaces, one side each: the two sides of a sheet would collapse.
  const collision = new Map<string, CollisionMesh | null>();
  const info: Record<string, PieceInfo> = {};
  for (const piece of scene2.listChildren()) info[piece.getName()] = pieceBounds(piece);
  for (const [name, corners] of solid) {
    const pos = new Float32Array(corners);
    const part = { pos, idx: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) };
    simplify(part, 0.01);
    collision.set(name, { positions: part.pos, indices: part.idx });
  }
  const surfaces = new Surfaces([...collision].filter(([, m]) => m).map(([, m]) => m!));
  const noGo = noGoClips(surfaces);
  const clips = perimeterClips(noGo);
  const world = await solidWorld(collision);
  const ramps = stairRamps(world, noGo);
  collision.set("Clip_Street", joinMeshes(boxesMesh(clips), ramps.mesh));
  const { ranges, positionsByteLength } = writeCollisionBin(path.join(PUBLIC_MODELS, "street.collision.bin"), collision);
  for (const [name, range] of ranges) (info[name] ??= boxBounds(clips)).col = range;

  const layout = playLayout(surfaces, noGo, capsuleCheck(world));
  writeJSON(path.join(GENERATED, "street-pieces.json"), { positionsByteLength, pieces: info, ...layout });

  let colTris = 0;
  for (const r of ranges.values()) colTris += r[3] / 3;
  console.log(`[street] ${(bytes / 1e6).toFixed(2)} MB glb, ${batches.size} pieces, ${raw.length} source tris, ${faces.length} visible (${bothSided} both sides), ${drawn} drawn (${detail} detail), ${colTris} collision tris, spawns ${layout.spawns.blue.length}/${layout.spawns.red.length}/${layout.spawns.ffa.length}, ${layout.footprints.length} footprints, ${billboards.length} billboards, ${ramps.flights} stair flights ramped (${ramps.mesh.indices.length / 3} tris)`);
}

/** Every source triangle in game space: X along the avenue becomes Z, Y across it X, Z up Y. */
function gameFaces(scene: DaeScene): Face[] {
  const U = scene.unit, S = STREET_SCALE;
  const objects = new Map<string, number>();
  const faces: Face[] = [];
  for (const m of scene.meshes) {
    if (m.path.some((n) => SKIP.test(n))) continue;
    const material = scene.materials.get(m.material)?.name ?? UNPAINTED;
    if (!PAINT[material]) throw new Error(`no paint for ${material}`);
    const key = m.path.join("/");
    let object = objects.get(key);
    if (object === undefined) objects.set(key, (object = objects.size));
    for (let i = 0; i < m.pos.length; i += 9) {
      const p = new Float64Array(9);
      for (let c = 0; c < 3; c++) {
        p[c * 3] = (m.pos[i + c * 3 + 1] * U - CENTER_Y) * S;
        p[c * 3 + 1] = (m.pos[i + c * 3 + 2] * U - ROAD) * S;
        p[c * 3 + 2] = (m.pos[i + c * 3] * U - CENTER_X) * S;
      }
      const n = faceNormal(p);
      // Slivers, and the slab under the road.
      if (n && Math.max(p[1], p[4], p[7]) > -0.05) faces.push({ p, n, material, object });
    }
  }
  return faces;
}

function faceNormal(p: Float64Array | number[]): V3 | null {
  const u = [p[3] - p[0], p[4] - p[1], p[5] - p[2]], v = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-7) return null;
  return [n[0] / len, n[1] / len, n[2] / len];
}

const flipped = (f: Face): Face => ({
  p: Float64Array.from([f.p[0], f.p[1], f.p[2], f.p[6], f.p[7], f.p[8], f.p[3], f.p[4], f.p[5]]),
  n: [-f.n[0], -f.n[1], -f.n[2]], material: f.material, object: f.object,
});

/**
 * The faces worth drawing. Twins (the same corners, any winding) are grouped; each direction of a
 * group is kept once if the outside air touches that side, painted with its own paint if it has
 * any and its twin's if not.
 */
function visibleFaces(faces: Face[]) {
  const air = outsideAir(faces);
  const key = ({ p }: Face) => [0, 3, 6].map((o) => `${Math.round(p[o] * 400)},${Math.round(p[o + 1] * 400)},${Math.round(p[o + 2] * 400)}`).sort().join("|");
  const twins = new Map<string, Face[]>();
  for (const f of faces) {
    const k = key(f);
    const list = twins.get(k);
    if (list) list.push(f);
    else twins.set(k, [f]);
  }
  const out: Face[] = [];
  let bothSided = 0;
  for (const group of twins.values()) {
    const a = group[0];
    const same = group.filter((f) => f.n[0] * a.n[0] + f.n[1] * a.n[1] + f.n[2] * a.n[2] > 0);
    const other = group.filter((f) => !same.includes(f));
    const painted = (list: Face[]) => list.find((f) => f.material !== UNPAINTED);
    const paint = painted(same)?.material ?? painted(other)?.material ?? UNPAINTED;
    const front = air(a), back = air(flipped(a));
    // A side with no face of its own (a lone face seen from behind) gets one.
    if (front) out.push({ ...a, material: painted(same)?.material ?? paint });
    if (back) {
      const b = other[0] ?? flipped(a);
      out.push({ ...b, material: painted(other)?.material ?? paint, back: front });
    }
    if (front && back) bothSided++;
  }
  return { faces: out, bothSided };
}

/**
 * Voxelizes the faces and floods the air from the sky. The result says whether a side of a face
 * touches that air, sampled across the face just off its surface.
 *
 * A stair's riser is half a cell tall, so the cell in front of it holds the tread below and never
 * floods: the flights lost about half their risers, in bands, and the sky showed through. A side
 * the grid calls buried is kept after all when a straight line runs from just off it to the
 * middle of a flooded cell nearby, with no face of the source in the way.
 */
function outsideAir(faces: Face[]) {
  const x0 = -EDGE_X - 1.5, z0 = -EDGE_Z - 1.5, y0 = -0.3;
  const nx = Math.ceil((2 * EDGE_X + 3) / CELL), nz = Math.ceil((2 * EDGE_Z + 3) / CELL), ny = Math.ceil((TOP - y0) / CELL);
  const cell = (x: number, y: number, z: number) => {
    const i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL), k = Math.floor((z - z0) / CELL);
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : (k * ny + j) * nx + i;
  };
  const SOLID = 1, AIR = 2;
  const grid = new Uint8Array(nx * ny * nz);

  /** Points across a face, close enough together to leave no gap at `step`. */
  const across = (p: Float64Array, step: number, visit: (x: number, y: number, z: number) => void) => {
    const edge = Math.max(Math.hypot(p[3] - p[0], p[4] - p[1], p[5] - p[2]), Math.hypot(p[6] - p[3], p[7] - p[4], p[8] - p[5]), Math.hypot(p[0] - p[6], p[1] - p[7], p[2] - p[8]));
    const n = Math.max(1, Math.ceil(edge / step));
    for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) {
      const u = a / n, v = b / n, w = 1 - u - v;
      visit(u * p[0] + v * p[3] + w * p[6], u * p[1] + v * p[4] + w * p[7], u * p[2] + v * p[5] + w * p[8]);
    }
  };
  for (const f of faces) across(f.p, CELL * 0.7, (x, y, z) => {
    const c = cell(x, y, z);
    if (c >= 0) grid[c] = SOLID;
  });

  const stack = new Int32Array(nx * ny * nz);
  let top = 0;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = (k * ny + (ny - 1)) * nx + i;
    if (!grid[c]) { grid[c] = AIR; stack[top++] = c; }
  }
  const row = nx, layer = nx * ny;
  while (top) {
    const c = stack[--top];
    const i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / layer);
    if (i > 0 && !grid[c - 1]) { grid[c - 1] = AIR; stack[top++] = c - 1; }
    if (i < nx - 1 && !grid[c + 1]) { grid[c + 1] = AIR; stack[top++] = c + 1; }
    if (j > 0 && !grid[c - row]) { grid[c - row] = AIR; stack[top++] = c - row; }
    if (j < ny - 1 && !grid[c + row]) { grid[c + row] = AIR; stack[top++] = c + row; }
    if (k > 0 && !grid[c - layer]) { grid[c - layer] = AIR; stack[top++] = c - layer; }
    if (k < nz - 1 && !grid[c + layer]) { grid[c + layer] = AIR; stack[top++] = c + layer; }
  }

  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const corners = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => corners.set(f.p, i * 9));
  world.createCollider(RAPIER.ColliderDesc.trimesh(corners, Uint32Array.from({ length: faces.length * 3 }, (_, i) => i)));
  world.step();
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  /** From the face's middle and from near each corner, to the flooded cells within `SIGHT_CELLS`. */
  const inSight = ({ p, n }: Face) => {
    const mid = [(p[0] + p[3] + p[6]) / 3, (p[1] + p[4] + p[7]) / 3, (p[2] + p[5] + p[8]) / 3];
    for (let s = 0; s < 4; s++) {
      const o = [0, 1, 2].map((d) => (s === 3 ? mid[d] : mid[d] + (p[s * 3 + d] - mid[d]) * 0.7) + n[d] * SIGHT_LIFT);
      const i0 = Math.floor((o[0] - x0) / CELL), j0 = Math.floor((o[1] - y0) / CELL), k0 = Math.floor((o[2] - z0) / CELL);
      ray.origin = { x: o[0], y: o[1], z: o[2] };
      for (let k = k0 - SIGHT_CELLS; k <= k0 + SIGHT_CELLS; k++) for (let j = j0 - SIGHT_CELLS; j <= j0 + SIGHT_CELLS; j++) for (let i = i0 - SIGHT_CELLS; i <= i0 + SIGHT_CELLS; i++) {
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz || grid[(k * ny + j) * nx + i] !== AIR) continue;
        const d = [x0 + (i + 0.5) * CELL - o[0], y0 + (j + 0.5) * CELL - o[1], z0 + (k + 0.5) * CELL - o[2]];
        const len = Math.hypot(d[0], d[1], d[2]);
        // Only out of the side asked about, and not along its own surface.
        if ((d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) / len < 0.2) continue;
        ray.dir = { x: d[0] / len, y: d[1] / len, z: d[2] / len };
        if (!world.castRay(ray, len, false)) return true;
      }
    }
    return false;
  };

  const reach = CELL * 1.6;
  return ({ p, n }: Face) => {
    let touches = false;
    across(p, 0.6, (x, y, z) => {
      if (touches) return;
      const c = cell(x + n[0] * reach, y + n[1] * reach, z + n[2] * reach);
      if (c < 0 || grid[c] === AIR) touches = true;
    });
    return touches || inSight({ p, n } as Face);
  };
}

/** Each object's bounding box (min x, y, z, max x, y, z), from all of its faces. */
function objectBounds(faces: Face[]) {
  const box = new Map<number, number[]>();
  for (const { p, object } of faces) {
    let b = box.get(object);
    if (!b) box.set(object, (b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]));
    for (let i = 0; i < 9; i++) {
      const k = i % 3;
      b[k] = Math.min(b[k], p[i]);
      b[k + 3] = Math.max(b[k + 3], p[i]);
    }
  }
  return box;
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLinear = (hex: string): V3 => [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as V3;

/**
 * Fewer triangles within `error` meters, in place. Corners are welded by position first, or every
 * edge is a border and nothing can collapse. Open borders stay put, so faces keep their outlines.
 */
function simplify(part: { pos: Float32Array; idx: Uint32Array }, error: number) {
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
  // Only the corners the simplified triangles still use: the rest would ship in the collision file.
  const remapUsed = new Int32Array(positions.length / 3).fill(-1), used: number[] = [];
  part.idx = out.map((i) => {
    if (remapUsed[i] < 0) { remapUsed[i] = used.length / 3; used.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); }
    return remapUsed[i];
  });
  part.pos = new Float32Array(used);
}

/** Faces as a triangle list, for `simplify`. */
function indexed(faces: Face[]) {
  const pos = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => pos.set(f.p, i * 9));
  return { pos, idx: Uint32Array.from({ length: faces.length * 3 }, (_, i) => i) };
}

/** A paint as a vertex color: tinted textures divide by the texture's mean. */
function tint(hex: string, slot: Slot): V3 {
  const c = hexLinear(hex);
  return slot === "paint" ? c : [Math.min(1, c[0] / GRAY_LINEAR), Math.min(1, c[1] / GRAY_LINEAR), Math.min(1, c[2] / GRAY_LINEAR)];
}

/** UVs from world space, on the plane the normal points out of most. */
function planarUV(slot: Slot, n: V3, x: number, y: number, z: number): [number, number] {
  if (slot === "paint") return [0, 0];
  const tile = TEXTURES[slot][1];
  const [ax, ay, az] = n.map(Math.abs);
  if (ay >= ax && ay >= az) return [x / tile, z / tile];
  return ax >= az ? [z / tile, y / tile] : [x / tile, y / tile];
}

/** Appends one triangle with a flat normal; false when it has collapsed. */
function addTriangle(b: Batch, slot: Slot, pos: Float32Array, c: number[], color: V3) {
  const p = [c[0], c[1], c[2]].flatMap((i) => [pos[i], pos[i + 1], pos[i + 2]]);
  const n = faceNormal(p);
  if (!n) return false;
  for (let k = 0; k < 9; k += 3) {
    b.pos.push(p[k], p[k + 1], p[k + 2]);
    b.nrm.push(...n);
    b.col.push(color[0], color[1], color[2], 1);
    if (slot !== "paint") b.uv.push(...planarUV(slot, n, p[k], p[k + 1], p[k + 2]));
  }
  return true;
}

/** The three gray textures and the paint. */
async function slotMaterials(doc: Document): Promise<Record<Slot, Material>> {
  const material = (name: string) => doc.createMaterial(name).setMetallicFactor(0).setRoughnessFactor(0.9);
  const texture = async (slot: Exclude<Slot, "paint">): Promise<Texture> => {
    const [image, , contrast] = TEXTURES[slot];
    const gray = sharp(path.join(path.dirname(SRC), image)).removeAlpha().greyscale();
    const mean = (await gray.clone().stats()).channels[0].mean / 255;
    const png = await gray.linear((GRAY / mean) * contrast, 255 * GRAY * (1 - contrast)).png().toBuffer();
    return doc.createTexture(slot).setImage(new Uint8Array(png)).setMimeType("image/png");
  };
  return {
    stone: material("Street_Stone").setBaseColorTexture(await texture("stone")),
    pavers: material("Street_Pavers").setBaseColorTexture(await texture("pavers")),
    brick: material("Street_Brick").setBaseColorTexture(await texture("brick")),
    paint: material("Street_Paint"),
  };
}

interface Block { x0: number; x1: number; z0: number; z1: number; y0?: number; y1: number; color: string; slot?: Slot }

/** The perimeter, just outside the source's slab. */
function wallBoxes(): Block[] {
  const T = WALL_T, X = EDGE_X, Z = EDGE_Z, y1 = WALL_H, color = WALL_COLOR;
  return [
    { x0: -X - T, x1: -X, z0: -Z - T, z1: Z + T, y1, color },
    { x0: X, x1: X + T, z0: -Z - T, z1: Z + T, y1, color },
    { x0: -X, x1: X, z0: -Z - T, z1: -Z, y1, color },
    { x0: -X, x1: -GATE_W, z0: Z, z1: Z + T, y1, color },
    { x0: GATE_W, x1: X, z0: Z, z1: Z + T, y1, color },
  ];
}

/** The east end: two piers and a lintel across the road, a shut door between them. */
function gateBoxes(): Block[] {
  const Z = EDGE_Z, W = GATE_W, P = PIER_W, T = WALL_T;
  return [
    { x0: -W - P, x1: -W, z0: Z - 1.2, z1: Z + T, y1: GATE_H, color: WALL_COLOR },
    { x0: W, x1: W + P, z0: Z - 1.2, z1: Z + T, y1: GATE_H, color: WALL_COLOR },
    { x0: -W, x1: W, z0: Z - 0.6, z1: Z + T, y0: WALL_H, y1: GATE_H, color: WALL_COLOR },
    { x0: -W, x1: W, z0: Z, z1: Z + T, y1: WALL_H, color: DOOR_COLOR, slot: "paint" },
    // A cap over the lintel, and a banner on the face of each pier.
    { x0: -W - P - 0.4, x1: W + P + 0.4, z0: Z - 1.6, z1: Z + T, y0: GATE_H, y1: GATE_H + 0.7, color: WALL_COLOR },
    ...[-1, 1].flatMap((side): Block[] => {
      const x = side * (W + P / 2);
      return [
        { x0: x - 1.25, x1: x + 1.25, z0: Z - 1.32, z1: Z - 1.2, y0: 3, y1: 13.2, color: TRIM_COLOR, slot: "paint" },
        { x0: x - 1.1, x1: x + 1.1, z0: Z - 1.36, z1: Z - 1.32, y0: 3.15, y1: 13.05, color: BANNER_COLOR, slot: "paint" },
      ];
    }),
  ];
}

function coverBoxes(): Block[] {
  return COVER.map(([x, z, sx, sz, h]) => ({ x0: x - sx / 2, x1: x + sx / 2, z0: z - sz / 2, z1: z + sz / 2, y1: h, color: COVER_COLOR }));
}

/**
 * Small things on the floor that only trip players up: anything in `LITTER_LOW`'s paints under
 * 0.4 m tall and 1 m across, raised drain tiles, and the rows of rods (under 1.5 m, from the
 * ground) in the plaza.
 */
function isLitter(faces: Face[], box: number[]) {
  const h = box[4] - box[1], across = Math.max(box[3] - box[0], box[5] - box[2]), thin = Math.min(box[3] - box[0], box[5] - box[2]);
  if (faces.every((f) => ROD.test(f.material))) return box[1] < 0.05 && h < 1.5 && thin < 0.1;
  if (faces.some((f) => DRAIN.test(f.material))) return h < 0.1 && across < 1;
  return h > 0.02 && h < 0.4 && across < 1 && faces.every((f) => LITTER_LOW.test(f.material));
}

/**
 * An object's faces without its posts and lamps (`POSTS`): dark rods knee-to-waist high in rows
 * around the statue court, the plaza mouth and the terraces, white posts, lamp posts and urn
 * lamps, all catching players running by. Each is a piece of its object in one paint, sharing
 * no corner with the rest of that paint: a post often stands on corners of the stone below it.
 */
function withoutPosts(faces: Face[]): Face[] {
  const isPost = (list: number[], rules = POSTS, anywhere = false) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const i of list) for (let k = 0; k < 9; k += 3) for (let d = 0; d < 3; d++) {
      b[d] = Math.min(b[d], faces[i].p[k + d]);
      b[d + 3] = Math.max(b[d + 3], faces[i].p[k + d]);
    }
    const h = b[4] - b[1], across = Math.max(b[3] - b[0], b[5] - b[2]);
    // Only where players go: on the floors, in front of the palace (its balusters stay).
    if (b[1] > MAX_FLOOR + 0.3 || (!anywhere && (b[2] + b[5]) / 2 < PLINTH_Z)) return false;
    return rules.some(([paint, narrow, wide, low, high]) => across > narrow && across < wide && h > low && h < high && list.every((i) => paint.test(faces[i].material)));
  };
  // An urn lamp is in parts (bowl, stem, pedestal), so it goes whole.
  if (isPost(faces.map((_, i) => i), LAMPS, true)) return [];
  if (!faces.some((f) => POSTS.some(([paint]) => paint.test(f.material)))) return faces;
  const parent = faces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const corner = new Map<string, number>();
  faces.forEach((f, i) => {
    for (let k = 0; k < 9; k += 3) {
      const key = `${f.material}|${f.p[k].toFixed(3)},${f.p[k + 1].toFixed(3)},${f.p[k + 2].toFixed(3)}`;
      const j = corner.get(key);
      if (j === undefined) corner.set(key, i);
      else parent[find(i)] = find(j);
    }
  });
  const pieces = new Map<number, number[]>();
  faces.forEach((_, i) => {
    const r = find(i);
    let list = pieces.get(r);
    if (!list) pieces.set(r, (list = []));
    list.push(i);
  });
  const drop = new Set<number>();
  for (const list of pieces.values()) if (isPost(list)) for (const i of list) drop.add(i);
  return drop.size ? faces.filter((_, i) => !drop.has(i)) : faces;
}

/** A long flag: its center, the way its face points, half its width, and its height. */
interface Billboard { x: number; z: number; nx: number; nz: number; halfW: number; y0: number; y1: number }

/** A flag on a pole: a small upright object with cloth in it. The long flag hangs where the cloth did, a little wider. */
function billboardOf(faces: Face[], box: number[]): Billboard | null {
  const cloth = faces.filter((f) => CLOTH.test(f.material));
  const h = box[4] - box[1], footprint = Math.hypot(box[3] - box[0], box[5] - box[2]);
  if (!cloth.length || h < 2 || h > 3.2 || footprint > 1) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = -Infinity, nx = 0, nz = 0;
  for (const f of cloth) {
    for (let k = 0; k < 9; k += 3) {
      x0 = Math.min(x0, f.p[k]); x1 = Math.max(x1, f.p[k]);
      z0 = Math.min(z0, f.p[k + 2]); z1 = Math.max(z1, f.p[k + 2]);
      y1 = Math.max(y1, f.p[k + 1]);
    }
    // The cloth's two sides point opposite ways: line them up before summing.
    const s = nx === 0 && nz === 0 ? 1 : f.n[0] * nx + f.n[2] * nz >= 0 ? 1 : -1;
    nx += f.n[0] * s; nz += f.n[2] * s;
  }
  const len = Math.hypot(nx, nz) || 1;
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2, ux = -nz / len, uz = nx / len;
  let halfW = 0, pole = 0, n = 0;
  for (const f of cloth) for (let k = 0; k < 9; k += 3) halfW = Math.max(halfW, Math.abs((f.p[k] - x) * ux + (f.p[k + 2] - z) * uz));
  for (const f of faces) if (!CLOTH.test(f.material)) for (let k = 0; k < 9; k += 3) { pole += (f.p[k] - x) * ux + (f.p[k + 2] - z) * uz; n++; }
  // Keep the edge on the pole and let the other one out.
  const grow = halfW * (FLAG_WIDEN - 1), away = n && pole < 0 ? 1 : -1;
  return { x: x + ux * grow * away, z: z + uz * grow * away, nx: nx / len, nz: nz / len, halfW: halfW + grow, y0: box[1], y1 };
}

/** An upright panel on a billboard's line: `halfW` across its face, `halfT` through it. */
function addPanel(b: Batch, { x, z, nx, nz }: Billboard, halfW: number, halfT: number, y0: number, y1: number, color: V3) {
  const ux = -nz, uz = nx;
  const at = (w: number, t: number, y: number): V3 => [x + ux * w * halfW + nx * t * halfT, y, z + uz * w * halfW + nz * t * halfT];
  const quads: V3[][] = [
    [at(-1, -1, y1), at(-1, 1, y1), at(1, 1, y1), at(1, -1, y1)],
    [at(-1, 1, y0), at(1, 1, y0), at(1, 1, y1), at(-1, 1, y1)],
    [at(1, -1, y0), at(-1, -1, y0), at(-1, -1, y1), at(1, -1, y1)],
    [at(1, 1, y0), at(1, -1, y0), at(1, -1, y1), at(1, 1, y1)],
    [at(-1, -1, y0), at(-1, 1, y0), at(-1, 1, y1), at(-1, -1, y1)],
  ];
  for (const [p0, p1, p2, p3] of quads) for (const tri of [[p0, p1, p2], [p0, p2, p3]]) {
    // Whichever way the corners wind, face outward from the panel's middle.
    let n = faceNormal(tri.flat());
    if (!n) continue;
    const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3 - x, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3 - (y0 + y1) / 2, cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3 - z;
    let corners = tri;
    if (n[0] * cx + n[1] * cy + n[2] * cz < 0) { corners = [tri[0], tri[2], tri[1]]; n = [-n[0], -n[1], -n[2]]; }
    for (const p of corners) {
      b.pos.push(...p);
      b.nrm.push(...n);
      b.col.push(color[0], color[1], color[2], 1);
    }
  }
}

/** An upright box, flat shaded (the ground closes the bottom). */
function addBox(b: Batch, slot: Slot, { x0, x1, z0, z1, y0 = 0, y1 }: Block, color: V3) {
  const faces: [V3, V3, V3, V3, V3][] = [
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]],
    [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
    [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1]],
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]],
  ];
  if (y0 > 0) faces.push([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]]);
  for (const [p0, p1, p2, p3, n] of faces) for (const p of [p0, p1, p2, p0, p2, p3]) {
    b.pos.push(...p);
    b.nrm.push(...n);
    b.col.push(color[0], color[1], color[2], 1);
    if (slot !== "paint") b.uv.push(...planarUV(slot, n, p[0], p[1], p[2]));
  }
}

interface Rect { x0: number; x1: number; z0: number; z1: number }

/**
 * Where players may not go: the palace, and every footprint that rises past `NO_GO_Y`. Opened
 * (eroded, then grown back) so that posts, banners and obelisks stay free-standing.
 */
function noGoClips(surfaces: Surfaces): Rect[] {
  const H = STREET_HALF, C = NO_GO_CELL, N = (2 * H) / C, R = NO_GO_THIN;
  const tall = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) * C - H, z = (j + 0.5) * C - H;
    // Past the walls counts as solid, so a footprint against the wall is thick however narrow.
    const inside = Math.abs(x) < EDGE_X && Math.abs(z) < EDGE_Z;
    tall[j * N + i] = !inside || Math.max(...surfaces.at(x, z)) > NO_GO_Y ? 1 : 0;
  }
  /** Each cell from its neighborhood: all set (`every`) erodes, any set grows. */
  const pass = (src: Uint8Array, every: boolean) => {
    const out = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let hits = 0;
      for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) hits += src[Math.min(N - 1, Math.max(0, j + b)) * N + Math.min(N - 1, Math.max(0, i + a))];
      out[j * N + i] = every ? +(hits === (2 * R + 1) ** 2) : +(hits > 0);
    }
    return out;
  };
  const opened = pass(pass(tall, true), false);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (Math.abs((i + 0.5) * C - H) >= EDGE_X || Math.abs((j + 0.5) * C - H) >= EDGE_Z) opened[j * N + i] = 0;
  }
  const rects = rectangles(Float32Array.from(opened), N, 1).map((r) => ({ x0: r.x * C - H, x1: (r.x + r.sx) * C - H, z0: r.z * C - H, z1: (r.z + r.sz) * C - H }));
  return [{ x0: -EDGE_X, x1: EDGE_X, z0: -EDGE_Z, z1: PLINTH_Z }, ...rects];
}

/** On the line of the walls and over `noGo`, from below the floor to well above the roofs. */
function perimeterClips(noGo: Rect[]): Box[] {
  return [...wallBoxes(), { x0: -GATE_W, x1: GATE_W, z0: EDGE_Z, z1: EDGE_Z + WALL_T }, ...noGo]
    .map(({ x0, x1, z0, z1 }): Box => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [k & 1 ? x1 : x0, k & 4 ? CLIP_H : -1, k & 2 ? z1 : z0] as V3));
}

/** The solid collision in the physics the game itself uses, for the importer's own queries. */
async function solidWorld(collision: Map<string, CollisionMesh | null>) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  for (const [name, m] of collision) if (m && !name.startsWith("Clip_")) world.createCollider(RAPIER.ColliderDesc.trimesh(m.positions, m.indices));
  world.step();
  return world;
}

/**
 * Whether a player's capsule fits at a spot: the fins and rods along the terraces are thin
 * enough for any sampling to miss.
 */
function capsuleCheck(world: RAPIER.World) {
  const radius = PLAYER_RADIUS + ROOM, capsule = new RAPIER.Capsule(PLAYER_HEIGHT / 2 - radius, radius);
  return (x: number, z: number, floor: number) =>
    !world.intersectionWithShape({ x, y: floor + 0.15 + PLAYER_HEIGHT / 2, z }, { x: 0, y: 0, z: 0, w: 1 }, capsule);
}

function joinMeshes(a: CollisionMesh, b: CollisionMesh): CollisionMesh {
  const base = a.positions.length / 3;
  return { positions: Float32Array.from([...a.positions, ...b.positions]), indices: Uint32Array.from([...a.indices, ...Array.from(b.indices, (i) => i + base)]) };
}

/**
 * Player-only ramps over the stair flights. The floor is read on a fine grid; a cell is on a
 * flight when, along x or along z, it climbs through at least three small risers and no wall.
 * Each flight's cells, and a rim onto its landings, take the average of the floor's local highest
 * point, which sits on the nosings and meets the landings at the rim's outer edge.
 */
function stairRamps(world: RAPIER.World, noGo: Rect[]): { mesh: CollisionMesh; flights: number } {
  const C = RAMP_CELL, X0 = -EDGE_X, Z0 = PLINTH_Z;
  const nx = Math.round((2 * EDGE_X) / C), nz = Math.round((EDGE_Z - PLINTH_Z) / C);
  const idx = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i);
  const h = new Float32Array(nx * nz).fill(NaN);
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = X0 + (i + 0.5) * C, z = Z0 + (j + 0.5) * C;
    if (noGo.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) continue;
    ray.origin = { x, y: MAX_FLOOR + 0.3, z };
    const hit = world.castRay(ray, MAX_FLOOR + 1, true);
    if (hit) h[j * nx + i] = MAX_FLOOR + 0.3 - hit.timeOfImpact;
  }
  const at = (i: number, j: number) => { const k = idx(i, j); return k < 0 ? NaN : h[k]; };
  const climbs = (i: number, j: number, di: number, dj: number) => {
    let rises = 0, prev = at(i - RAMP_SPAN * di, j - RAMP_SPAN * dj);
    for (let k = -RAMP_SPAN + 1; k <= RAMP_SPAN; k++) {
      const cur = at(i + k * di, j + k * dj), d = Math.abs(cur - prev);
      if (!(d < RISER_MAX)) return false; // a wall, or no floor
      if (d > RISER_MIN) rises++;
      prev = cur;
    }
    return rises >= 3;
  };
  // Flights, each with its own label, and the axis each cell climbs along (1: x, 2: z).
  const label = new Int32Array(nx * nz).fill(-1);
  const core = new Uint8Array(nx * nz), axis = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    axis[k] = climbs(i, j, 1, 0) ? 1 : climbs(i, j, 0, 1) ? 2 : 0;
    core[k] = axis[k] ? 1 : 0;
  }
  let flights = 0;
  for (let k = 0; k < core.length; k++) {
    if (!core[k] || label[k] >= 0) continue;
    const cells = [k];
    label[k] = flights;
    for (let q = 0; q < cells.length; q++) {
      const c = cells[q], i = c % nx, j = (c - i) / nx;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = idx(i + a, j + b);
        if (n >= 0 && core[n] && label[n] < 0) { label[n] = flights; cells.push(n); }
      }
    }
    if (cells.length < 40) for (const c of cells) { label[c] = -1; core[c] = 0; } // a lone curb
    else flights++;
  }
  // The rim: a few cells onto the landings, each within a riser of the cell it grows from.
  // Past twice the window, the ramp meets the floor, so it ends without a ledge.
  const RIM = 2 * RAMP_SMOOTH + 1, ring = new Uint8Array(nx * nz);
  for (let step = 1; step <= RIM; step++) {
    const add: [number, number][] = [];
    for (let k = 0; k < label.length; k++) {
      if (label[k] >= 0 || Number.isNaN(h[k])) continue;
      const i = k % nx, j = (k - i) / nx;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = idx(i + a, j + b);
        if (n >= 0 && label[n] >= 0 && (core[n] || ring[n] === step - 1) && Math.abs(h[n] - h[k]) < RISER_MAX) { add.push([k, n]); break; }
      }
    }
    for (const [k, n] of add) { label[k] = label[n]; axis[k] = axis[n]; ring[k] = step; }
  }
  // The ramp's height, along the way the flight climbs only: averaged across as well, a wall or
  // billboard beside a flight would tilt the ramp toward it, and a runner wedged between the two
  // stops dead. The floor's highest point near each cell, averaged near it again, never dips
  // under a nosing, and rolls over a short landing between two flights instead of sagging onto
  // it, so a runner rises at an even rate.
  const ramp = new Float32Array(nx * nz).fill(NaN);
  const R = RAMP_SMOOTH, NEAR = 0.35;
  for (let k = 0; k < label.length; k++) {
    if (label[k] < 0) continue;
    const i = k % nx, j = (k - i) / nx, [di, dj] = axis[k] === 2 ? [0, 1] : [1, 0];
    const line: number[] = [];
    for (let a = -2 * R; a <= 2 * R; a++) {
      const v = at(i + a * di, j + a * dj);
      line.push(Math.abs(v - h[k]) < NEAR ? v : NaN);
    }
    let sum = 0, n = 0;
    for (let a = 0; a <= 2 * R; a++) {
      let top = -Infinity;
      for (let b = a; b <= a + 2 * R; b++) if (line[b] > top) top = line[b];
      if (top > -Infinity) { sum += top; n++; }
    }
    ramp[k] = Math.max(h[k], sum / n);
  }

  const pos: number[] = [], tri: number[] = [];
  const vertex = new Int32Array(nx * nz).fill(-1);
  const v = (k: number) => {
    if (vertex[k] < 0) {
      const i = k % nx, j = (k - i) / nx;
      vertex[k] = pos.length / 3;
      pos.push(X0 + (i + 0.5) * C, ramp[k], Z0 + (j + 0.5) * C);
    }
    return vertex[k];
  };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    if (label[a] < 0 || label[b] < 0 || label[c] < 0 || label[d] < 0) continue;
    tri.push(v(a), v(c), v(b), v(b), v(c), v(d)); // counterclockwise from above
  }
  const part = { pos: new Float32Array(pos), idx: new Uint32Array(tri) };
  if (tri.length) simplify(part, RAMP_ERROR);
  return { mesh: { positions: part.pos, indices: part.idx }, flights };
}

type Spawn = [number, number, number];
const EYE = 1.62;
/** The floors a player spawns on stop here: above it are roofs. */
const MAX_FLOOR = 3;
const round = (v: number) => Math.round(v * 100) / 100;
/** How close cover has to stand to a spawn (m). */
const COVER_REACH = 3.5;
/** Room a spawn needs around a player's capsule (m). */
const ROOM = 0.05;
/** A free-for-all spawn has cover at this height, along this many of 12 directions. */
const FFA_COVER_Y = 1.2, FFA_COVER_DIRS = 3;

/** Spawns placed on the real collision, and obstacle footprints for the minimap. */
function playLayout(surfaces: Surfaces, noGo: Rect[], roomy: (x: number, z: number, floor: number) => boolean) {
  const dirs = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);
  /** Open spots in a band of z, on whichever floor is there, with cover around them. */
  const zone = (z0: number, z1: number, y: number, needed: number): Spawn[] => {
    const spots: Spawn[] = [];
    for (let x = -21; x <= 21; x += 1) for (let z = z0; z <= z1; z += 1) {
      if (noGo.some((r) => x > r.x0 - 1 && x < r.x1 + 1 && z > r.z0 - 1 && z < r.z1 + 1)) continue;
      const floor = surfaces.floor(x, z, MAX_FLOOR);
      if (!surfaces.clear(x, z, floor) || !roomy(x, z, floor)) continue;
      if (dirs.filter((a) => surfaces.shielded(x, z, floor + y, a, COVER_REACH)).length >= needed) spots.push([x, round(floor), z]);
    }
    return spots;
  };
  let blue = spread(zone(-52, -30, EYE, 2), 60, [0, 0, -52]);
  let red = spread(zone(48, 72, EYE, 2), 60, [0, 0, 72]);
  // Drop the spots that see the other team's, worst first, until no pair sees each other.
  // At the height a spawned player really stands (map data lifts spawns 0.1 m), with a margin.
  const eye = ([x, y, z]: Spawn, lift: number): V3 => [x, y + 0.1 + EYE + lift, z];
  const sees = blue.map((b) => red.map((r) => [-0.2, 0, 0.2].some((lift) => surfaces.sees(eye(b, lift), eye(r, lift)))));
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
  const ffa = zone(-50, 70, FFA_COVER_Y, FFA_COVER_DIRS);

  // Footprints: 1 m cells whose top stands over head height above the terraces, merged.
  const H = STREET_HALF, N = H * 2;
  const tall = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = i - H + 0.5, z = j - H + 0.5;
    if (Math.abs(x) < EDGE_X && Math.abs(z) < EDGE_Z) tall[j * N + i] = Math.max(...surfaces.at(x, z)) > 4.2 ? 1 : 0;
  }
  return {
    spawns: { blue: spread(blue, 10, [0, 0, -52]), red: spread(red, 10, [0, 0, 72]), ffa: spread(ffa, 16, [0, 0, 0]) },
    floor: { x: -EDGE_X, z: -EDGE_Z, sx: EDGE_X * 2, sz: EDGE_Z * 2 },
    footprints: rectangles(tall, N, 3).map((r) => ({ x: r.x - H, z: r.z - H, sx: r.sx, sz: r.sz })),
  };
}
