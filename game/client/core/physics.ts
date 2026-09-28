import RAPIER from "@dimforge/rapier3d-compat";
import { loadBinary } from "../assets/loaders";
import { buildWorld, parseCollision, type World, type Rapier } from "../../shared/physics";
import type { KitName, MapData } from "../../shared/map/types";

let rapierReady: Promise<void> | null = null;

/** Builds the local physics world from the same collision data the server uses. */
export async function loadClientWorld(map: MapData): Promise<{ R: Rapier; world: World }> {
  await (rapierReady ??= RAPIER.init());
  const kits = {} as Record<KitName, ReturnType<typeof parseCollision>>;
  await Promise.all(
    (["village", "nature", "props"] as KitName[]).map(async (k) => {
      kits[k] = parseCollision(k, await loadBinary(`/models/${k}.collision.bin`));
    }),
  );
  return { R: RAPIER, world: buildWorld(RAPIER, map, kits) };
}
