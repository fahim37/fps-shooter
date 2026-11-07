import type { MapData, MapOverview, MapRect, PlacedPiece, SpawnPoint } from "./types";
import streetPieces from "../generated/street-pieces.json";

/**
 * "Boulevard": a ceremonial avenue imported whole by scripts/assets/street.ts. Blue spawns on the
 * round plaza under the palace (-Z), Red in front of the gatehouse (+Z); between them a sunken
 * road, terraced walks and a cross street with a statue court and a pool.
 *
 * Merged chunks (`Street_<side>_<i>`), clutter that never collides (`Detail_Street_<side>_<i>`,
 * skipped on Low), plants that are always drawn but never collide (`Street_Plants`), and
 * `Clip_Street`: the perimeter, which stops players but not bullets.
 */

type Spawn = [number, number, number];
interface Layout {
  pieces: Record<string, unknown>;
  spawns: { blue: Spawn[]; red: Spawn[]; ffa: Spawn[] };
  floor: MapRect;
  footprints: MapRect[];
}
const layout = streetPieces as unknown as Layout;

export const STREET_HALF = 75;

/** The road and the cross street, for the minimap. */
const ROADS: MapRect[] = [{ x: -3.5, z: -26, sx: 7, sz: 99 }, { x: -22.6, z: 18, sx: 45.2, sz: 10.5 }];

export function buildStreet(): MapData {
  const pieces = Object.keys(layout.pieces).sort().map((name): PlacedPiece => ({ kit: "street", name, x: 0, y: 0, z: 0, ry: 0 }));
  const toward = (x: number, z: number, tx: number, tz: number) => Math.atan2(x - tx, z - tz);
  const spawn = (team: SpawnPoint["team"]) => ([x, y, z]: Spawn): SpawnPoint => ({ x, y: y + 0.1, z, yaw: toward(x, z, 0, 0), team });
  const spawns = [...layout.spawns.blue.map(spawn(1)), ...layout.spawns.red.map(spawn(2)), ...layout.spawns.ffa.map(spawn(0))];
  const overview: MapOverview = { roads: ROADS, plazas: [layout.floor], buildings: layout.footprints, labels: [] };
  return { id: "street", pieces, spawns, half: STREET_HALF, kits: ["street"], overview };
}

let cached: MapData | null = null;
export function getStreet(): MapData {
  return (cached ??= buildStreet());
}
