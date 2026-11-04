import type { MapData, MapOverview, MapRect, PlacedPiece, SpawnPoint } from "./types";
import arenaPieces from "../generated/arena-pieces.json";

/**
 * "Chiba Arena": the event floor of a ballpark skate contest, imported whole by
 * scripts/assets/arena.ts. A 64 x 92 m floor with the street course in the middle (ramps,
 * decks, ledges and rails), crowd barriers around it, bleachers and booths along the sides;
 * Blue spawns at the north end (-Z), Red at the south end. The stands all around are backdrop.
 *
 * The geometry is split into merged chunks (`Arena_<i>_<j>`), clutter chunks that never collide
 * (`Detail_Arena_<i>_<j>`, skipped on Low), the perimeter board, the unlit stadium
 * (`Arena_Backdrop`), and `Clip_Arena`: the low crowd barriers, which players hop over, and the
 * wall above the board. Neither stops bullets.
 */

type Spawn = [number, number, number];
interface Layout {
  pieces: Record<string, unknown>;
  spawns: { blue: Spawn[]; red: Spawn[]; ffa: Spawn[] };
  floor: MapRect;
  footprints: MapRect[];
}
const layout = arenaPieces as unknown as Layout;

export const ARENA_HALF = 47;

export function buildArena(): MapData {
  const pieces = Object.keys(layout.pieces).sort().map((name): PlacedPiece => ({ kit: "arena", name, x: 0, y: 0, z: 0, ry: 0 }));
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
      { text: "BLUE", x: 0, z: -43 },
      { text: "RED", x: 0, z: 43 },
      { text: "COURSE", x: 2, z: 0 },
    ],
  };
  return { id: "arena", pieces, spawns, half: ARENA_HALF, kits: ["arena"], overview };
}

let cached: MapData | null = null;
export function getArena(): MapData {
  return (cached ??= buildArena());
}
