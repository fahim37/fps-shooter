import * as THREE from "three";
import type { Kit } from "../assets/kits";
import type { KitName, PlacedPiece } from "../../shared/map/types";

/** Pieces that never cast shadows (small foliage), to keep the shadow pass cheap. */
const NO_SHADOW = /^(Grass_|Clover|Flower_|Pebble_|Mushroom|Fern|Plant_|Prop_Vine|Floor_|Petal)/;
export const DECORATIVE = /^(Grass_|Flower_|Clover|Fern|Plant_|Pebble_|Mushroom)/;
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

/**
 * One InstancedMesh per (piece, primitive). Instances are split into spatial chunks so
 * frustum culling works on a map-sized set of pieces.
 */
export function buildInstancedMeshes(
  pieces: PlacedPiece[],
  kits: Record<KitName, Kit>,
  chunkSize = 32,
): THREE.InstancedMesh[] {
  const groups = new Map<string, PlacedPiece[]>();
  for (const p of pieces) {
    const cx = Math.floor(p.x / chunkSize), cz = Math.floor(p.z / chunkSize);
    const key = `${p.kit}|${p.name}|${cx},${cz}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(p);
  }

  const out: THREE.InstancedMesh[] = [];
  for (const [key, list] of groups) {
    const [kitName, name] = key.split("|");
    const piece = kits[kitName as KitName].get(name);
    if (!piece) {
      console.warn(`missing kit piece ${kitName}/${name}`);
      continue;
    }
    for (const part of piece.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((p, i) => mesh.setMatrixAt(i, placementMatrix(p, tmp).multiply(part.matrix)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      // Placements live in instanceMatrix; this mesh's own transform stays fixed.
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = !NO_SHADOW.test(name);
      mesh.receiveShadow = true;
      mesh.name = name;
      mesh.userData.windy = WINDY.test(name);
      mesh.userData.decorative = DECORATIVE.test(name);
      out.push(mesh);
    }
  }
  return out;
}
