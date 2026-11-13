import * as THREE from "three";
import { loadGLTF } from "./loaders";
import type { WeaponId } from "../../shared/weapons";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import meta from "../../shared/generated/weapons-meta.json";

export interface WeaponMeta {
  length: number;
  muzzle: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
}

export const WEAPON_META = meta as Record<WeaponId, WeaponMeta>;

type V3 = [number, number, number];

/** Pieces that move while handling a gun: they become named children of each weapon. */
export type PartId = "mag" | "pump" | "bolt" | "cylinder" | "hammer";

export interface PartSpec {
  /** Seated origin of the part, weapon space (grip at origin, muzzle toward -Z). */
  pivot: V3;
  /** Direction the part slides out (magazine), back (pump, bolt). */
  axis: V3;
}

interface Extract {
  /** Weapon-space box the piece lies in. */
  min: V3; max: V3;
  material?: RegExp;
  /** Select single triangles instead of whole connected pieces (parts welded to the body). */
  triangles?: boolean;
}

const PARTS: Partial<Record<WeaponId, Partial<Record<PartId, PartSpec & { extract: Extract }>>>> = {
  ar: {
    mag: {
      pivot: [0, 0.03, -0.114], axis: norm([0, -1, -0.18]),
      extract: { min: [-0.03, -0.1, -0.2], max: [0.03, 0.1, -0.06], material: /Mag_/ },
    },
    bolt: { pivot: [0, 0.115, 0.023], axis: [0, 0, 1], extract: { min: [-0.05, 0.08, -0.2], max: [0.05, 0.15, 0.07], material: /Charge_/ } },
  },
  smg: {
    mag: { pivot: [0, 0.0275, -0.109], axis: norm([0, -1, -0.17]), extract: { min: [-0.03, -0.1, -0.2], max: [0.03, 0.1, -0.05], material: /Mag_/ } },
    bolt: { pivot: [0, 0.1075, 0.023], axis: [0, 0, 1], extract: { min: [-0.05, 0.07, -0.2], max: [0.05, 0.15, 0.07], material: /Charge_/ } },
  },
  shotgun: {
    pump: { pivot: [0, 0.006, -0.32], axis: [0, 0, 1], extract: { min: [-0.03, -0.03, -0.43], max: [0.03, 0.04, -0.22], material: /DarkWood/ } },
  },
  sniper: {
    mag: { pivot: [0, -0.03, -0.172], axis: [0, -1, 0], extract: { min: [-0.03, -0.12, -0.25], max: [0.03, 0, -0.09], material: /Mag_/ } },
    bolt: { pivot: [0, 0.0091, -0.1065], axis: [0, 0, 1], extract: { min: [0.005, -0.02, -0.16], max: [0.04, 0.035, -0.06], material: /Bolt_/ } },
  },
  pistol: {
    // Turn rather than slide: the cylinder about its pin, the hammer about its axle. `axis` is the pin's direction.
    cylinder: { pivot: [0, 0.0764, -0.0909], axis: [0, 0, 1], extract: { min: [-0.05, 0.025, -0.15], max: [0.05, 0.125, -0.0375], material: /Cyl_/ } },
    hammer: { pivot: [0, 0.0551, -0.0425], axis: [1, 0, 0], extract: { min: [-0.025, 0.0375, -0.075], max: [0.025, 0.125, 0.0125], material: /Hammer_/ } },
  },
};

export const WEAPON_PARTS = PARTS as Partial<Record<WeaponId, Partial<Record<PartId, PartSpec>>>>;

/**
 * Where spent cases leave each gun (weapon space, just outside the receiver's right wall) and what
 * they look like. The revolver keeps its empties in the cylinder.
 */
export const EJECTION: Partial<Record<WeaponId, { port: V3; radius: number; length: number; color: string }>> = {
  ar: { port: [0.024, 0.085, -0.07], radius: 0.0048, length: 0.045, color: "#c9a043" },
  smg: { port: [0.022, 0.075, -0.07], radius: 0.0055, length: 0.023, color: "#c9a043" },
  shotgun: { port: [0.032, 0.03, -0.1], radius: 0.0105, length: 0.066, color: "#9b2a22" },
  sniper: { port: [0.024, 0.025, -0.13], radius: 0.006, length: 0.07, color: "#c9a043" },
};

/** Where a hand-loaded round seats (its centre, lying along +Z), the way it travels in, and its size. */
export const SHELL_SEATS: Partial<Record<WeaponId, { port: V3; axis: V3; scale: number }>> = {
  // Pushed up into the receiver.
  shotgun: { port: [0, -0.012, -0.14], axis: [0, 1, 0], scale: 1 },
  // Pushed forward into the cylinder from behind.
  pistol: { port: [-0.0215, 0.0688, -0.0819], axis: [0, 0, -1], scale: 0.69 },
};

