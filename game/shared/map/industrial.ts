import type { MapData, MapOverview, MapRect, PlacedPiece, SpawnPoint } from "./types";
import industrialPieces from "../generated/industrial-pieces.json";

/**
 * "Freight Yard" — an industrial zone built from the Low Poly Industrial Zone kit, laid out on
 * the pack's own floating-island terrain. Deterministic: the server and every client build
 * identical pieces, spawns and collision.
 *
 * World axes: +X east, +Z south (N = -Z). Three lanes run east–west between the team bases:
 *   - North, "Yard": parked trailers make corridors; one trailer per side has steel stairs to
 *     its roof, a high spot over the middle lane that is open to fire from the dock.
 *   - Middle, "Dock": an open-sided canopy full of cargo at the center, scattered cover on
 *     the way to it, and skips that keep each spawn out of the long sightline.
 *   - South, "Works": solid buildings and alleys for close-quarters fights.
 * The layout is mirrored across x = 0, so Blue (west) and Red (east) get identical halves.
 *
 * Kit conventions (measured by the importer): pieces stand on y = 0 and are centered on their
 * footprint; trailers and low barriers run along local x; Stairs_Steel climbs 3.6 m toward
 * local -Z with its top edge at z = 0, which meets a trailer roof (3.67 m) at its long side.
 */

export const INDUSTRIAL_HALF = 48;
const H = INDUSTRIAL_HALF;
const PI = Math.PI;

type PieceBounds = { min: number[]; max: number[] };
const BOUNDS = (industrialPieces as { pieces: Record<string, PieceBounds> }).pieces;

/** Pieces drawn as solid blocks on the minimap (and kept clear of spawns). */
const SOLID = /^(Warehouse|Office|BrickHall|Garage|Hut|Shed|SiloShed|Substation|Workshop|GasTanks|Trailer_|Skips_Dark)/;

const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0; // +0 turns -0 into 0
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

class Layout {
  pieces: PlacedPiece[] = [];
  buildings: MapRect[] = [];

  /** One piece at an exact spot (used on the center line and outside the fence). */
  one(name: string, x: number, z: number, ry = 0, y = 0) {
    if (!BOUNDS[name]) throw new Error(`industrial kit has no ${name}`);
    this.pieces.push({ kit: "industrial", name, x: r3(x), y: r3(y), z: r3(z), ry: r3(wrap(ry)) });
    if (SOLID.test(name) && Math.abs(x) < H && Math.abs(z) < H) this.buildings.push(footprint(name, x, z, ry));
  }

  /** A piece in the west half and its mirror image in the east half. */
  both(name: string, x: number, z: number, ry = 0, y = 0) {
    this.one(name, x, z, ry, y);
    this.one(name, -x, z, -ry, y);
  }
}

/** World-space bounding rectangle of a placed piece. */
function footprint(name: string, x: number, z: number, ry: number): MapRect {
  const { min, max } = BOUNDS[name];
  const c = Math.cos(ry), s = Math.sin(ry);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [px, pz] of [[min[0], min[2]], [max[0], min[2]], [max[0], max[2]], [min[0], max[2]]]) {
    const wx = x + px * c + pz * s, wz = z - px * s + pz * c;
    x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
  }
  return { x: r3(x0), z: r3(z0), sx: r3(x1 - x0), sz: r3(z1 - z0) };
}

