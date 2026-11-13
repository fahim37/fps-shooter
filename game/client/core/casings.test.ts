import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Casings, MAX_CASINGS } from "./casings";

const BRASS = { radius: 0.005, length: 0.045, color: "#c9a043" };
const steady = () => 0.5;

function run(casings: Casings, seconds: number, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) casings.update(1 / fps);
}

function positions(casings: Casings) {
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  return Array.from({ length: casings.mesh.count }, (_, i) => { casings.mesh.getMatrixAt(i, m); return p.setFromMatrixPosition(m).clone(); });
}

describe("spent cases", () => {
  it("fly out to the gun's right and come to rest on the floor", () => {
    const casings = new Casings();
    // Gun turned to face +X: its right is +Z.
    const gun = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    casings.eject(new THREE.Vector3(0, 1.4, 0), gun, new THREE.Vector3(), BRASS, 0, steady);
    run(casings, 0.05);
    expect(positions(casings)[0].z).toBeGreaterThan(0.05);
    run(casings, 1.5);
    const [rest] = positions(casings);
    expect(rest.y).toBeCloseTo(BRASS.radius, 5);
    expect(rest.z).toBeGreaterThan(0.3);
    run(casings, 0.05);
    expect(positions(casings)[0].distanceTo(rest)).toBeLessThan(1e-9);
    run(casings, 1);
    expect(casings.mesh.count).toBe(0);
    expect(casings.mesh.visible).toBe(false);
  });

  it("carry the shooter's speed, so running doesn't throw them backwards", () => {
    const still = new Casings(), running = new Casings();
    still.eject(new THREE.Vector3(0, 1.4, 0), new THREE.Quaternion(), new THREE.Vector3(), BRASS, 0, steady);
    running.eject(new THREE.Vector3(0, 1.4, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, -6), BRASS, 0, steady);
    run(still, 0.1); run(running, 0.1);
    expect(positions(running)[0].z).toBeLessThan(positions(still)[0].z - 0.4);
  });

  it("never show more than the graphics setting allows, and none on a zero budget", () => {
    const casings = new Casings();
    casings.setLimit(6);
    for (let i = 0; i < 30; i++) casings.eject(new THREE.Vector3(0, 1.4, 0), new THREE.Quaternion(), new THREE.Vector3(), BRASS, 0);
    run(casings, 0.02);
    expect(casings.mesh.count).toBe(6);
    casings.setLimit(0);
    casings.eject(new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3(), BRASS, 0);
    run(casings, 0.02);
    expect(casings.mesh.count).toBe(0);
    casings.setLimit(MAX_CASINGS * 2);
    for (let i = 0; i < MAX_CASINGS * 2; i++) casings.eject(new THREE.Vector3(0, 1.4, 0), new THREE.Quaternion(), new THREE.Vector3(), BRASS, 0);
    run(casings, 0.02);
    expect(casings.mesh.count).toBe(MAX_CASINGS);
  });
});
