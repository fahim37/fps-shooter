export type KitName = "village" | "nature" | "props";

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

export interface MapData {
  pieces: PlacedPiece[];
  spawns: SpawnPoint[];
  /** Playable area is [-half, half] on X and Z. */
  half: number;
}
