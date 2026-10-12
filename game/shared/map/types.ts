export type KitName = "village" | "nature" | "props" | "city";

/** Maps a room can be played on. */
export type MapId = "village" | "downtown";

/** A kit piece placed in the world. Rotation is about +Y, in radians. */
export interface PlacedPiece {
  kit: KitName;
  name: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  /** Uniform scale (nature variety); defaults to 1. */
  s?: number;
}

/** 0 = free-for-all, 1 / 2 = team spawns. */
export type SpawnTeam = 0 | 1 | 2;

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  team: SpawnTeam;
}

/** World-space rectangle: min corner and size, in meters. */
export interface MapRect {
  x: number;
  z: number;
  sx: number;
  sz: number;
}

/** What the minimap draws: the same layout the map was built from. */
export interface MapOverview {
  roads: MapRect[];
  plazas: MapRect[];
  buildings: MapRect[];
  labels: { text: string; x: number; z: number }[];
}

export interface MapData {
  id: MapId;
  pieces: PlacedPiece[];
  spawns: SpawnPoint[];
  /** Playable area is [-half, half] on X and Z. */
  half: number;
  /** Kits the pieces use; only these are downloaded. */
  kits: KitName[];
  overview: MapOverview;
}
