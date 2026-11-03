import type { MapData, MapOverview, PlacedPiece, SpawnPoint } from "./types";
import desertPieces from "../generated/desert-pieces.json";

/**
 * "Desert City": a walled desert town imported whole by scripts/assets/desert.ts. Blue spawns
 * in the west, Red in the east; between them streets, raised plazas and two sites (A in the
 * south-west, B in the north) inside a 120 m square.
 *
 * The town is split into merged chunks (`Desert_<i>_<j>`), clutter chunks that never collide
 * (`Detail_Desert_<i>_<j>`, skipped on Low), a distant backdrop, and `Clip_Desert`: the source's
 * player-clip boxes, which stop players but not bullets.
 */

type Spawn = [number, number, number];
interface Layout {
  pieces: Record<string, unknown>;
  spawns: { blue: Spawn[]; red: Spawn[]; ffa: Spawn[] };
  teams: { center: Spawn }[];
  sites: { A: Spawn; B: Spawn };
  footprints: { x: number; z: number; sx: number; sz: number }[];
}
const layout = desertPieces as unknown as Layout;

export const DESERT_HALF = 60;

export function buildDesert(): MapData {
  const pieces = Object.keys(layout.pieces).sort().map((name): PlacedPiece => ({ kit: "desert", name, x: 0, y: 0, z: 0, ry: 0 }));
  const [blue, red] = layout.teams.map((t) => t.center);
  /** Yaw facing from (x, z) toward a point (yaw 0 faces -Z). */
  const toward = (x: number, z: number, [tx, , tz]: Spawn) => Math.atan2(x - tx, z - tz);
  const spawns: SpawnPoint[] = [
    ...layout.spawns.blue.map(([x, y, z]): SpawnPoint => ({ x, y: y + 0.1, z, yaw: toward(x, z, red), team: 1 })),
    ...layout.spawns.red.map(([x, y, z]): SpawnPoint => ({ x, y: y + 0.1, z, yaw: toward(x, z, blue), team: 2 })),
    ...layout.spawns.ffa.map(([x, y, z]): SpawnPoint => ({ x, y: y + 0.1, z, yaw: toward(x, z, [0, 0, 0]), team: 0 })),
  ];
  const { A, B } = layout.sites;
  const overview: MapOverview = {
    roads: [],
    plazas: [],
    buildings: layout.footprints,
    labels: [
      { text: "A", x: A[0], z: A[2] },
      { text: "B", x: B[0], z: B[2] },
      { text: "BLUE", x: blue[0], z: blue[2] },
      { text: "RED", x: red[0], z: red[2] },
    ],
  };
  return { id: "desert", pieces, spawns, half: DESERT_HALF, kits: ["desert"], overview };
}

let cached: MapData | null = null;
export function getDesert(): MapData {
  return (cached ??= buildDesert());
}
