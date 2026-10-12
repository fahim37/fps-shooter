"use client";

/* eslint-disable react-hooks/immutability -- Instanced meshes and cached kit textures are imperative Three objects. */

import { use, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { loadKit, type Kit } from "../assets/kits";
import { buildInstancedMeshes, DECORATIVE } from "./instances";
import { applyWind } from "./wind";
import type { KitName, MapData } from "../../shared/map/types";
import { useSettings, PRESETS } from "../settings";

export type MapKits = Partial<Record<KitName, Kit>>;

const kitSets = new Map<string, Promise<MapKits>>();
/** Loads (once) and tunes only the kits a map places, so other maps' models never download. */
export function loadMapKits(names: KitName[]): Promise<MapKits> {
  const key = names.join(",");
  let p = kitSets.get(key);
  if (!p) {
    p = Promise.all(names.map(loadKit)).then((kits) => {
      tuneMaterials(kits);
      return Object.fromEntries(names.map((n, i) => [n, kits[i]])) as MapKits;
    });
    kitSets.set(key, p);
    void p.catch(() => kitSets.delete(key));
  }
  return p;
}

/** Renders every static map piece with GPU instancing. */
export function StaticWorld({ map }: { map: MapData }) {
  const kits = use(loadMapKits(map.kits));
  const quality = useSettings((s) => s.quality);
  const p = PRESETS[quality];
  const { foliage } = p;
  const gl = useThree((s) => s.gl);
  const cullTimer = useRef(0);
  const warmed = useRef<{ meshes: THREE.InstancedMesh[]; env: THREE.Texture | null; shadows: boolean; anisotropy: number } | null>(null);

  const meshes = useMemo(() => {
    // Thin out decorative foliage on lower quality settings (deterministically).
    let k = 0;
    const pieces = map.pieces.filter((p) => !DECORATIVE.test(p.name) || ((k++ * 0.618034) % 1) < foliage);
    return buildInstancedMeshes(pieces, kits);
  }, [map, kits, foliage]);

  useEffect(() => () => meshes.forEach((m) => m.dispose()), [meshes]);

  useEffect(() => {
    const anisotropy = Math.min(p.textureAnisotropy, gl.capabilities.getMaxAnisotropy());
    const seen = new Set<THREE.Texture>();
    for (const kit of Object.values(kits)) for (const piece of kit!.values()) for (const part of piece.parts) {
      const material = part.material as THREE.MeshStandardMaterial;
      for (const texture of [material.map, material.normalMap, material.aoMap, material.roughnessMap, material.metalnessMap]) {
        if (!texture || seen.has(texture)) continue;
        seen.add(texture);
        if (texture.anisotropy !== anisotropy) { texture.anisotropy = anisotropy; texture.needsUpdate = true; }
      }
    }
  }, [kits, gl, p.textureAnisotropy]);

  // Cull only non-colliding decoration. Walls, cover and enemy visibility stay identical.
  useFrame(({ gl, scene, camera }, dt) => {
    // Warm up once the world, sky environment and light setup are final (and again if they
    // change), so nothing compiles or uploads mid-fight.
    const w = warmed.current;
    if (!w || w.meshes !== meshes || w.env !== scene.environment || w.shadows !== p.shadows || w.anisotropy !== p.textureAnisotropy) {
      warmed.current = { meshes, env: scene.environment, shadows: p.shadows, anisotropy: p.textureAnisotropy };
      warmUp(gl, scene, camera, meshes);
    }
    cullTimer.current -= dt;
    if (cullTimer.current > 0) return;
    cullTimer.current = 0.2;
    for (const mesh of meshes) {
      if (!mesh.userData.decorative || !mesh.boundingSphere) continue;
      const sphere = mesh.boundingSphere;
      const distance = p.decorationDistance + sphere.radius;
      const dx = sphere.center.x - camera.position.x, dz = sphere.center.z - camera.position.z;
      mesh.visible = dx * dx + dz * dz <= distance * distance;
    }
  });

  return (
    <group>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} dispose={null} />
      ))}
    </group>
  );
}

/**
 * Uploads every world texture and compiles every world shader now. Otherwise three does both
 * the first time an object enters the view, which on integrated GPUs (ANGLE / D3D11) shows as
 * a 50-100 ms hitch when turning a corner. Runs while the deploy menu is still open.
 */
function warmUp(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, meshes: THREE.InstancedMesh[]) {
  const seen = new Set<THREE.Texture>();
  for (const mesh of meshes) {
    const m = mesh.material as THREE.MeshStandardMaterial;
    for (const t of [m.map, m.normalMap, m.aoMap, m.roughnessMap, m.metalnessMap, m.alphaMap]) {
      if (t && !seen.has(t)) { seen.add(t); gl.initTexture(t); }
    }
  }
  // compile() skips hidden objects; include decoration currently culled by distance.
  const hidden = meshes.filter((m) => !m.visible);
  hidden.forEach((m) => (m.visible = true));
  void gl.compileAsync(scene, camera).catch(() => { /* compiled on first use instead */ });
  hidden.forEach((m) => (m.visible = false));
}

function tuneMaterials(kits: Kit[]) {
  const seen = new Set<THREE.Material>();
  for (const kit of kits)
    for (const piece of kit.values())
      for (const part of piece.parts) {
        const m = part.material as THREE.MeshStandardMaterial;
        if (seen.has(m)) continue;
        seen.add(m);
        m.envMapIntensity = 1;
        if (/Leaves|Leaf|Grass|Flowers|Vine|Pine/i.test(m.name)) {
          m.alphaTest = Math.max(m.alphaTest, 0.45);
          m.transparent = false;
          m.side = THREE.DoubleSide;
          m.shadowSide = THREE.DoubleSide;
          applyWind(m, /Grass|Flowers/i.test(m.name) ? 0.09 : 0.004);
          // Grass vertex colors are a wind mask in the source engines; as color they just darken it.
          if (/Grass/i.test(m.name)) m.vertexColors = false;
        }
        // City street markings are coplanar with the asphalt of neighboring tiles.
        if (/StreetDecals/i.test(m.name)) {
          m.polygonOffset = true;
          m.polygonOffsetFactor = -2;
          m.polygonOffsetUnits = -4;
          m.depthWrite = false;
        }
        if (/Glass/i.test(m.name)) {
          m.roughness = 0.08;
          m.metalness = 0.2;
        }
      }
}