/** An optic modelled on the gun ("Scope_" materials), shown only while it is the one chosen. */
const SCOPE: Extract = { min: [-1, -1, -1], max: [1, 1, 1], material: /Scope_/ };

/** Name suffix of a gun's detailed model, for the player's own hands. Not every gun has one. */
const NEAR = "_near";

export type WeaponTemplates = Map<string, THREE.Object3D>;

let templates: Promise<WeaponTemplates> | null = null;

export function loadWeapons() {
  return (templates ??= loadGLTF("/models/weapons.glb").then((gltf) => {
    const map: WeaponTemplates = new Map();
    for (const child of [...gltf.scene.children]) {
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      const id = child.name.replace(NEAR, "") as WeaponId;
      const names = new Set(Object.keys(PARTS[id] ?? {}));
      for (const [part, spec] of Object.entries(PARTS[id] ?? {})) {
        const node = extractPart(child, spec.extract, spec.pivot);
        node.name = part;
        node.position.set(...spec.pivot);
        child.add(node);
      }
      const scope = extractPart(child, SCOPE, [0, 0, 0]);
      if (scope.children.length) {
        scope.name = "scope";
        scope.visible = false;
        child.add(scope);
        names.add("scope");
      }
      mergeFlatMeshes(child, names);
      map.set(child.name, child);
    }
    return map;
  }));
}

export function cloneWeapon(templates: WeaponTemplates, id: WeaponId, near: boolean): THREE.Object3D {
  const src = (near && templates.get(id + NEAR)) || templates.get(id);
  if (!src) throw new Error(`weapon model ${id} missing`);
  const o = src.clone(true);
  o.position.set(0, 0, 0);
  o.rotation.set(0, 0, 0);
  return o;
}

let shellGeometry: THREE.BufferGeometry | null = null;
const brass = new THREE.MeshStandardMaterial({ color: "#b8913d", roughness: 0.35, metalness: 0.9 });
const shellHull = new THREE.MeshStandardMaterial({ color: "#8c1d18", roughness: 0.6 });

/** A round along +Z, base at the back, shown in the hand while loading: a 12-gauge shell, or all brass. */
export function createShell(allBrass = false) {
  if (!shellGeometry) {
    const hull = new THREE.CylinderGeometry(0.0105, 0.0105, 0.052, 10).rotateX(Math.PI / 2).translate(0, 0, -0.008);
    const base = new THREE.CylinderGeometry(0.0115, 0.0115, 0.014, 10).rotateX(Math.PI / 2).translate(0, 0, 0.024);
    shellGeometry = mergeGroups([hull, base]);
  }
  const mesh = new THREE.Mesh(shellGeometry, [allBrass ? brass : shellHull, brass]);
  mesh.name = "shell";
  return mesh;
}

function mergeGroups(parts: THREE.BufferGeometry[]) {
  const out = new THREE.BufferGeometry();
  const pos: number[] = [], nrm: number[] = [], index: number[] = [];
  let offset = 0;
  parts.forEach((g, i) => {
    const p = g.getAttribute("position"), n = g.getAttribute("normal"), idx = g.getIndex()!;
    pos.push(...(p.array as Float32Array)); nrm.push(...(n.array as Float32Array));
    out.addGroup(index.length, idx.count, i);
    for (let k = 0; k < idx.count; k++) index.push(idx.getX(k) + offset);
    offset += p.count;
  });
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(index);
  return out;
}

/**
 * Moves the triangles of `root` that make up one piece (magazine, pump...) into a new group
 * whose origin is `pivot`. Pieces are found by welding vertices by position, so a part is
 * taken whole when its centre lies in the box.
 */
