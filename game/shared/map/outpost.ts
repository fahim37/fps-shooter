import type { MapData, MapOverview, SpawnPoint } from "./types";
import outpostPieces from "../generated/outpost-pieces.json";

/**
 * "Outpost": the ResoForge TDM arena ("LOWPOLY | FPS | TDM | GAME | MAP", CC BY 4.0), imported
 * as one piece by scripts/assets/outpost.ts at 4x its source scale: a walled 34 x 66 m compound
 * sized for 6v6. A two-story barracks with two watchtowers splits the middle; the ends are
 * raised platforms (4.2 m) with ramps down, Blue's to the north (-Z), Red's to the south.
 */

type Footprint = { x: number; z: number; sx: number; sz: number; h: number };
const { pieces, footprints } = outpostPieces as unknown as { pieces: { Outpost: { min: number[]; max: number[] } }; footprints: Footprint[] };

/**
 * Team spawns [x, floor y, z], chosen against the real collision (server/outpost.test.ts): on flat
 * floor, with room around them, and none in sight of any of the other team's.
 */
const BLUE: [number, number, number][] = [
  [-5, 4.2, -30.5], [12, 0, -30.5], [0, 4.2, -29.5], [3, 0, -29.5], [15, 0, -29.5],
  [-14, 4.2, -28.5], [-9, 4.2, -28.5], [6, 0, -28.5], [9, 0, -28.5], [12, 0, -27.5],
];
const RED: [number, number, number][] = [
  [-9, 4.2, 27], [0, 4.2, 27], [3, 4.2, 27], [11, 4.2, 27], [8, 4.2, 29],
  [-7, 4.2, 30], [5, 4.2, 30], [6, 4.2, 26], [-6, 4.2, 27], [-1, 4.2, 30],
];
/** Free-for-all: around the barracks and along both side lanes. */
const FFA: [number, number, number][] = [
  [-12, 0, -19], [0, 0, -21], [12, 0, -19], [-13, 0, -9], [3, 0, -9], [13, 0, -7], [-13, 0, 9], [-3, 0, 9],
  [13, 0, 7], [-12, 4.22, 19], [0, 0, 21], [12, 0, 19], [-3, 0, -15], [3, 0, 15], [-8, 0, -13], [8, 0, 13],
];

export function buildOutpost(): MapData {
  const { min, max } = pieces.Outpost;
  const half = Math.ceil(Math.max(max[0], -min[0], max[2], -min[2]));
  const spawns: SpawnPoint[] = [
    // Yaw 0 faces -Z: Blue looks south toward the fight, Red north.
    ...BLUE.map(([x, y, z]): SpawnPoint => ({ x, y: y + 0.1, z, yaw: Math.PI, team: 1 })),
    ...RED.map(([x, y, z]): SpawnPoint => ({ x, y: y + 0.1, z, yaw: 0, team: 2 })),
    ...FFA.map(([x, y, z]): SpawnPoint => ({ x, y: y + 0.1, z, yaw: Math.atan2(x, z), team: 0 })),
  ];
  const overview: MapOverview = {
    roads: [],
    // The compound's floor, inside its outer wall.
    plazas: [{ x: min[0], z: min[2], sx: max[0] - min[0], sz: max[2] - min[2] }],
    buildings: footprints.map(({ x, z, sx, sz }) => ({ x, z, sx, sz })),
    labels: [
      { text: "BARRACKS", x: 3.6, z: -0.8 },
      { text: "NORTH", x: 3, z: -24 },
      { text: "SOUTH", x: 0, z: 24 },
    ],
  };
  return { id: "outpost", pieces: [{ kit: "outpost", name: "Outpost", x: 0, y: 0, z: 0, ry: 0 }], spawns, half, kits: ["outpost"], overview };
}

let cached: MapData | null = null;
export function getOutpost(): MapData {
  return (cached ??= buildOutpost());
}
