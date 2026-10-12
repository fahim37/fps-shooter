import * as THREE from "three";

type Obstruction = (origin: THREE.Vector3, direction: THREE.Vector3, distance: number) => number | null;

/** A short death view followed by a cut to a collision-checked killer close-up. */
export class DeathCamera {
  private elapsed = 0;
  private focused = false;
  private target: THREE.Vector3 | null = null;
  private side = new THREE.Vector3(0, 0, 1);
  private following = false;

  start(victim: THREE.Vector3, killer: THREE.Vector3 | null) {
    this.elapsed = 0;
    this.focused = false;
    this.following = !!killer;
    this.target = killer?.clone() ?? null;
    this.side.copy(victim).sub(killer ?? victim).setY(0);
    if (this.side.lengthSq() < 0.01) this.side.set(0, 0, 1);
    this.side.normalize();
  }

  update(camera: THREE.PerspectiveCamera, dt: number, corpse: THREE.Vector3, yaw: number, liveHead: THREE.Vector3 | null, obstruction: Obstruction) {
    this.elapsed += dt;
    // Freeze on elimination, disconnect, or a respawn teleport; never follow a new life.
    if (this.following && liveHead && this.target && liveHead.distanceToSquared(this.target) < 64) this.target.copy(liveHead);
    else this.following = false;
    const closeup = !!this.target && this.elapsed >= 0.65;
    const pivot = closeup ? this.target! : corpse;
    const offset = closeup
      ? this.side.clone().multiplyScalar(4).add(new THREE.Vector3(this.side.z * 0.8, 0.7, -this.side.x * 0.8))
      : new THREE.Vector3(0, 0.8, 2.8).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    const length = offset.length();
    offset.normalize();
    const wall = obstruction(pivot, offset, length);
    const desired = pivot.clone().addScaledVector(offset, wall === null ? length : Math.max(0, wall - 0.25));
    if (closeup && !this.focused) camera.position.copy(desired);
    else {
      camera.position.lerp(desired, 1 - Math.exp(-dt * 8));
      // Recheck smoothing as well, so moving around corners cannot place the camera in cover.
      const ray = camera.position.clone().sub(pivot);
      const distance = ray.length();
      if (distance > 0.001) {
        ray.normalize();
        const hit = obstruction(pivot, ray, distance);
        if (hit !== null) camera.position.copy(pivot).addScaledVector(ray, Math.max(0, hit - 0.25));
      }
    }
    const lookAt = this.target ? this.target.clone().add(new THREE.Vector3(0, closeup ? -0.5 : 0, 0)) : corpse;
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(camera.position, lookAt, camera.up));
    camera.quaternion.slerp(rotation, closeup && !this.focused ? 1 : 1 - Math.exp(-dt * 9));
    this.focused = closeup;
    return this.target ? this.following ? "killer" : "last-position" : "environment";
  }

  marker(camera: THREE.PerspectiveCamera) {
    if (!this.target) return null;
    camera.updateMatrixWorld();
    const point = this.target.clone().add(new THREE.Vector3(0, 0.4, 0)).project(camera);
    if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 0.9 || Math.abs(point.y) > 0.8) return null;
    return { x: (point.x + 1) * 50, y: (1 - point.y) * 50 };
  }
}
