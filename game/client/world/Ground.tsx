"use client";

import { use, useMemo } from "react";
import * as THREE from "three";
import { loadTexture } from "../assets/loaders";

const SIZE = 300;
const TILE = 3.2; // meters per texture repeat

const texturesPromise = () =>
  Promise.all([
    loadTexture("/env/aerial_grass_rock_diff.jpg"),
    loadTexture("/env/aerial_grass_rock_nor.jpg", false),
    loadTexture("/env/aerial_grass_rock_arm.jpg", false),
    loadTexture("/env/forrest_ground_01_diff.jpg"),
    loadTexture("/env/noise_terrain.png", false),
  ]);

let cached: ReturnType<typeof texturesPromise> | null = null;

/**
 * Grass ground with macro variation: a large-scale noise blends in forest-floor dirt and
 * breaks up the tiling, which is what makes a flat plane read as terrain.
 */
export function Ground() {
  const [diff, nor, arm, dirt, noise] = use((cached ??= texturesPromise()));
  const material = useMemo(() => {
    for (const t of [diff, nor, arm, dirt]) t.repeat.set(SIZE / TILE, SIZE / TILE);
    const m = new THREE.MeshStandardMaterial({
      map: diff,
      normalMap: nor,
      normalScale: new THREE.Vector2(0.8, 0.8),
      aoMap: arm,
      roughnessMap: arm,
      metalness: 0,
      roughness: 1,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uDirt = { value: dirt };
      shader.uniforms.uNoise = { value: noise };
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D uDirt;\nuniform sampler2D uNoise;")
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          vec2 macroUv = vMapUv * ${(TILE / SIZE).toFixed(6)} * 3.0;
          float n = texture2D(uNoise, macroUv).r;
          float n2 = texture2D(uNoise, macroUv * 4.7 + 0.31).r;
          vec3 dirtCol = texture2D(uDirt, vMapUv * 0.9).rgb;
          // Grade the photo texture toward the kit's stylized green, keeping its detail.
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 green = mix(vec3(0.075, 0.15, 0.03), vec3(0.26, 0.40, 0.08), smoothstep(0.02, 0.22, lum));
          green = mix(green, green * vec3(1.15, 1.0, 0.7), n2);
          diffuseColor.rgb = mix(green, diffuseColor.rgb, 0.18);
          float dirtMix = smoothstep(0.62, 0.86, n * 0.7 + n2 * 0.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, dirtCol * 0.9, dirtMix * 0.65);
          diffuseColor.rgb *= mix(0.88, 1.08, n2);`,
        );
    };
    return m;
  }, [diff, nor, arm, dirt, noise]);

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute("uv1", g.attributes.uv);
    return g;
  }, []);

  return <mesh geometry={geometry} material={material} receiveShadow />;
}