/** Blue base, west lanes and the west edge; mirrored for Red. */
function westHalf(l: Layout) {
  // Base corners: headquarters to the north-west, the silo shed to the south-west.
  l.both("Office", -42.4, -40.5, PI / 2);
  l.both("SiloShed", -41.5, 41.5, 0);
  // Spawn screen: tall barriers and cargo break the lines from the lanes into the base.
  l.both("Barrier_Tall", -35.5, -12.5, 0);
  l.both("Barrier_Tall", -35.5, 12.5, 0);
  l.both("Pallet_TarpStack", -36, -5.5, PI / 2);
  l.both("Pallet_TarpStack", -36, 5.5, PI / 2);
  l.both("Light_Flood", -46.5, 0, PI / 2);

  // --- North lane: the trailer yard. ---
  l.both("Trailer_Red", -24, -42.5, 0);
  l.both("Trailer_White", -14, -31, 0);
  // The overlook: a trailer on the lane's edge with stairs up from the yard side.
  l.both("Trailer_Blue", -26, -20, 0);
  l.both("Stairs_Steel", -22, -21.25, PI);
  l.both("Spools_Pair", -33.5, -27.5, PI / 2);
  l.both("Barrier_Tall", -27, -35.5, PI / 2);
  l.both("Barrier_Tall", -24.8, -35.5, PI / 2);
  l.both("Beams", -6, -33.5, PI / 2);
  l.both("Pallet_Cargo", -35, -24, 0.2);
  l.both("Pallet_Cargo", -6, -25.5, -0.3);
  l.both("Spool_Standing", -19, -25.5, 0.4);
  l.both("Drain", -20, -37, PI / 2);

  // --- Middle lane: approaches to the dock. Every line from one spawn to the other crosses
  // something taller than a standing player. ---
  l.both("Skips_Dark", -28.5, 0, 0);
  l.both("GasTanks", -21, -10.5, 0);
  l.both("Pallet_TarpStack", -30, -15.5, 0);
  l.both("Spools_Pair", -24, 9.5, PI / 2);
  l.both("Barrier_Low", -20.5, -1.7, PI / 2);
  l.both("Barrier_Low", -20.5, 0, PI / 2);
  l.both("Barrier_Low", -20.5, 1.7, PI / 2);
  l.both("Spool_Standing", -14.5, -3.5, 0.35);
  l.both("Spools_Pair", -15, 5, PI / 2 + 0.2);
  l.both("Drums_Red", -11, -12.5, 0);
  l.both("Pallet_Cargo", -10, 10.4, 0.15);
  l.both("Pallet_Tarp", -11.6, 10.6, -0.1);
  l.both("Manhole", -17, -6, 0);

  // --- Divider between the middle and south lanes: a hut, and a trailer whose roof (stairs
  // up from the works side) is the second overlook. ---
  l.both("Hut", -27, 21, PI / 2);
  l.both("Trailer_Red", -14.5, 14, 0);
  l.both("Stairs_Steel", -11, 15.25, 0);
  l.both("Light_Street", -24, 14.5, -PI / 2);
  l.both("Tree_Planter", -34, 17.5, 0);

  // --- South lane: the works. ---
  l.both("Garage", -27, 39.4, 0);
  l.both("Shed", -14.5, 35, 0);
  l.both("Pallet_TarpStack", -14.5, 27.5, 0);
  l.both("Drums_Blue", -17.5, 30, 0.3);
  l.both("Skip_Green", -36.5, 27, PI / 2);
  l.both("Bin", -19.5, 22.5, 0.2);
  l.both("Spool_Flat", -6, 25, 0);
  l.both("Barrier_Low", -5.2, 28.5, 0.15);
  l.both("Light_Street", -11, 44, PI / 2);
}

/** Pieces on the center line (each placed once, roughly symmetric about x = 0). */
function center(l: Layout) {
  // The dock: an open canopy with cargo to fight around.
  l.one("Canopy", 0, 0, 0);
  l.one("Pallet_TarpStack", 0, -4.5, 0);
  l.one("Pallet_TarpStack", 0, 4.5, PI);
  l.one("Spool_Standing", -3.6, 0, PI / 2);
  l.one("Spool_Standing", 3.6, 0, PI / 2);
  l.both("Pallet_Cargo", -5.2, -6.6, 0);
  l.both("Drums_Blue", -5.2, 6.8, 0);
  l.both("Barrier_Low", -9.6, -1.4, PI / 2);
  // North: the workshop and its radio mast, the map's landmark.
  l.one("Workshop", 0, -43.4, 0); // backs onto the fence: no dead-end alley behind it
  l.one("Barrier_Tall", -1.3, -24, PI / 2);
  l.one("Barrier_Tall", 1.3, -24, PI / 2);
  l.one("Pallet_TarpStack", 0, -17.5, 0); // also cuts the diagonal between the north spawns
  // South: the brick hall closes the works' center.
  l.one("BrickHall", 0, 39.8, 0);
  l.one("Substation", 0, 22.5, 0);
}

