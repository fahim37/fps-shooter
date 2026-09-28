"use client";

import { use, useEffect, useMemo } from "react";
import * as THREE from "three";
import { loadKit } from "../assets/kits";
import { buildInstancedMeshes } from "./instances";
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

const DECORATIVE = /^(Grass_|Flower_|Clover|Fern|Plant_|Pebble_|Mushroom)/;

/** Renders every static map piece with GPU instancing. */
export function StaticWorld({ map }: { map: MapData }) {
  const kits = use(loadAllKits());
  const foliage = useSettings((s) => PRESETS[s.quality].foliage);

  const meshes = useMemo(() => {
    // Thin out decorative foliage on lower quality settings (deterministically).
    let k = 0;
    const pieces = map.pieces.filter((p) => !DECORATIVE.test(p.name) || ((k++ * 0.618034) % 1) < foliage);
    return buildInstancedMeshes(pieces, kits);
  }, [map, kits, foliage]);

  useEffect(() => () => meshes.forEach((m) => m.dispose()), [meshes]);

  return (
    <group>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
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
