import type { MapData, MapId } from "./types";
import { getVillage } from "./village";
import { getCity } from "./city";

export interface MapInfo {
  id: MapId;
  name: string;
  /** Short line for map cards and room rows. */
  tagline: string;
  /** Combat style, shown on the map picker. */
  style: string;
}

export const MAPS: Record<MapId, MapInfo> = {
  village: { id: "village", name: "Village", tagline: "Timber houses, a market plaza and forest edges.", style: "Open lanes · Multi-story houses" },
  downtown: { id: "downtown", name: "Downtown", tagline: "City streets, tight alleys and rooftop shops.", style: "Street fights · Close quarters" },
};

export const MAP_IDS = Object.keys(MAPS) as MapId[];
export const DEFAULT_MAP: MapId = "village";

export function isMapId(value: unknown): value is MapId {
  return typeof value === "string" && Object.hasOwn(MAPS, value);
}

/** Unknown or missing ids fall back to the default map. */
export function mapId(value: unknown): MapId {
  return isMapId(value) ? value : DEFAULT_MAP;
}

/** The deterministic map for an id (built once, then cached). */
export function getMap(id?: unknown): MapData {
  return mapId(id) === "downtown" ? getCity() : getVillage();
}
