import type { MapData, MapOverview, MapRect, PlacedPiece, SpawnPoint } from "./types";
import blockadePieces from "../generated/blockade-pieces.json";

/**
 * "Blockade": a barricaded depot by ResoForge, imported whole by scripts/assets/blockade.ts. A ring
 * of tall barricades closes a 60 x 120 m floor of container rows, truck wrecks, sandbag nests and
 * walk-in rooms, with a scaffolded hall on the west side and a watchtower in two opposite corners.
 * Blue spawns at the north end (-Z), Red at the south end. Wrecks close both ends of the ring; the
 * vehicle yards past them are walled, and players reach them only by jumping over the wrecks.
 *
 * The geometry is split into merged chunks (`Blockade_<i>_<j>`), and `Clip_Blockade`: the wall
 * behind the ring and over the yards, which stops players but not bullets.
 */

type Spawn = [number, number, number];
interface Layout {
  pieces: Record<string, unknown>;
  spawns: { blue: Spawn[]; red: Spawn[]; ffa: Spawn[] };
  floor: MapRect;
  footprints: MapRect[];
}
const layout = blockadePieces as unknown as Layout;

export const BLOCKADE_HALF = 77;

export function buildBlockade(): MapData {
  const pieces = Object.keys(layout.pieces).sort().map((name): PlacedPiece => ({ kit: "blockade", name, x: 0, y: 0, z: 0, ry: 0 }));
  /** Yaw facing from (x, z) toward a point (yaw 0 faces -Z). */
  const toward = (x: number, z: number, tx: number, tz: number) => Math.atan2(x - tx, z - tz);
  const spawns: SpawnPoint[] = [
    ...layout.spawns.blue.map(([x, y, z]): SpawnPoint => ({ x, y: y + 0.1, z, yaw: toward(x, z, x * 0.3, 0), team: 1 })),
    ...layout.spawns.red.map(([x, y, z]): SpawnPoint => ({ x, y: y + 0.1, z, yaw: toward(x, z, x * 0.3, 0), team: 2 })),
    ...layout.spawns.ffa.map(([x, y, z]): SpawnPoint => ({ x, y: y + 0.1, z, yaw: toward(x, z, 0, 0), team: 0 })),
  ];
  const overview: MapOverview = {
    roads: [],
    plazas: [layout.floor],
    buildings: layout.footprints,
    labels: [
      { text: "BLUE", x: 0, z: -56 },
      { text: "RED", x: 0, z: 56 },
      { text: "HALL", x: -24, z: 9 },
    ],
  };
  return { id: "blockade", pieces, spawns, half: BLOCKADE_HALF, kits: ["blockade"], overview };
}

let cached: MapData | null = null;
export function getBlockade(): MapData {
  return (cached ??= buildBlockade());
}
