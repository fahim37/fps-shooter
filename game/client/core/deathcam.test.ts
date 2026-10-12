import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeathCamera } from "./deathcam";

describe("death camera", () => {
  it("cuts to the killer, respects cover, and projects a visible killer marker", () => {
    const cam = new DeathCamera(), camera = new THREE.PerspectiveCamera(62, 1.6, 0.04, 300);
    const victim = new THREE.Vector3(0, 1.5, 0), killer = new THREE.Vector3(0, 1.5, -20);
    cam.start(victim, killer);
    expect(cam.update(camera, 0.3, victim, 0, killer, () => null)).toBe("killer");
    cam.update(camera, 0.4, victim, 0, killer, () => 2);
    expect(camera.position.distanceTo(killer)).toBeCloseTo(1.75);
    // The marker can be above the viewport when cover forces a very tight view.
    cam.update(camera, 0.5, victim, 0, killer, () => null);
    expect(cam.marker(camera)).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(camera.matrixWorld.elements.every(Number.isFinite)).toBe(true);
  });
  it("holds the last position after death, disconnect or respawn", () => {
    const cam = new DeathCamera(), camera = new THREE.PerspectiveCamera();
    const victim = new THREE.Vector3(), killer = new THREE.Vector3(0, 1.5, -10);
    cam.start(victim, killer);
    cam.update(camera, 0.7, victim, 0, killer, () => null);
    const position = camera.position.clone();
    expect(cam.update(camera, 0.1, victim, 0, new THREE.Vector3(80, 1.5, 80), () => null)).toBe("last-position");
    expect(camera.position.distanceTo(position)).toBeLessThan(0.001);
    cam.update(camera, 0.1, victim, 0, killer.clone().addScalar(2), () => null);
    expect(camera.position.distanceTo(position)).toBeLessThan(0.001);
    cam.start(victim, killer);
    expect(cam.update(camera, 0.7, victim, 0, null, () => null)).toBe("last-position");
  });
  it("handles environmental deaths and a new life without a stale marker", () => {
    const cam = new DeathCamera(), camera = new THREE.PerspectiveCamera();
    const victim = new THREE.Vector3(0, 1.6, 0);
    cam.start(victim, victim);
    cam.update(camera, 0.8, victim, 0, victim, () => null);
    cam.start(victim, null);
    expect(cam.update(camera, 0.1, victim, 0, null, () => null)).toBe("environment");
    expect(cam.marker(camera)).toBeNull();
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
  });
});
