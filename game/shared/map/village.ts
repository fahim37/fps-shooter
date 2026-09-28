import type { MapData, PlacedPiece, SpawnPoint } from "./types";
import { buildHouse, type HouseSpec } from "./house";
import { rng } from "../rng";

/**
 * "Hollowmere" — the village map. Deterministic: the server and every client call
 * buildVillage() and get identical pieces, spawns and collision.
 *
 * World axes: +X east, +Z south (N = -Z). Plaza at the origin, two roads crossing it.
 */

export const MAP_HALF = 46; // playable area is |x|, |z| <= MAP_HALF
const PLAZA = 12;
const ROAD = 3;

const HOUSES: HouseSpec[] = [
  // Around the plaza, fronts facing it.
  { x: -11, z: -22, sx: 6, sz: 8, front: "S", floors: 2, doors: [["F", 1], ["B", 1]], balconies: [[1, 2]], seed: 11, chimney: true },
  { x: 5, z: -24, sx: 6, sz: 10, front: "S", floors: 3, doors: [["F", 1], ["R", 2]], balconies: [[1, 1], [2, 2]], seed: 12 },
  { x: -11, z: 14, sx: 6, sz: 8, front: "N", floors: 2, doors: [["F", 2], ["R", 1]], seed: 13, chimney: true },
  { x: 5, z: 14, sx: 4, sz: 6, front: "N", floors: 4, stone: 4, doors: [["F", 1], ["B", 1]], seed: 14, empty: true },
  { x: -22, z: -11, sx: 8, sz: 6, front: "E", floors: 2, doors: [["F", 1], ["R", 1]], balconies: [[1, 2]], seed: 15 },
  { x: -20, z: 5, sx: 6, sz: 6, front: "E", floors: 2, doors: [["F", 2], ["B", 1]], seed: 16, chimney: true },
  { x: 14, z: -11, sx: 8, sz: 6, front: "W", floors: 3, stone: 2, doors: [["F", 1], ["R", 2]], balconies: [[2, 1]], seed: 17 },
  { x: 14, z: 5, sx: 6, sz: 6, front: "W", floors: 2, doors: [["F", 1], ["B", 1]], seed: 18 },
  // Along the east-west road.
  { x: -34, z: -13, sx: 6, sz: 8, front: "S", floors: 2, doors: [["F", 1], ["R", 1]], seed: 21, chimney: true },
  { x: -34, z: 5, sx: 6, sz: 8, front: "N", floors: 3, doors: [["F", 2], ["B", 1]], balconies: [[1, 1]], seed: 22 },
  { x: 28, z: -13, sx: 6, sz: 8, front: "S", floors: 2, doors: [["F", 2], ["B", 2]], balconies: [[1, 1]], seed: 23 },
  { x: 28, z: 5, sx: 8, sz: 8, front: "N", floors: 2, doors: [["F", 2], ["R", 2]], seed: 24, chimney: true },
  // Along the north-south road.
  { x: -13, z: -36, sx: 8, sz: 6, front: "E", floors: 2, doors: [["F", 1], ["B", 2]], seed: 31, chimney: true },
  { x: 5, z: -36, sx: 8, sz: 8, front: "W", floors: 3, stone: 2, doors: [["F", 2], ["R", 1]], balconies: [[2, 2]], seed: 32 },
  { x: -13, z: 28, sx: 8, sz: 6, front: "E", floors: 2, doors: [["F", 1], ["R", 1]], seed: 33 },
  { x: 5, z: 28, sx: 8, sz: 8, front: "W", floors: 2, doors: [["F", 1], ["B", 2]], balconies: [[1, 2]], seed: 34, chimney: true },
];

type Rect = [number, number, number, number]; // x0, z0, x1, z1

function inRects(x: number, z: number, rects: Rect[], pad = 0) {
  return rects.some(([x0, z0, x1, z1]) => x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad);
}

