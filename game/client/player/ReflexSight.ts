import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WeaponId } from "../../shared/weapons";

const RECEIVER: Record<WeaponId, number> = { ar: 0.108, smg: 0.112, shotgun: 0.057, sniper: 0.105, pistol: 0.079 };
const steel = new THREE.MeshStandardMaterial({ color: "#202527", roughness: 0.52, metalness: 0.75 });
const edge = new THREE.MeshStandardMaterial({ color: "#363d3e", roughness: 0.48, metalness: 0.8 });
const glass = new THREE.MeshBasicMaterial({ color: "#80c8cc", transparent: true, opacity: 0.055, depthWrite: false, side: THREE.DoubleSide });

let parts: { steel: THREE.BufferGeometry; edge: THREE.BufferGeometry; glass: THREE.BufferGeometry } | null = null;

/**
 * The sight's pieces, merged per material and shared by every sight: three draws per gun
 * instead of seven, built once instead of per rig.
 */
function sightParts() {
  if (parts) return parts;
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z).toNonIndexed();
  const outer = [[-0.037, 0.042], [-0.038, 0.079], [-0.029, 0.096], [0.029, 0.096], [0.038, 0.079], [0.037, 0.042]];
  const inner = [[-0.032, 0.047], [-0.033, 0.078], [-0.026, 0.091], [0.026, 0.091], [0.033, 0.078], [0.032, 0.047]];
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes.push(new THREE.Path(inner.slice().reverse().map(([x, y]) => new THREE.Vector2(x, y))));
  const hood = at(new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: false }), 0, 0, -0.009);
  return (parts = {
    steel: mergeGeometries([at(new THREE.BoxGeometry(0.06, 0.012, 0.063), 0, 0.006, 0), at(new THREE.BoxGeometry(0.068, 0.014, 0.052), 0, 0.034, 0), hood])!,
    edge: mergeGeometries([at(new THREE.BoxGeometry(0.048, 0.016, 0.048), 0, 0.02, 0), at(new THREE.CylinderGeometry(0.009, 0.009, 0.009, 12).rotateZ(Math.PI / 2), 0.038, 0.035, 0)])!,
    glass: new THREE.PlaneGeometry(0.064, 0.045).translate(0, 0.069, 0),
  });
}

/** Real rail-mounted open reflex: the hood and mount follow the gun, not the HUD. */
export function createReflexSight(weapon: WeaponId) {
  const sight = new THREE.Group();
  sight.name = "rail-mounted-red-dot";
  sight.position.set(0, RECEIVER[weapon], weapon === "pistol" ? -0.03 : -0.055);
  const p = sightParts();
  sight.add(new THREE.Mesh(p.steel, steel), new THREE.Mesh(p.edge, edge), new THREE.Mesh(p.glass, glass));
  return { object: sight, height: RECEIVER[weapon] + 0.069 };
}
