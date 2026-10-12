import * as THREE from "three";

const originals = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
const variants = new WeakMap<THREE.Material, THREE.Material>();

function readableMaterial(source: THREE.Material) {
  let material = variants.get(source);
  if (material) return material;
  material = source.clone();
  const compile = source.onBeforeCompile;
  const key = source.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(source, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
      // Keep textured silhouettes legible in shade, in the existing character draw.
      float visibilityRim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 4.0);
      outgoingLight = max(outgoingLight, diffuseColor.rgb * 0.28);
      outgoingLight += vec3(0.18, 0.045, 0.015) * visibilityRim;
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => `${key}:low-enemy-readability-v2`;
  // Keep normal depth testing and fog: the accent never reveals players through cover.
  variants.set(source, material);
  return material;
}

/** Swap cached shader variants only when graphics or team relation changes. */
export function setEnemyReadability(meshes: THREE.Mesh[], enabled: boolean) {
  for (const mesh of meshes) {
    let source = originals.get(mesh);
    if (!source) { source = mesh.material; originals.set(mesh, source); }
    // Skin, eyes and hair retain their original lighting and color.
    const outfit = (material: THREE.Material) => /Ranger/i.test(material.name) ? readableMaterial(material) : material;
    mesh.material = !enabled ? source : Array.isArray(source) ? source.map(outfit) : outfit(source);
  }
}
