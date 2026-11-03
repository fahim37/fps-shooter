import fs from "node:fs";
import path from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { init as initRecast, type NavMeshQuery } from "recast-navigation";
import { navMeshFromTriangles } from "./navmesh";
import { getMap, MAP_IDS } from "../game/shared/map/maps";
import { buildWorld, mapTriangles, parseCollision, type KitCollision, type World } from "../game/shared/physics";
import type { KitName, MapData, MapId } from "../game/shared/map/types";

const MODELS = path.resolve(__dirname, "../public/models");

let ready: Promise<void> | null = null;
const kits: Partial<Record<KitName, KitCollision>> = {};
const navQueries = new Map<MapId, NavMeshQuery>();

function readKit(kit: KitName): KitCollision {
  const buf = fs.readFileSync(path.join(MODELS, `${kit}.collision.bin`));
  // Copy into a standalone ArrayBuffer (Node Buffers may share a pooled one).
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return parseCollision(kit, ab);
}

/** One-time server init: Rapier, collision data and a bot navmesh per map (shared by all rooms). */
export function initWorldData() {
  return (ready ??= (async () => {
    const t = Date.now();
    await RAPIER.init();
    for (const id of MAP_IDS) for (const kit of getMap(id).kits) kits[kit] ??= readKit(kit);
    await initRecast();
    for (const id of MAP_IDS) navQueries.set(id, buildNavMesh(getMap(id)));
    console.log(`[world] physics + navmeshes (${MAP_IDS.join(", ")}) ready in ${Date.now() - t} ms`);
  })());
}

/** A fresh physics world per room (rooms own grenades and bot colliders). */
export function createRoomWorld(map: MapData): World {
  return buildWorld(RAPIER, map, kits);
}

export { RAPIER };

export function getNav(map: MapId) {
  return navQueries.get(map)!;
}

/**
 * Builds the navmesh from the same collision geometry the players walk on. Agent size
 * matches the player capsule; climb allows stairs, curbs and door sills.
 */
function buildNavMesh(map: MapData) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const c of mapTriangles(map, kits)) {
    const base = positions.length / 3;
    // A loop, not push(...c.pos): a whole-map piece is one chunk, too long for spread arguments.
    for (const v of c.pos) positions.push(v);
    for (const i of c.idx) indices.push(base + i);
  }
  return navMeshFromTriangles(positions, indices, map.half);
}
