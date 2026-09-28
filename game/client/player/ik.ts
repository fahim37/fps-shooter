import * as THREE from "three";

const _qp = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Applies a world-space rotation `delta` on top of the bone's current world rotation. */
export function rotateBoneWorld(bone: THREE.Object3D, delta: THREE.Quaternion) {
  bone.getWorldQuaternion(_qw);
  bone.parent!.getWorldQuaternion(_qp);
  _qw.premultiply(delta);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}

/** Sets a bone's world rotation. */
export function setBoneWorldQuaternion(bone: THREE.Object3D, q: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK (shoulder → elbow → wrist). Moves the wrist to `target` with the elbow
 * bending toward `pole`. `weight` blends from the animated pose (0) to the solution (1).
 */
export function solveTwoBone(
  upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D,
  target: THREE.Vector3, pole: THREE.Vector3, weight = 1,
) {
  if (weight <= 0) return;
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const la = _a.distanceTo(_b), lb = _b.distanceTo(_c);
  _t.copy(end.getWorldPosition(_t)).lerp(target, weight);

  const toT = _d1.subVectors(_t, _a);
  let dist = toT.length();
  const maxReach = la + lb - 1e-3, minReach = Math.abs(la - lb) + 1e-3;
  if (dist > maxReach || dist < minReach) {
    dist = THREE.MathUtils.clamp(dist, minReach, maxReach);
    _t.copy(_a).addScaledVector(toT.normalize(), dist);
  }
  const dirAT = _d1.subVectors(_t, _a).normalize();
  const cosA = THREE.MathUtils.clamp((la * la + dist * dist - lb * lb) / (2 * la * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _pole.subVectors(pole, _a);
  _pole.addScaledVector(dirAT, -_pole.dot(dirAT));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, -1, 0);
  _pole.normalize();
  _elbow.copy(_a).addScaledVector(dirAT, cosA * la).addScaledVector(_pole, sinA * la);

  // Upper bone: swing its current direction onto the elbow.
  _d2.subVectors(_b, _a).normalize();
  _q.setFromUnitVectors(_d2, _elbow.clone().sub(_a).normalize());
  rotateBoneWorld(upper, _q);

  // Lower bone: swing onto the target.
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  _q.setFromUnitVectors(_d2.subVectors(_c, _b).normalize(), _d1.subVectors(_t, _b).normalize());
  rotateBoneWorld(lower, _q);
}
