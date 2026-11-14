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
  it("keeps close-range trails visible across frames, clips them to impact and fades them out", () => {
    vi.stubGlobal("document", canvasDocument());
    const effects = new Effects();
    try {
      const from = new THREE.Vector3(0, 1.5, 0), to = new THREE.Vector3(0, 1.5, -2);
      effects.tracer(from, to, "enemy");
      effects.update(1 / 30);
      const streaks = effects.group.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible && o.geometry instanceof THREE.CylinderGeometry);
      expect(streaks).toHaveLength(2);
      for (const mesh of streaks) {
        expect(mesh.position.z).toBe(-2);
        expect(mesh.scale.z).toBeLessThanOrEqual(2);
        expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0);
      }
      effects.update(0.2);
      expect(streaks.every((mesh) => !mesh.visible)).toBe(true);
      effects.tracer(new THREE.Vector3(4, 1.5, 0), new THREE.Vector3(4, 1.5, -20), "friendly");
      const recycled = effects.group.children.filter((o) => o instanceof THREE.Mesh && o.visible && o.geometry instanceof THREE.CylinderGeometry);
      expect(recycled.every((mesh) => mesh.position.x === 4)).toBe(true);
    } finally { effects.dispose(); }
  });
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

  it("leaves a ribbon along a dash that hangs, dissolves from the start and is gone", () => {
    vi.stubGlobal("document", canvasDocument());
    const effects = new Effects();
    try {
      const eye = new THREE.Vector3(0, 1.6, 12), from = new THREE.Vector3(-5, 0, 0), pos = new THREE.Vector3();
      const objectCount = effects.group.children.length;
      // A dash of about ten metres along +x, as other players see it: 46 m/s for 0.21 s.
      for (let i = 1; i <= 13; i++) {
        effects.dashRibbon("enemy", pos.set(-5 + i * 0.77, 0, 0), from);
        effects.update(1 / 60, eye);
      }
      const ribbon = effects.group.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible && o.geometry.hasAttribute("color"))!;
      expect(ribbon).toBeDefined();
      expect(effects.group.children.length).toBe(objectCount);
      const position = ribbon.geometry.getAttribute("position"), color = ribbon.geometry.getAttribute("color");
      const points = ribbon.geometry.drawRange.count / 6 + 1;
      const middle = (i: number) => (position.getX(i * 2) + position.getX(i * 2 + 1)) / 2;
      const alphas = () => Array.from({ length: points }, (_, i) => color.getW(i * 2));
      // It spans the whole dash, start to finish, at chest height and wide enough to make out.
      expect(middle(0)).toBeCloseTo(-5);
      expect(middle(points - 1)).toBeCloseTo(-5 + 13 * 0.77);
      expect(Math.abs(position.getY(points) - position.getY(points + 1))).toBeGreaterThan(0.7);
      expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
      // Clearly visible along its length, brightest toward where the player went, soft at both ends.
      const fresh = alphas();
      expect(fresh[0]).toBe(0);
      expect(fresh[points - 1]).toBe(0);
      expect(fresh[1]).toBeGreaterThan(0.4);
      expect(fresh[points - 2]).toBeGreaterThan(fresh[1]);

      // It hangs briefly after the dash; the start goes first, so what is left points to where they are.
      effects.update(0.3, eye);
      expect(ribbon.visible).toBe(true);
      const aged = alphas();
      expect(aged[1]).toBe(0);
      expect(aged[points - 2]).toBeGreaterThan(0.5);
      effects.update(0.3, eye);
      expect(ribbon.visible).toBe(false);

      // More dashes at once than ribbons: none is taken from a dash still under way.
      for (let i = 0; i < 12; i++) effects.dashRibbon(`p${i}`, pos.set(i, 0, 3), from);
      effects.update(1 / 60, eye);
      expect(effects.group.children.length).toBe(objectCount);
      expect(effects.group.children.filter((o) => o instanceof THREE.Mesh && o.visible && o.geometry.hasAttribute("color"))).toHaveLength(8);
    } finally { effects.dispose(); }
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
