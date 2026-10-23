import type { MapData, MapId } from "./types";
import { getVillage } from "./village";
import { getCity } from "./city";
import { getIndustrial } from "./industrial";
import { getOutpost } from "./outpost";

export interface MapInfo {
  id: MapId;
  name: string;
  /** Short line for map cards and room rows. */
  tagline: string;
  /** Combat style, shown on the map picker. */
  style: string;
  /** Attribution the map's license requires, shown on its card. */
  credit?: string;
}

export const MAPS: Record<MapId, MapInfo> = {
  village: { id: "village", name: "Village", tagline: "Timber houses, a market plaza and forest edges.", style: "Open lanes · Multi-story houses" },
  downtown: { id: "downtown", name: "Downtown", tagline: "City streets, tight alleys and rooftop shops.", style: "Street fights · Close quarters" },
  industrial: { id: "industrial", name: "Freight Yard", tagline: "Trailer corridors, a walk-through depot and workshop alleys.", style: "Three lanes · Warehouse fights" },
  outpost: {
    id: "outpost", name: "Outpost", tagline: "A walled compound: a barracks and twin watchtowers between two raised bases.", style: "Compact 6v6 · Close quarters",
    credit: "\"LOWPOLY | FPS | TDM | GAME | MAP\" by ResoForge · CC BY 4.0",
  },
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
  const map = mapId(id);
  return map === "downtown" ? getCity() : map === "industrial" ? getIndustrial() : map === "outpost" ? getOutpost() : getVillage();
}