/** Fence, lights and parked freight around the play area (outside it, except the fence line). */
function perimeter(l: Layout) {
  const panel = 3.6;
  for (let k = 0; k < Math.ceil((2 * H) / panel); k++) {
    const t = -H + panel / 2 + k * panel;
    l.one("Fence_Metal", t, -H - 0.2, PI / 2);
    l.one("Fence_Metal", t, H + 0.2, PI / 2);
    l.one("Fence_Metal", -H - 0.2, t, 0);
    l.one("Fence_Metal", H + 0.2, t, 0);
  }
  // Warehouses behind each base, their long side along the fence.
  l.both("Warehouse", -H - 13, 0, PI / 2);
  // Parked trailers and poles along the north and south service roads.
  for (const [name, x, z] of [["Trailer_White", -30, -52.5], ["Trailer_Red", -12, -52.5], ["Trailer_Blue", 18, -53], ["Trailer_Red", 36, -52.5],
    ["Trailer_Blue", -36, 52.5], ["Trailer_White", -6, 53], ["Trailer_Red", 24, 52.5]] as const) l.one(name, x, z, 0);
  for (let x = -40; x <= 40; x += 20) {
    l.one("Pole_Wood", x, -55.5, 0);
    l.one("Pole_Wood", x + 10, 55.5, PI);
  }
  // Birches on the grass verge.
  for (const [x, z, ry] of [[-60, -61, 0.4], [-25, -63, 2.1], [10, -62, 4], [45, -61, 1.2], [-50, 62, 3.3], [-12, 63, 0.9], [28, 62, 5.1], [62, 60, 2.6], [-74, -40, 1.7], [75, 38, 4.4]] as const)
    l.one("Tree_Birch", x, z, ry);
}

export function buildIndustrial(): MapData {
  const l = new Layout();
  l.one("Island", 0, 0, 0);
  westHalf(l);
  center(l);
  perimeter(l);

  // Spawns: Blue along the west fence, Red mirrored on the east.
  const spawns: SpawnPoint[] = [];
  for (const z of [-27, -21, -15, -9, 9, 15, 21, 27]) {
    spawns.push({ x: -44, y: 0.1, z, yaw: -PI / 2, team: 1 });
    spawns.push({ x: 44, y: 0.1, z, yaw: PI / 2, team: 2 });
  }
  // Free-for-all: every lane, both halves.
  const ffa: [number, number][] = [
    [-30, -36], [-17, -37], [-30, -26], [-3.5, -28.5], // yard
    [-24, 4], [-17, -8], [-9, 6], // dock approaches
    [-38, 32], [-20, 26], [-8, 33], // works
  ];
  for (const [x, z] of ffa) {
    spawns.push({ x, y: 0.1, z, yaw: Math.atan2(x, z), team: 0 });
    spawns.push({ x: -x, y: 0.1, z, yaw: Math.atan2(-x, z), team: 0 });
  }

  const overview: MapOverview = {
    roads: [
      { x: -H, z: -18, sx: 2 * H, sz: 36 }, // the middle lane's open yard
    ],
    plazas: [{ x: -7.6, z: -8.8, sx: 15.2, sz: 17.6 }], // the dock canopy
    buildings: l.buildings,
    labels: [
      { text: "YARD", x: 0, z: -28 },
      { text: "DOCK", x: 0, z: 12 },
      { text: "WORKS", x: 0, z: 29 },
    ],
  };
  return { id: "industrial", pieces: l.pieces, spawns, half: H, kits: ["industrial"], overview };
}

let cached: MapData | null = null;
export function getIndustrial(): MapData {
  return (cached ??= buildIndustrial());
}
