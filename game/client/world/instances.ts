import * as THREE from "three";
import type { Kit } from "../assets/kits";
import type { KitName, PlacedPiece } from "../../shared/map/types";

/** Pieces that never cast shadows (small foliage), to keep the shadow pass cheap. */
const NO_SHADOW = /^(Grass_|Clover|Flower_|Pebble_|Mushroom|Fern|Plant_|Prop_Vine|Floor_|Petal|Island|Drain|Manhole|Detail_|Desert_Backdrop)/;
export const DECORATIVE = /^(Grass_|Flower_|Clover|Fern|Plant_|Pebble_|Mushroom)/;
/** Merged clutter chunks (decals, posters, small props): never collide, left out on Low. */
export const DETAIL = /^Detail_/;
/** Pieces that sway in the wind. */
export const WINDY = /^(Grass_|Clover|Flower_|Fern|Plant_|Bush_|CommonTree|Pine_|TwistedTree|DeadTree)/;

const tmp = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

export function placementMatrix(p: PlacedPiece, out = new THREE.Matrix4()) {
  pos.set(p.x, p.y, p.z);
  quat.setFromAxisAngle(up, p.ry);
  const s = p.s ?? 1;
  scl.set(s, s, s);
  return out.compose(pos, quat, scl);
}

const frontSided = new WeakMap<THREE.Material, THREE.Material>();
/**
 * Downtown's prefab buildings are closed and never entered, but the kit exports every material
 * double-sided, so their inner faces were rasterized too. Culling them made Downtown's
 * buildings ~33% cheaper to draw on a software renderer (stand-in for office iGPUs).
 * Shared kit materials stay double-sided for the modular pieces players walk inside.
 */
function frontSide(material: THREE.Material) {
  // The fake-interior cards behind the windows face inward; culled, the windows turn see-through.
  if (material.side !== THREE.DoubleSide || material.transparent || /FakeInterior/.test(material.name)) return material;
  let m = frontSided.get(material);
  if (!m) {
    m = material.clone();
    m.side = THREE.FrontSide;
    frontSided.set(material, m);
  }
  return m;
}

/**
 * One InstancedMesh per (piece, primitive). Instances are split into spatial chunks so
 * frustum culling works on a map-sized set of pieces. Prefab buildings (many materials,
 * thousands of triangles) are not chunked: a city shows most of them at once, and one draw
 * per material for every copy is far cheaper on the CPU than one per material per chunk.
 */
export function buildInstancedMeshes(
  pieces: PlacedPiece[],
  kits: Partial<Record<KitName, Kit>>,
  // 48 m chunks: measured over 336 village views on Low, 27% fewer draw calls on average and 33%
  // fewer in the busiest views than 32 m, for 8% more triangles. Draw calls are what costs a
  // low-end CPU its frame time.
  chunkSize = 48,
): THREE.InstancedMesh[] {
  const groups = new Map<string, PlacedPiece[]>();
  const prefab = new Map<string, boolean>();
  const isPrefab = (kit: KitName, name: string) => {
    let v = prefab.get(`${kit}|${name}`);
    if (v === undefined) {
      const parts = kits[kit]?.get(name)?.parts ?? [];
      const tris = parts.reduce((n, part) => n + (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3, 0);
      prefab.set(`${kit}|${name}`, (v = parts.length >= 8 && tris > 5000));
    }
    return v;
  };
  for (const p of pieces) {
    const cx = Math.floor(p.x / chunkSize), cz = Math.floor(p.z / chunkSize);
    const key = `${p.kit}|${p.name}|${isPrefab(p.kit, p.name) ? "all" : `${cx},${cz}`}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(p);
  }

  const out: THREE.InstancedMesh[] = [];
  for (const [key, list] of groups) {
    const [kitName, name] = key.split("|");
    const piece = kits[kitName as KitName]?.get(name);
    if (!piece) {
      console.warn(`missing kit piece ${kitName}/${name}`);
      continue;
    }
    const solid = kitName === "city" && key.endsWith("|all");
    for (const part of piece.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, solid ? frontSide(part.material) : part.material, list.length);
      list.forEach((p, i) => mesh.setMatrixAt(i, placementMatrix(p, tmp).multiply(part.matrix)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      // Placements live in instanceMatrix; this mesh's own transform stays fixed (identity), so
      // the renderer can skip it when refreshing world matrices every frame.
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      mesh.castShadow = !NO_SHADOW.test(name);
      mesh.receiveShadow = true;
      mesh.name = name;
      mesh.userData.windy = WINDY.test(name);
      mesh.userData.decorative = DECORATIVE.test(name) || DETAIL.test(name);
      out.push(mesh);
    }
  }
  return out;
}
