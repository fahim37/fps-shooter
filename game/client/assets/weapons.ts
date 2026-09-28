import * as THREE from "three";
import { loadGLTF } from "./loaders";
import type { WeaponId } from "../../shared/weapons";
import meta from "../../shared/generated/weapons-meta.json";

export interface WeaponMeta {
  length: number;
  muzzle: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
}

export const WEAPON_META = meta as Record<WeaponId, WeaponMeta>;

/** Where the support hand grabs each weapon, in weapon space (grip at origin, muzzle toward -Z). */
export const FOREGRIP: Record<WeaponId, [number, number, number]> = {
  ar: [0, 0.0, -0.27],
  smg: [0, -0.03, -0.17],
  shotgun: [0, -0.01, -0.36],
  sniper: [0, -0.01, -0.33],
  pistol: [0, -0.04, 0.0],
};

let templates: Promise<Map<WeaponId, THREE.Object3D>> | null = null;

export function loadWeapons() {
  return (templates ??= loadGLTF("/models/weapons.glb").then((gltf) => {
    const map = new Map<WeaponId, THREE.Object3D>();
    for (const child of gltf.scene.children) {
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      map.set(child.name as WeaponId, child);
    }
    return map;
  }));
}

export function cloneWeapon(templates: Map<WeaponId, THREE.Object3D>, id: WeaponId): THREE.Object3D {
  const src = templates.get(id);
  if (!src) throw new Error(`weapon model ${id} missing`);
  const o = src.clone(true);
  o.position.set(0, 0, 0);
  o.rotation.set(0, 0, 0);
  return o;
}
