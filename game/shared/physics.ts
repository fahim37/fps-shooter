import type RAPIER_NS from "@dimforge/rapier3d-compat";
import type { KitName, MapData } from "./map/types";
import villagePieces from "./generated/village-pieces.json";
import naturePieces from "./generated/nature-pieces.json";
import propsPieces from "./generated/props-pieces.json";
import { GRAVITY } from "./constants";

export type Rapier = typeof RAPIER_NS;
export type World = RAPIER_NS.World;

type PiecesJson = { positionsByteLength: number; pieces: Record<string, { min: number[]; max: number[]; col?: number[] }> };

export const PIECES: Record<KitName, PiecesJson> = {
  village: villagePieces as PiecesJson,
  nature: naturePieces as PiecesJson,
  props: propsPieces as PiecesJson,
};

export interface KitCollision {
  positions: Float32Array;
  indices: Uint32Array;
  pieces: PiecesJson["pieces"];
}

/** Splits a `<kit>.collision.bin` buffer (Float32 positions then Uint32 indices). */
export function parseCollision(kit: KitName, bytes: ArrayBuffer): KitCollision {
  const { positionsByteLength, pieces } = PIECES[kit];
  return {
    positions: new Float32Array(bytes, 0, positionsByteLength / 4),
    indices: new Uint32Array(bytes, positionsByteLength),
    pieces,
  };
}

// Rapier interaction groups: high 16 bits = memberships, low 16 bits = filter.
/** Map geometry: member of group 0, interacts with everything. */
export const GROUP_WORLD = 0x0001_ffff;
/** Characters collide with the map only (players pass through each other). */
export const GROUP_CHARACTER = 0x0002_0001;
/** Grenades bounce off the map only. */
export const GROUP_GRENADE = 0x0004_0001;
/** Scene queries that should only see map geometry. */
export const QUERY_WORLD = 0xffff_0001;

/**
 * Builds the static collision world for a map: ground, boundary walls and every placed
 * piece's collision mesh merged into per-chunk trimeshes.
 */
export function buildWorld(R: Rapier, map: MapData, kits: Record<KitName, KitCollision>, chunkSize = 24): World {
  const world = new R.World({ x: 0, y: -GRAVITY, z: 0 });

  world.createCollider(R.ColliderDesc.cuboid(400, 0.5, 400).setTranslation(0, -0.5, 0).setCollisionGroups(GROUP_WORLD));
  const h = map.half, wallH = 40;
  for (const [x, z, hx, hz] of [[h + 0.5, 0, 0.5, h + 1], [-h - 0.5, 0, 0.5, h + 1], [0, h + 0.5, h + 1, 0.5], [0, -h - 0.5, h + 1, 0.5]]) {
    world.createCollider(R.ColliderDesc.cuboid(hx, wallH, hz).setTranslation(x, wallH, z).setCollisionGroups(GROUP_WORLD));
  }

  for (const c of mapTriangles(map, kits, chunkSize)) {
    world.createCollider(
      R.ColliderDesc.trimesh(new Float32Array(c.pos), new Uint32Array(c.idx)).setCollisionGroups(GROUP_WORLD),
    );
  }
  // Populate the query pipeline so raycasts work before the first real step.
  world.step();
  return world;
}

/** Every placed piece's collision triangles in world space, merged per spatial chunk. */
export function mapTriangles(map: MapData, kits: Record<KitName, KitCollision>, chunkSize = 24) {
  const chunks = new Map<string, { pos: number[]; idx: number[] }>();
  for (const p of map.pieces) {
    const kit = kits[p.kit];
    const col = kit.pieces[p.name]?.col;
    if (!col) continue;
    const [v0, vc, i0, ic] = col;
    const key = `${Math.floor(p.x / chunkSize)},${Math.floor(p.z / chunkSize)}`;
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = { pos: [], idx: [] }));
    const base = c.pos.length / 3;
    const cos = Math.cos(p.ry), sin = Math.sin(p.ry), s = p.s ?? 1;
    for (let v = v0; v < v0 + vc; v++) {
      const x = kit.positions[v * 3] * s, y = kit.positions[v * 3 + 1] * s, z = kit.positions[v * 3 + 2] * s;
      c.pos.push(p.x + x * cos + z * sin, p.y + y, p.z - x * sin + z * cos);
    }
    // Indices in the .bin are relative to the piece's own vertices.
    for (let i = i0; i < i0 + ic; i++) c.idx.push(base + kit.indices[i]);
  }
  return [...chunks.values()];
}

export interface RayHit {
  distance: number;
  point: [number, number, number];
  normal: [number, number, number];
}

/** Raycast against map geometry only. */
export function raycastWorld(
  R: Rapier, world: World,
  origin: [number, number, number], dir: [number, number, number], maxDist: number,
): RayHit | null {
  const ray = new R.Ray({ x: origin[0], y: origin[1], z: origin[2] }, { x: dir[0], y: dir[1], z: dir[2] });
  const hit = world.castRayAndGetNormal(ray, maxDist, true, undefined, QUERY_WORLD);
  if (!hit) return null;
  const t = hit.timeOfImpact;
  return {
    distance: t,
    point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t],
    normal: [hit.normal.x, hit.normal.y, hit.normal.z],
  };
}

/** True if nothing in the map blocks the segment a→b. */
export function lineOfSight(R: Rapier, world: World, a: [number, number, number], b: [number, number, number]) {
  const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-4) return true;
  return !raycastWorld(R, world, a, [d[0] / len, d[1] / len, d[2] / len], len - 0.05);
}
