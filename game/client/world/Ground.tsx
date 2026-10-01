"use client";

import { Suspense, use, useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { loadTexture } from "../assets/loaders";
import { PRESETS, useSettings } from "../settings";

const SIZE = 300;
const TILE = 3.2; // meters per texture repeat

const textureSets = new Map<boolean, Promise<THREE.Texture[]>>();
function texturesPromise(detail: boolean) {
  let cached = textureSets.get(detail);
  if (!cached) {
    cached = Promise.all([
      loadTexture("/env/aerial_grass_rock_diff.jpg"),
      ...(detail ? [
        loadTexture("/env/aerial_grass_rock_nor.jpg", false),
        loadTexture("/env/aerial_grass_rock_arm.jpg", false),
        loadTexture("/env/forrest_ground_01_diff.jpg"),
        loadTexture("/env/noise_terrain.png", false),
      ] : []),
    ]);
    textureSets.set(detail, cached);
  }
  return cached;
}

const GRADE = `
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 green = mix(vec3(0.075, 0.15, 0.03), vec3(0.26, 0.40, 0.08), smoothstep(0.02, 0.22, lum));
  diffuseColor.rgb = mix(green, diffuseColor.rgb, 0.18);`;

/**
 * Grass ground with macro variation: a large-scale noise blends in forest-floor dirt and
 * breaks up the tiling, which is what makes a flat plane read as terrain.
 */
export function Ground() {
  const detail = useSettings((s) => PRESETS[s.quality].terrainDetail);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute("uv1", g.attributes.uv);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} receiveShadow dispose={null}>
    {/* Keep the terrain and match mounted when detailed textures load after a live change. */}
    <Suspense fallback={<meshStandardMaterial color="#52663e" roughness={1} />}>
      <TerrainMaterial detail={detail} />
    </Suspense>
  </mesh>;
}

function TerrainMaterial({ detail }: { detail: boolean }) {
  const [diff, nor, arm, dirt, noise] = use(texturesPromise(detail));
  const anisotropy = useSettings((s) => PRESETS[s.quality].textureAnisotropy);
  const gl = useThree((s) => s.gl);
  const material = useMemo(() => {
    for (const t of [diff, nor, arm, dirt]) t?.repeat.set(SIZE / TILE, SIZE / TILE);
    const m = new THREE.MeshStandardMaterial({
      map: diff,
      normalMap: nor ?? null,
      normalScale: new THREE.Vector2(0.8, 0.8),
      aoMap: arm ?? null,
      roughnessMap: arm ?? null,
      metalness: 0,
      roughness: 1,
    });
    m.customProgramCacheKey = () => detail ? "terrain-detail" : "terrain-simple";
    m.onBeforeCompile = (shader) => {
      if (!detail) {
        shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>\n${GRADE}`);
        return;
      }
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
          ${GRADE}
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.15, 1.0, 0.7), n2 * 0.3);
          float dirtMix = smoothstep(0.62, 0.86, n * 0.7 + n2 * 0.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, dirtCol * 0.9, dirtMix * 0.65);
          diffuseColor.rgb *= mix(0.88, 1.08, n2);`,
        );
    };
    return m;
  }, [detail, diff, nor, arm, dirt, noise]);

  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    const value = Math.min(anisotropy, gl.capabilities.getMaxAnisotropy());
    for (const texture of [diff, nor, arm, dirt]) {
      if (!texture || texture.anisotropy === value) continue;
      texture.anisotropy = value;
      texture.needsUpdate = true;
    }
  }, [anisotropy, gl, diff, nor, arm, dirt]);

  return <primitive object={material} attach="material" dispose={null} />;
}
