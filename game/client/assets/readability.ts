import * as THREE from "three";

const originals = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
const variants = new WeakMap<THREE.Material, THREE.Material>();

const touchVariants = new WeakMap<THREE.Material, THREE.Material>();

export type EnemyReadability = false | true | "touch";

function readableMaterial(source: THREE.Material, touch: boolean) {
  const cache = touch ? touchVariants : variants;
  let material = cache.get(source);
  if (material) return material;
  material = source.clone();
  const compile = source.onBeforeCompile;
  const key = source.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(source, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", touch ? `
      // At range a soldier may cover only a few pixels. Carry the enemy tint across
      // the visible outfit so it survives texture minification and low render resolution.
      float farTint = smoothstep(12.0, 48.0, vViewPosition.z);
      outgoingLight = mix(max(outgoingLight, diffuseColor.rgb * 0.28),
                          vec3(0.82, 0.115, 0.046), farTint * 0.52);
      #include <opaque_fragment>
    ` : `
      // Keep textured silhouettes legible in shade, in the existing character draw.
      float visibilityRim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 4.0);
      outgoingLight = max(outgoingLight, diffuseColor.rgb * 0.28);
      outgoingLight += vec3(0.18, 0.045, 0.015) * visibilityRim;
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => touch ? `${key}:touch-enemy-readability-v1` : `${key}:low-enemy-readability-v2`;
  // Keep normal depth testing and fog: the accent never reveals players through cover.
  cache.set(source, material);
  return material;
}

/** Swap cached shader variants only when graphics or team relation changes. */
export function setEnemyReadability(meshes: THREE.Mesh[], enabled: EnemyReadability) {
  for (const mesh of meshes) {
    let source = originals.get(mesh);
    if (!source) { source = mesh.material; originals.set(mesh, source); }
    // Only the soldier's own materials (body and arms atlases); anything else keeps its lighting.
    const outfit = (material: THREE.Material) => /^Soldier_/.test(material.name) ? readableMaterial(material, enabled === "touch") : material;
    mesh.material = !enabled ? source : Array.isArray(source) ? source.map(outfit) : outfit(source);
  }
}
