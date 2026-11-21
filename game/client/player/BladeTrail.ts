import * as THREE from "three";

/** The last 65 ms of the outer blade. One unlit strip, allocated on the first visible cut. */
export class BladeTrail {
  private positions = new Float32Array(8 * 6);
  private times = new Float64Array(8);
  private count = 0;
  private mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
    color: 0xb9daeb, side: THREE.DoubleSide, transparent: true, depthWrite: false, toneMapped: false,
  }));
  private inner = new THREE.Vector3();
  private outer = new THREE.Vector3();
  private inverse = new THREE.Quaternion();

  constructor(parent: THREE.Object3D) {
    const geometry = this.mesh.geometry;
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    const indices: number[] = [];
    for (let i = 0; i < 14; i += 2) indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    geometry.setIndex(indices);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.reset();
  }

  reset() {
    this.count = 0;
    this.mesh.visible = false;
  }

  update(base: THREE.Vector3, tip: THREE.Vector3, age: number, camera?: { eye?: THREE.Vector3; view?: THREE.Quaternion }) {
    if (this.count && age === this.times[this.count - 1]) return;
    if (this.count && age < this.times[this.count - 1]) this.reset();
    let expired = 0;
    while (expired < this.count && (age - this.times[expired] > 0.065 || this.count - expired >= this.times.length)) expired++;
    if (expired) {
      this.times.copyWithin(0, expired, this.count);
      this.positions.copyWithin(0, expired * 6, this.count * 6);
      this.count -= expired;
    }
    this.inner.lerpVectors(base, tip, 0.55);
    this.outer.copy(tip);
    if (camera?.eye && camera.view) {
      this.mesh.position.copy(camera.eye);
      this.mesh.quaternion.copy(camera.view);
      this.inverse.copy(camera.view).invert();
      this.inner.sub(camera.eye).applyQuaternion(this.inverse);
      this.outer.sub(camera.eye).applyQuaternion(this.inverse);
    }
    const offset = this.count * 6;
    this.inner.toArray(this.positions, offset);
    this.outer.toArray(this.positions, offset + 3);
    this.times[this.count++] = age;
    const movement = this.count > 1 ? this.outer.distanceTo(this.inner.fromArray(this.positions, offset - 3)) : 0;
    this.mesh.material.opacity = Math.min(0.21, movement * 1.8);
    this.mesh.visible = this.count > 1 && this.mesh.material.opacity > 0.003;
    this.mesh.geometry.setDrawRange(0, (this.count - 1) * 6);
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
