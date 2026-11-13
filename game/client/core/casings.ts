import * as THREE from "three";

/** What a gun throws out of its ejection port: a brass case, or the shotgun's plastic hull. */
export interface CasingKind {
  /** Metres. */
  radius: number; length: number;
  color: THREE.ColorRepresentation;
}

/** Most cases in flight or on the floor at once, at the highest setting. */
export const MAX_CASINGS = 40;
/** How long a case stays (s), and the last part of that over which it shrinks away. */
const LIFE = 2.2, VANISH = 0.25;
const GRAVITY = 9.8;
/** Share of its fall speed a case bounces back with, and of its slide and spin it keeps. */
const BOUNCE = 0.35, SCUFF = 0.5;

interface Casing {
  pos: THREE.Vector3; vel: THREE.Vector3;
  rot: THREE.Quaternion; spinAxis: THREE.Vector3; spin: number;
  life: number; floor: number; bounces: number;
  radius: number; length: number; color: THREE.Color;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

/**
 * Spent cases flung from the ejection port: out to the right, up and a little back, tumbling end
 * over end, then bouncing and skittering on the floor before they go. One instanced draw for all
 * of them, nothing allocated per shot; the count is capped by the graphics setting.
 */
export class Casings {
  readonly mesh: THREE.InstancedMesh;
  private items: Casing[] = [];
  private next = 0;
  private limit = MAX_CASINGS;

  constructor() {
    // Unit case along Z; scaled per instance to its calibre.
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1).rotateX(Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: "#ffffff", metalness: 0.8, roughness: 0.35 });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_CASINGS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_CASINGS; i++) {
      this.items.push({
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Quaternion(), spinAxis: new THREE.Vector3(0, 1, 0), spin: 0,
        life: LIFE, floor: 0, bounces: 0, radius: 0, length: 0, color: new THREE.Color(),
      });
      this.mesh.setColorAt(i, this.items[i].color);
    }
  }

  setLimit(limit: number) {
    this.limit = Math.max(0, Math.min(MAX_CASINGS, limit));
    for (let i = this.limit; i < MAX_CASINGS; i++) this.items[i].life = LIFE;
    this.next %= Math.max(1, this.limit);
  }

  /**
   * A case leaves the port at `port` (world) of a gun turned `gun`, carried along at `carry`
   * (the shooter's velocity) and landing on a floor at height `floor`.
   */
  eject(port: THREE.Vector3, gun: THREE.Quaternion, carry: THREE.Vector3, kind: CasingKind, floor: number, random: () => number = Math.random) {
    if (this.limit === 0) return;
    const c = this.items[this.next];
    this.next = (this.next + 1) % this.limit;
    c.pos.copy(port);
    // Gun space: +X right, +Y up, +Z back toward the shooter.
    c.vel.set(1.5 + random() * 0.9, 0.9 + random() * 0.7, 0.25 + random() * 0.45).applyQuaternion(gun).add(carry);
    c.rot.copy(gun).multiply(_q.setFromAxisAngle(_v.set(0, 1, 0), Math.PI / 2 + (random() - 0.5) * 0.6));
    c.spinAxis.set(random() - 0.5, 1, random() - 0.5).normalize().applyQuaternion(gun);
    c.spin = 18 + random() * 16;
    c.life = 0; c.bounces = 0; c.floor = floor;
    c.radius = kind.radius; c.length = kind.length;
    c.color.set(kind.color);
  }

  update(dt: number) {
    let n = 0;
    for (let i = 0; i < this.limit; i++) {
      const c = this.items[i];
      if (c.life >= LIFE) continue;
      c.life += dt;
      if (c.life >= LIFE) continue;
      if (c.bounces < 3) {
        c.vel.y -= GRAVITY * dt;
        c.pos.addScaledVector(c.vel, dt);
        c.rot.premultiply(_q.setFromAxisAngle(c.spinAxis, c.spin * dt));
        if (c.pos.y < c.floor + c.radius) {
          c.pos.y = c.floor + c.radius;
          if (c.vel.y < 0) {
            c.vel.y *= -BOUNCE;
            c.vel.x *= SCUFF; c.vel.z *= SCUFF;
            c.spin *= SCUFF;
            c.bounces++;
            // Settled: it lies on its side where it stopped.
            if (c.bounces >= 3 || c.vel.y < 0.25) {
              c.bounces = 3;
              _v.set(0, 0, 1).applyQuaternion(c.rot).setY(0);
              if (_v.lengthSq() < 1e-6) _v.set(1, 0, 0);
              c.rot.setFromUnitVectors(_s.set(0, 0, 1), _v.normalize());
            }
          }
        }
      }
      const shrink = Math.min(1, (LIFE - c.life) / VANISH);
      _s.set(c.radius * 2 * shrink, c.radius * 2 * shrink, c.length * shrink);
      this.mesh.setMatrixAt(n, _m.compose(c.pos, c.rot, _s));
      this.mesh.setColorAt(n, c.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
