import * as THREE from "three";
import { GRENADE_BODY, GRENADE_STEP_HZ } from "../../shared/grenade";

type V3 = [number, number, number];

/** The frag's body in the hand: its half-height is what the world model scales up to the ball's radius. */
const BODY_RADIUS = 0.034, BODY_STRETCH = 1.18;
/** In the world the model matches the physics ball, so it rests on the ground and reads at range. */
const WORLD_SCALE = GRENADE_BODY.radius / (BODY_RADIUS * BODY_STRETCH);
/** How long a throw takes to grow from hand size to world size. */
const GROW_MS = 250;
/** Your own throw follows its predicted path this long, hiding the trip to the server and back. */
const PREDICT_MS = 220;
/** A predicted throw the server never confirms is dropped after this. */
const UNCONFIRMED_MS = 900;
/** Your own grenade only warns you once it has had time to leave and come back. */
const OWN_WARNING_MS = 1200;
const MAX_SPIN = 20;

const _target = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _turn = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** The olive body and steel fuse cap shared by the grenade in the hand and in the world. */
export function createGrenadeParts() {
  const steel = new THREE.MeshStandardMaterial({ color: "#8a8d86", roughness: 0.4, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(BODY_RADIUS, 14, 10), new THREE.MeshStandardMaterial({ color: "#4e593c", roughness: 0.65 }));
  body.scale.set(1, BODY_STRETCH, 1);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.022, 10), steel);
  cap.position.y = 0.045;
  return { body, cap, steel };
}

interface Shown {
  model: THREE.Group;
  bornAt: number;
  owner: string;
  /** Where the server has it; null until it confirms a predicted throw. */
  target: THREE.Vector3 | null;
  /** The predicted flight of your own throw, one point per physics step. */
  path: V3[] | null;
  last: THREE.Vector3;
}

/** Live grenades in the world: your own from the moment it leaves the hand, everyone's from the server. */
export class ThrownGrenades {
  private template = new THREE.Group();
  private shown = new Map<string, Shown>();
  /** Your throws the server hasn't confirmed yet, oldest first. */
  private predicted: Shown[] = [];

  constructor(private scene: THREE.Scene) {
    const { body, cap } = createGrenadeParts();
    this.template.add(body, cap);
  }

  private add(position: THREE.Vector3, now: number, owner: string, path: V3[] | null): Shown {
    const model = this.template.clone();
    model.position.copy(position);
    model.scale.setScalar(path ? 1 : WORLD_SCALE);
    this.scene.add(model);
    return { model, bornAt: now, owner, target: null, path, last: position.clone() };
  }

  /** Shows your own throw at once, along `points`. */
  predict(points: V3[], now: number, owner: string) {
    this.predicted.push(this.add(_target.set(...points[0]), now, owner, points));
  }

  update(dt: number, now: number, live: { forEach(fn: (g: { owner: string; x: number; y: number; z: number }, id: string) => void): void; has(id: string): boolean } | undefined, self: string) {
    live?.forEach((g, id) => {
      let s = this.shown.get(id);
      if (!s) {
        s = (g.owner === self ? this.predicted.shift() : undefined) ?? this.add(_target.set(g.x, g.y, g.z), now, g.owner, null);
        this.shown.set(id, s);
      }
      (s.target ??= new THREE.Vector3()).set(g.x, g.y, g.z);
    });
    for (const [id, s] of this.shown) {
      if (live?.has(id)) this.move(s, dt, now);
      else { s.model.removeFromParent(); this.shown.delete(id); }
    }
    this.predicted = this.predicted.filter((s) => {
      if (now - s.bornAt < UNCONFIRMED_MS) { this.move(s, dt, now); return true; }
      s.model.removeFromParent();
      return false;
    });
  }

  private move(s: Shown, dt: number, now: number) {
    const age = now - s.bornAt, { model, path, target } = s;
    if (path && (!target || age < PREDICT_MS)) {
      model.position.set(...path[Math.min(path.length - 1, Math.round(age / 1000 * GRENADE_STEP_HZ))]);
    } else if (target) {
      // A predicted throw eases over to the server's grenade instead of snapping to it.
      const rate = path ? Math.min(25, 6 + (age - PREDICT_MS) * 0.04) : 25;
      model.position.lerp(target, Math.min(1, dt * rate));
    }
    if (path) model.scale.setScalar(THREE.MathUtils.lerp(1, WORLD_SCALE, Math.min(1, age / GROW_MS)));
    // It tumbles along its path, and comes to rest when it does.
    _axis.subVectors(model.position, s.last);
    const speed = _axis.length() / Math.max(dt, 1e-3);
    s.last.copy(model.position);
    if (speed < 0.2) return;
    _axis.cross(_up);
    if (_axis.lengthSq() < 1e-10) _axis.set(1, 0, 0);
    model.quaternion.premultiply(_turn.setFromAxisAngle(_axis.normalize().negate(), Math.min(MAX_SPIN, speed * 4) * dt));
  }

  /** The closest live grenade within `radius` of `from` that `threatens` you and can reach you. */
  nearest(from: V3, radius: number, now: number, self: string, threatens: (owner: string) => boolean, reaches: (at: V3) => boolean): V3 | null {
    let best: V3 | null = null, bestDistance = radius;
    for (const s of this.shown.values()) {
      if (!s.target || !threatens(s.owner) || (s.owner === self && now - s.bornAt < OWN_WARNING_MS)) continue;
      const at = s.target.toArray() as V3;
      const d = Math.hypot(at[0] - from[0], at[1] - from[1], at[2] - from[2]);
      if (d < bestDistance && reaches(at)) { best = at; bestDistance = d; }
    }
    return best;
  }

  dispose() {
    for (const s of [...this.shown.values(), ...this.predicted]) s.model.removeFromParent();
    this.shown.clear();
    this.predicted = [];
    this.template.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}
