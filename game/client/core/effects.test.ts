import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Effects } from "./effects";

// Canvas drawing is cosmetic here: exercise the actual Three scene objects,
// simulation, finite transforms and resource bounds without requiring a GPU.
function canvasDocument() {
  const context = new Proxy({}, {
    get: (_target, name) => name === "createRadialGradient" || name === "createLinearGradient"
      ? () => ({ addColorStop() {} }) : () => {},
    set: () => true,
  });
  return { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
}

afterEach(() => vi.unstubAllGlobals());

describe("combat effects", () => {
  it("keeps sustained combat bounded and retires transient effects after switching to Low", () => {
    vi.stubGlobal("document", canvasDocument());
    const effects = new Effects();
    const point = new THREE.Vector3(0, 1.5, -5);
    const direction = new THREE.Vector3(0, 0, -1);
    const normal = new THREE.Vector3(0, 0, 1);
    const origin = new THREE.Vector3(0, 1.5, 0);
    const objectCount = effects.group.children.length;
    try {
      for (let i = 0; i < 200; i++) {
        effects.blood(point, direction, i % 2 === 0);
        effects.bloodSplatter(point, normal, i % 2 === 0);
        effects.muzzleFlash(origin, direction);
        effects.tracer(origin, point);
        effects.explosion(point);
        effects.update(1 / 120);
      }
      effects.setQuality("low");
      effects.update(1 / 60);
      expect(effects.group.children.length).toBe(objectCount);
      const particleSystems = effects.group.children.filter((o): o is THREE.Points => o instanceof THREE.Points);
      const counts = particleSystems.map((p) => p.geometry.drawRange.count);
      expect(counts.every((count, i) => count > 0 && count <= [140, 90, 64][i])).toBe(true);
      const lights = effects.group.children.filter((o): o is THREE.PointLight => o instanceof THREE.PointLight);
      expect(lights.every((light) => light.intensity === 0 && !light.visible)).toBe(true);
      effects.group.updateMatrixWorld(true);
      expect(effects.group.children.every((object) => object.matrixWorld.elements.every(Number.isFinite))).toBe(true);

      effects.update(10);
      expect(particleSystems.every((p) => !p.visible)).toBe(true);
      expect(effects.group.children.filter((o) => o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)).every((o) => !o.visible)).toBe(true);
      effects.setQuality("ultra");
      effects.blood(point, direction, true);
      effects.tracer(origin, point);
      effects.update(1 / 60);
      expect(effects.group.children.length).toBe(objectCount);
      expect(particleSystems[2].visible).toBe(true);
    } finally { effects.dispose(); }
    expect(effects.group.children).toHaveLength(0);
  });

  it("fades actual surface splatter and does not resurrect it when raising quality", () => {
    vi.stubGlobal("document", canvasDocument());
    const effects = new Effects();
    try {
      effects.setQuality("low");
      effects.bloodSplatter(new THREE.Vector3(0, 1.5, -5), new THREE.Vector3(0, 0, 1));
      const stain = effects.group.children.find((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh && o.geometry.hasAttribute("aDecalOpacity"))!;
      expect(stain.visible).toBe(true);
      expect(stain.count).toBe(12);
      effects.update(10);
      expect(stain.visible).toBe(false);
      expect(stain.geometry.getAttribute("aDecalOpacity").getX(0)).toBe(0);
      effects.setQuality("ultra");
      effects.update(1 / 60);
      expect(stain.visible).toBe(false);
    } finally { effects.dispose(); }
  });
});