export function buildVillage(): MapData {
  const r = rng(20260928);
  const pieces: PlacedPiece[] = [];
  const add = (p: PlacedPiece) => pieces.push(p);
  const blocked: Rect[] = []; // footprints where nature/props must not go
  const paved: Rect[] = [];

  // Cobblestone plaza and roads (2 m tiles).
  const pave = (x0: number, z0: number, x1: number, z1: number, name: string) => {
    for (let x = x0 + 1; x < x1; x += 2)
      for (let z = z0 + 1; z < z1; z += 2) add({ kit: "village", name, x, y: 0.02, z, ry: 0 });
    paved.push([x0, z0, x1, z1]);
  };
  pave(-PLAZA, -PLAZA, PLAZA, PLAZA, "Floor_UnevenBrick");
  pave(-MAP_HALF, -ROAD, -PLAZA, ROAD, "Floor_Brick");
  pave(PLAZA, -ROAD, MAP_HALF, ROAD, "Floor_Brick");
  pave(-ROAD, -MAP_HALF, ROAD, -PLAZA, "Floor_Brick");
  pave(-ROAD, PLAZA, ROAD, MAP_HALF, "Floor_Brick");

  // Houses.
  for (const h of HOUSES) {
    const res = buildHouse(h);
    pieces.push(...res.pieces);
    blocked.push([h.x - 1.5, h.z - 1.5, h.x + h.sx + 1.5, h.z + h.sz + 1.5]);
  }

  // Market in the plaza: stalls in a loose ring with barrels and crates for cover.
  const market: [string, number, number, number][] = [
    ["Stall_Empty", -6, -6, Math.PI / 4], ["Stall_Cart_Empty", 6, -6.5, -Math.PI / 4],
    ["Stall_Empty", 6.5, 6, (3 * Math.PI) / 4], ["Stall_Cart_Empty", -6, 6.5, (-3 * Math.PI) / 4],
    ["Barrel", -7.6, -4.4, 0], ["Barrel", -8.3, -5.1, 0.6], ["Barrel_Apples", 4.3, -7.9, 0],
    ["Crate_Wooden", 8.1, 4.3, 0.2], ["Crate_Wooden", 8.2, 5.3, 1.1], ["FarmCrate_Carrot", -4.5, 8.2, 0.3],
    ["FarmCrate_Apple", -3.5, 8.3, -0.2], ["Crate_Metal", 1.2, -1.4, 0.4], ["Barrel", -1.4, 1.1, 0],
  ];
  for (const [name, x, z, ry] of market) add({ kit: "props", name, x, y: 0.02, z, ry });
  add({ kit: "village", name: "Prop_Wagon", x: 9.5, y: 0.02, z: -1.5, ry: 0.35 });
  add({ kit: "village", name: "Prop_Wagon", x: -24, y: 0.02, z: 4.5, ry: Math.PI / 2 + 0.1 });
  add({ kit: "village", name: "Prop_Wagon", x: 1.5, y: 0.02, z: 24, ry: -0.2 });

  // Cover along the roads.
  const roadCover: [string, number, number][] = [
    ["Crate_Wooden", -18, 1.2], ["Barrel", -26, -1.8], ["Crate_Wooden", 19, -1.6], ["Barrel_Holder", 25, 1.8],
    ["Crate_Wooden", -1.6, -19], ["Barrel", 1.7, -27], ["Crate_Metal", -1.5, 20], ["Barrel", 1.8, 33],
    ["Crate_Wooden", 38, 1.5], ["Crate_Wooden", -39, -1.4], ["Barrel", 1.4, -40], ["Crate_Wooden", -1.2, 40],
  ];
  for (const [name, x, z] of roadCover) add({ kit: "props", name, x, y: 0.02, z, ry: r.range(0, Math.PI) });

  // Wooden fences around gardens between buildings.
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.round(len / 2);
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      if (r.chance(0.12)) continue; // gaps to run through
      add({ kit: "village", name: r.pick(["Prop_WoodenFence_Single", "Prop_WoodenFence_Extension1"]), x: x0 + (x1 - x0) * t, y: 0, z: z0 + (z1 - z0) * t, ry });
    }
  };
  fence(-28, -22, -16, -22); fence(-28, -22, -28, -15);
  fence(18, 18, 30, 18); fence(30, 18, 30, 26);
  fence(-26, 16, -16, 26); fence(20, -26, 28, -18);

  // Spawns: teams on the west/east ends, FFA spread over roads, plaza edges and houses.
  const spawns: SpawnPoint[] = [];
  for (let k = 0; k < 8; k++) {
    const z = -14 + k * 4;
    spawns.push({ x: -41, y: 0.1, z, yaw: -Math.PI / 2, team: 1 });
    spawns.push({ x: 41, y: 0.1, z, yaw: Math.PI / 2, team: 2 });
  }
  const ffa: [number, number][] = [
    [-30, 0], [30, 0], [0, -30], [0, 30], [-40, -30], [40, 30], [-40, 30], [40, -30],
    [-20, -40], [20, 40], [-38, 18], [38, -18], [-10, 0], [10, 0], [0, -10], [0, 10],
    [-24, 22], [24, -24], [22, 22], [-24, -26],
  ];
  for (const [x, z] of ffa) spawns.push({ x, y: 0.1, z, yaw: Math.atan2(x, z), team: 0 });

  for (const sp of spawns) blocked.push([sp.x - 2, sp.z - 2, sp.x + 2, sp.z + 2]);

  // Nature: trees, bushes, rocks and grass, kept off roads and buildings.
  const clear = (x: number, z: number, pad: number) => !inRects(x, z, blocked, pad) && !inRects(x, z, paved, pad);
  const trees = ["CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4", "CommonTree_5", "Pine_1", "Pine_2", "Pine_3", "Pine_4", "Pine_5", "TwistedTree_1", "TwistedTree_3"];
  // Forest ring outside the play area (visual backdrop, mostly out of reach).
  for (let k = 0; k < 190; k++) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(MAP_HALF + 2, MAP_HALF + 24);
    const sq = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    add({ kit: "nature", name: r.pick(trees), x: (Math.cos(a) * d) / sq, y: 0, z: (Math.sin(a) * d) / sq, ry: r.range(0, 6.28), s: r.range(0.9, 1.5) });
  }
  // Trees scattered inside the village.
  let placed = 0;
  for (let k = 0; k < 400 && placed < 34; k++) {
    const x = r.range(-MAP_HALF + 3, MAP_HALF - 3), z = r.range(-MAP_HALF + 3, MAP_HALF - 3);
    if (!clear(x, z, 3.5) || Math.hypot(x, z) < PLAZA + 4) continue;
    add({ kit: "nature", name: r.pick(trees), x, y: 0, z, ry: r.range(0, 6.28), s: r.range(0.8, 1.2) });
    blocked.push([x - 1, z - 1, x + 1, z + 1]);
    placed++;
  }
  // Rocks as cover in open ground.
  placed = 0;
  for (let k = 0; k < 400 && placed < 16; k++) {
    const x = r.range(-MAP_HALF + 4, MAP_HALF - 4), z = r.range(-MAP_HALF + 4, MAP_HALF - 4);
    if (!clear(x, z, 3)) continue;
    add({ kit: "nature", name: r.pick(["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"]), x, y: 0, z, ry: r.range(0, 6.28), s: r.range(0.7, 1.1) });
    blocked.push([x - 1.5, z - 1.5, x + 1.5, z + 1.5]);
    placed++;
  }
  // Bushes, grass, flowers (no collision).
  const deco: [string[], number, number][] = [
    [["Bush_Common", "Bush_Common_Flowers"], 70, 1.5],
    [["Grass_Common_Short", "Grass_Common_Tall", "Grass_Wispy_Short", "Grass_Wispy_Tall"], 900, 0.4],
    [["Flower_3_Group", "Flower_4_Group", "Clover_1", "Fern_1", "Plant_1", "Plant_7"], 220, 0.6],
    [["Pebble_Round_1", "Pebble_Round_3", "Pebble_Square_2", "Pebble_Square_4", "Mushroom_Common"], 90, 0.3],
  ];
  for (const [names, count, pad] of deco) {
    let n = 0;
    for (let k = 0; k < count * 4 && n < count; k++) {
      const x = r.range(-MAP_HALF - 10, MAP_HALF + 10), z = r.range(-MAP_HALF - 10, MAP_HALF + 10);
      if (!clear(x, z, pad)) continue;
      add({ kit: "nature", name: r.pick(names), x, y: 0, z, ry: r.range(0, 6.28), s: r.range(0.8, 1.3) });
      n++;
    }
  }

  return { pieces, spawns, half: MAP_HALF };
}

let cached: MapData | null = null;
export function getVillage(): MapData {
  return (cached ??= buildVillage());
}
