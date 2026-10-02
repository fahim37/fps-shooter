import * as THREE from "three";

const _qp = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _swing = new THREE.Vector3();
const EPSILON = 1e-6;

/** Applies a world-space rotation `delta` on top of the bone's current world rotation. */
export function rotateBoneWorld(bone: THREE.Object3D, delta: THREE.Quaternion, matricesCurrent = false) {
  if (!matricesCurrent) bone.updateWorldMatrix(true, false);
  bone.matrixWorld.decompose(_position, _qw, _scale);
  bone.parent!.matrixWorld.decompose(_position, _qp, _scale);
  _qw.premultiply(delta);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}

/** Sets a bone's world rotation. */
export function setBoneWorldQuaternion(bone: THREE.Object3D, q: THREE.Quaternion, matricesCurrent = false) {
  if (!matricesCurrent) bone.parent!.updateWorldMatrix(true, false);
  bone.parent!.matrixWorld.decompose(_position, _qp, _scale);
  bone.quaternion.copy(_qp.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK (shoulder → elbow → wrist). Moves the wrist to `target` with the elbow
 * bending toward `pole`. `weight` blends from the animated pose (0) to the solution (1).
 * Set `matricesCurrent` only after updating the whole rig; each solved rotation then
 * propagates to its descendants without repeatedly rebuilding the ancestor chain.
 */
export function solveTwoBone(
  upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D,
  target: THREE.Vector3, pole: THREE.Vector3, weight = 1, matricesCurrent = false,
) {
  weight = THREE.MathUtils.clamp(weight, 0, 1);
  if (weight <= 0) return;
  if (!matricesCurrent) upper.updateWorldMatrix(true, true);
  _a.setFromMatrixPosition(upper.matrixWorld);
  _b.setFromMatrixPosition(lower.matrixWorld);
  _c.setFromMatrixPosition(end.matrixWorld);
  const la = _a.distanceTo(_b), lb = _b.distanceTo(_c);
  if (la < EPSILON || lb < EPSILON) return;
  _t.copy(_c).lerp(target, weight);

  const toT = _d1.subVectors(_t, _a);
  let dist = toT.length();
  // A wrist target exactly on the shoulder still needs a well-defined bend plane.
  if (dist < EPSILON) {
    toT.subVectors(_c, _a);
    if (toT.lengthSq() < EPSILON * EPSILON) toT.subVectors(_b, _a);
    toT.normalize();
    dist = EPSILON;
  }
  const margin = Math.min(1e-3, Math.min(la, lb) * 0.01);
  const maxReach = la + lb - margin, minReach = Math.abs(la - lb) + margin;
  if (dist > maxReach || dist < minReach) {
    dist = THREE.MathUtils.clamp(dist, minReach, maxReach);
    _t.copy(_a).addScaledVector(toT.normalize(), dist);
  }
  const dirAT = _d1.subVectors(_t, _a).normalize();
  const cosA = THREE.MathUtils.clamp((la * la + dist * dist - lb * lb) / (2 * la * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _pole.subVectors(pole, _a);
  _pole.addScaledVector(dirAT, -_pole.dot(dirAT));
  if (_pole.lengthSq() < 1e-8) {
    // Prefer the existing elbow plane; fall back to an axis perpendicular to reach.
    _pole.subVectors(_b, _a).addScaledVector(dirAT, -_pole.dot(dirAT));
    if (_pole.lengthSq() < 1e-8) {
      _pole.set(Math.abs(dirAT.y) < 0.9 ? 0 : 1, Math.abs(dirAT.y) < 0.9 ? -1 : 0, 0);
      _pole.addScaledVector(dirAT, -_pole.dot(dirAT));
    }
  }
  _pole.normalize();
  _elbow.copy(_a).addScaledVector(dirAT, cosA * la).addScaledVector(_pole, sinA * la);

  // Upper bone: swing its current direction onto the elbow.
  _d2.subVectors(_b, _a).normalize();
  _q.setFromUnitVectors(_d2, _swing.subVectors(_elbow, _a).normalize());
  rotateBoneWorld(upper, _q, true);

  // Lower bone: swing onto the target.
  _b.setFromMatrixPosition(lower.matrixWorld);
  _c.setFromMatrixPosition(end.matrixWorld);
  _q.setFromUnitVectors(_d2.subVectors(_c, _b).normalize(), _d1.subVectors(_t, _b).normalize());
  rotateBoneWorld(lower, _q, true);
}
