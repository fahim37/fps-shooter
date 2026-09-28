import * as THREE from "three";

/** Shared time uniform for all foliage; advanced once per frame by <SkyAndSun>. */
export const windUniforms = { uWindTime: { value: 0 } };

const patched = new WeakSet<THREE.Material>();

/**
 * Makes foliage sway: vertices move sideways proportionally to their height above the
 * piece origin, with a phase that varies across the world so fields ripple.
 */
export function applyWind(material: THREE.Material, strength: number) {
  if (patched.has(material)) return;
  patched.add(material);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uWindTime = windUniforms.uWindTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWindTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 wBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 wBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
          float wH = max(position.y, 0.0);
          float wPhase = uWindTime * 1.7 + wBase.x * 0.21 + wBase.z * 0.17;
          float wSway = (sin(wPhase) * 0.6 + sin(wPhase * 2.3 + 1.3) * 0.25) * ${strength.toFixed(4)} * wH * wH;
          transformed.x += wSway;
          transformed.z += wSway * 0.6;`,
      );
  };
  material.customProgramCacheKey = () => `wind${strength}`;
  material.needsUpdate = true;
}
