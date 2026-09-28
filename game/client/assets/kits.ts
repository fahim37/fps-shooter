import * as THREE from "three";
import { loadGLTF } from "./loaders";
import type { KitName } from "../../shared/map/types";

/** One mesh primitive of a kit piece, with its transform relative to the piece origin. */
export interface KitPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Piece-space transform (includes meshopt dequantization scale). */
  matrix: THREE.Matrix4;
}

export interface KitPiece {
  name: string;
  parts: KitPart[];
}

export type Kit = Map<string, KitPiece>;

const kitCache = new Map<KitName, Promise<Kit>>();

export function loadKit(name: KitName): Promise<Kit> {
  let p = kitCache.get(name);
  if (!p) {
    p = loadGLTF(`/models/${name}.glb`).then((gltf) => {
      const kit: Kit = new Map();
      gltf.scene.updateMatrixWorld(true);
      for (const pieceNode of gltf.scene.children) {
        const inv = pieceNode.matrixWorld.clone().invert();
        const parts: KitPart[] = [];
        pieceNode.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          parts.push({
            geometry: mesh.geometry,
            material: mesh.material as THREE.Material,
            matrix: inv.clone().multiply(mesh.matrixWorld),
          });
        });
        kit.set(pieceNode.name, { name: pieceNode.name, parts });
      }
      return kit;
    });
    kitCache.set(name, p);
  }
  return p;
}
