import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { setEnemyReadability } from "./readability";

describe("Low enemy visibility", () => {
  it("reuses materials, preserves team shaders and depth testing, and restores the original", () => {
    const original = new THREE.MeshStandardMaterial({ color: "#36502e" });
    original.name = "Ranger_Outfit";
    const compile = vi.fn((shader: { fragmentShader: string }) => { shader.fragmentShader = `// team tint\n${shader.fragmentShader}`; });
    original.onBeforeCompile = compile;
    original.customProgramCacheKey = () => "team2";
    const a = new THREE.Mesh(undefined, original), b = new THREE.Mesh(undefined, original);
    setEnemyReadability([a, b], true);
    expect(a.material).toBe(b.material);
    expect(a.material).not.toBe(original);
    expect(a.material.depthTest).toBe(true);
    expect(a.material.customProgramCacheKey()).toBe("team2:low-enemy-readability-v2");
    const shader = { fragmentShader: "#include <opaque_fragment>\n#include <fog_fragment>" } as THREE.WebGLProgramParametersWithUniforms;
    a.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(compile).toHaveBeenCalledOnce();
    expect(shader.fragmentShader).toContain("// team tint");
    expect(shader.fragmentShader).toContain("visibilityRim");
    expect(shader.fragmentShader).toContain("#include <fog_fragment>");
    setEnemyReadability([a], false);
    expect(a.material).toBe(original);
    const variant = b.material;
    setEnemyReadability([a], true);
    expect(a.material).toBe(variant);
  });
  it("keeps skin, hair and eyes on their original materials", () => {
    const meshes = ["Skin", "Hair", "Eyes"].map((name) => {
      const material = new THREE.MeshStandardMaterial();
      material.name = name;
      return new THREE.Mesh(undefined, material);
    });
    const original = meshes.map((mesh) => mesh.material);
    setEnemyReadability(meshes, true);
    expect(meshes.map((mesh) => mesh.material)).toEqual(original);
  });
});