function extractPart(root: THREE.Object3D, ex: Extract, pivot: V3) {
  const group = new THREE.Group();
  const box = new THREE.Box3(new THREE.Vector3(...ex.min), new THREE.Vector3(...ex.max));
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const material = mesh.material as THREE.Material;
    if (ex.material && !ex.material.test(material.name)) continue;
    const geo = mesh.geometry;
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    const tri = (t: number, k: number) => index ? index.getX(t * 3 + k) : t * 3 + k;
    const triCount = (index ? index.count : pos.count) / 3;
    toRoot.copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
    const p = Array.from({ length: pos.count }, (_, i) => v.fromBufferAttribute(pos, i).applyMatrix4(toRoot).clone());

    const take = new Uint8Array(triCount);
    if (ex.triangles) {
      for (let t = 0; t < triCount; t++) {
        const c = v.copy(p[tri(t, 0)]).add(p[tri(t, 1)]).add(p[tri(t, 2)]).divideScalar(3);
        take[t] = box.containsPoint(c) ? 1 : 0;
      }
    } else {
      // Union-find over position-welded vertices.
      const key = (q: THREE.Vector3) => `${Math.round(q.x * 1e4)},${Math.round(q.y * 1e4)},${Math.round(q.z * 1e4)}`;
      const ids = new Map<string, number>();
      const vid = p.map((q) => { const k = key(q); let id = ids.get(k); if (id === undefined) ids.set(k, id = ids.size); return id; });
      const parent = Array.from({ length: ids.size }, (_, i) => i);
      const find = (a: number): number => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
      for (let t = 0; t < triCount; t++) {
        const a = find(vid[tri(t, 0)]), b = find(vid[tri(t, 1)]), c = find(vid[tri(t, 2)]);
        parent[b] = a; parent[find(c)] = a;
      }
      const sums = new Map<number, { c: THREE.Vector3; n: number }>();
      for (let i = 0; i < p.length; i++) {
        const r = find(vid[i]);
        let s = sums.get(r);
        if (!s) sums.set(r, s = { c: new THREE.Vector3(), n: 0 });
        s.c.add(p[i]); s.n++;
      }
      for (let t = 0; t < triCount; t++) {
        const s = sums.get(find(vid[tri(t, 0)]))!;
        take[t] = box.containsPoint(v.copy(s.c).divideScalar(s.n)) ? 1 : 0;
      }
    }
    if (!take.some(Boolean)) continue;

    const keep: number[] = [], moved: number[] = [];
    for (let t = 0; t < triCount; t++) (take[t] ? moved : keep).push(tri(t, 0), tri(t, 1), tri(t, 2));
    const part = geo.clone();
    part.setIndex(moved);
    // Positions relative to the pivot, in weapon space.
    const shifted = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) shifted.set([p[i].x - pivot[0], p[i].y - pivot[1], p[i].z - pivot[2]], i * 3);
    part.setAttribute("position", new THREE.BufferAttribute(shifted, 3));
    const normal = geo.getAttribute("normal");
    if (normal) {
      const n = new Float32Array(normal.count * 3);
      const nm = new THREE.Matrix3().getNormalMatrix(toRoot);
      for (let i = 0; i < normal.count; i++) v.fromBufferAttribute(normal, i).applyMatrix3(nm).normalize().toArray(n, i * 3);
      part.setAttribute("normal", new THREE.BufferAttribute(n, 3));
    }
    part.computeBoundingBox();
    part.computeBoundingSphere();
    const rest = geo.clone();
    rest.setIndex(keep);
    mesh.geometry = rest;
    const piece = new THREE.Mesh(part, material);
    piece.castShadow = piece.receiveShadow = true;
    group.add(piece);
  }
  return group;
}

/**
 * The guns use flat colors, no textures. Their meshes merge into one draw per moving piece, with
 * each vertex carrying its original color, metalness and roughness: same look, a few draw
 * calls per gun instead of one per material.
 */
let flatMaterial: THREE.MeshStandardMaterial | null = null;
function gunMaterial() {
  if (flatMaterial) return flatMaterial;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 1 });
  m.name = "Gun_Flat";
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 metalRough;\nvarying vec2 vMetalRough;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMetalRough = metalRough;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMetalRough;")
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vMetalRough.y;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = vMetalRough.x;");
  };
  m.customProgramCacheKey = () => "gun-flat-v1";
  return (flatMaterial = m);
}

function mergeFlatMeshes(root: THREE.Object3D, partNames: Set<string>) {
  root.updateMatrixWorld(true);
  const containers: THREE.Object3D[] = [root, ...root.children.filter((c) => partNames.has(c.name))];
  for (const container of containers) {
    const meshes: THREE.Mesh[] = [];
    const collect = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if (o === root && partNames.has(c.name)) continue;
        if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
        collect(c);
      }
    };
    collect(container);
    const flat = meshes.every((m) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      return mat.isMeshStandardMaterial && !mat.map && !mat.transparent && m.geometry.getAttribute("normal");
    });
    if (meshes.length < 2 || !flat) continue;
    const toContainer = new THREE.Matrix4().copy(container.matrixWorld).invert();
    const geometries = meshes.map((m) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", m.geometry.getAttribute("position").clone());
      g.setAttribute("normal", m.geometry.getAttribute("normal").clone());
      g.setIndex(m.geometry.getIndex()?.clone() ?? null);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toContainer, m.matrixWorld));
      const n = g.getAttribute("position").count;
      const color = new Float32Array(n * 3), mr = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { mat.color.toArray(color, i * 3); mr[i * 2] = mat.metalness; mr[i * 2 + 1] = mat.roughness; }
      g.setAttribute("color", new THREE.BufferAttribute(color, 3));
      g.setAttribute("metalRough", new THREE.BufferAttribute(mr, 2));
      return g;
    });
    const indexed = geometries.every((g) => g.index);
    const merged = mergeGeometries(indexed ? geometries : geometries.map((g) => g.index ? g.toNonIndexed() : g));
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, gunMaterial());
    mesh.name = `${container.name}_flat`;
    mesh.castShadow = mesh.receiveShadow = true;
    for (const m of meshes) m.removeFromParent();
    container.add(mesh);
  }
}

function norm(v: V3): V3 {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}
