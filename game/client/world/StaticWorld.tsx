"use client";

/* eslint-disable react-hooks/immutability -- Instanced meshes and cached kit textures are imperative Three objects. */

import { use, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { loadKit } from "../assets/kits";
import { buildInstancedMeshes, DECORATIVE } from "./instances";
import { applyWind } from "./wind";
import type { MapData } from "../../shared/map/types";
import { useSettings, PRESETS } from "../settings";

const kitsPromise = () =>
  Promise.all([loadKit("village"), loadKit("nature"), loadKit("props")]).then(([village, nature, props]) => {
    tuneMaterials([village, nature, props]);
    return { village, nature, props };
  });
let cached: ReturnType<typeof kitsPromise> | null = null;
export const loadAllKits = () => (cached ??= kitsPromise());

/** Renders every static map piece with GPU instancing. */
export function StaticWorld({ map }: { map: MapData }) {
  const kits = use(loadAllKits());
  const quality = useSettings((s) => s.quality);
  const p = PRESETS[quality];
  const { foliage } = p;
  const gl = useThree((s) => s.gl);
  const cullTimer = useRef(0);

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
    for (const kit of Object.values(kits)) for (const piece of kit.values()) for (const part of piece.parts) {
      const material = part.material as THREE.MeshStandardMaterial;
      for (const texture of [material.map, material.normalMap, material.aoMap, material.roughnessMap, material.metalnessMap]) {
        if (!texture || seen.has(texture)) continue;
        seen.add(texture);
        if (texture.anisotropy !== anisotropy) { texture.anisotropy = anisotropy; texture.needsUpdate = true; }
      }
    }
  }, [kits, gl, p.textureAnisotropy]);

  // Cull only non-colliding decoration. Walls, cover and enemy visibility stay identical.
  useFrame(({ camera }, dt) => {
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

function tuneMaterials(kits: Map<string, { parts: { material: THREE.Material }[] }>[]) {
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
        if (/Glass/i.test(m.name)) {
          m.roughness = 0.08;
          m.metalness = 0.2;
        }
      }
}
