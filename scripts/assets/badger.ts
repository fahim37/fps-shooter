import path from "node:path";
import { MeshoptSimplifier } from "meshoptimizer";
import type * as THREE from "three";
import { RAW } from "./common";
import { readFbx, replaceGun, simplify, type GunPieces, type Look } from "./gun-mesh";

// The SMG: a low-poly AAC Honey Badger, one rigged 11,000-triangle FBX in 18 flat colors. The rig
// is what marks the parts: the magazine is every vertex on its bone, and the bolt and rounds sealed
// inside the gun are dropped the same way.
const SOURCE = path.join(RAW, "honey-badger", "AAC Honeybadger.fbx");

const HIDDEN = new Set(["bolt", "bullet", "bullets"]);
/** The pieces that move while reloading, by the prefix that lets the client find them. */
const MOVING: Record<string, string> = { mag: "Mag_", charger: "Charge_" };
const LENGTH = 0.68;
/** Source point (X along the gun, Y up) that becomes the weapon origin, the top of the grip. */
const ORIGIN = { x: -80, y: -13.5 };
/** Metres the surface may move when simplified, by level. */
const DETAIL = { near: 0.0011, far: 0.0045 };

// The source's colors are close shades of two finishes; folding them together lets each simplify
// as one surface. Linear-space PBR, lifted from the source's near-black.
const LOOKS: Record<string, Look> = {
  tan: { color: [0.195, 0.144, 0.078], metal: 0.1, rough: 0.6 },
  black: { color: [0.03, 0.03, 0.032], metal: 0.3, rough: 0.55 },
  grey: { color: [0.07, 0.072, 0.075], metal: 0.5, rough: 0.5 },
};

function finish(c: THREE.Color) {
  const { r, g, b } = c.clone().convertLinearToSRGB();
  if (r - b >= 0.05 && r > 0.1) return "tan";
  return (r + g + b) / 3 < 0.08 ? "black" : "grey";
}

export async function importBadger() {
  await MeshoptSimplifier.ready;
  const mesh = await loadMesh();
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute("position");
  const count = geometry.index ? geometry.index.count : pos.count;
  const vertex = (k: number) => geometry.index ? geometry.index.getX(k) : k;
  const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
  const bones = mesh.skeleton.bones.map((b) => b.name);
  const index = geometry.getAttribute("skinIndex"), weight = geometry.getAttribute("skinWeight");
  const boneOf = (v: number) => {
    let best = 0, most = -1;
    for (let k = 0; k < 4; k++) if (weight.getComponent(v, k) > most) { most = weight.getComponent(v, k); best = index.getComponent(v, k); }
    return bones[best];
  };
  const hidden = (v: number) => HIDDEN.has(boneOf(v));

  mesh.updateWorldMatrix(true, false);
  const e = mesh.matrixWorld.elements;
  const world: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    world.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
  }
  let min = Infinity, max = -Infinity;
  for (let k = 0; k < count; k++) {
    const v = vertex(k);
    if (hidden(v)) continue;
    min = Math.min(min, world[v * 3]);
    max = Math.max(max, world[v * 3]);
  }
  const scale = LENGTH / (max - min);

  // Source muzzle along +X, up +Y, the gun's right +Z: to muzzle -Z, in metres.
  const place = new Float32Array(world.length);
  for (let i = 0; i < world.length; i += 3) {
    place[i] = world[i + 2] * scale;
    place[i + 1] = (world[i + 1] - ORIGIN.y) * scale;
    place[i + 2] = (ORIGIN.x - world[i]) * scale;
  }

  const groups = new Map<string, number[]>();
  const spans = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
  for (const span of spans) {
    const look = finish(materials[span.materialIndex ?? 0].color);
    for (let k = span.start; k < span.start + span.count; k += 3) {
      const a = vertex(k), b = vertex(k + 1), c = vertex(k + 2);
      if (hidden(a)) continue;
      const name = `${MOVING[boneOf(a)] ?? ""}${look}`;
      const list = groups.get(name) ?? [];
      list.push(a, b, c);
      groups.set(name, list);
    }
  }

  const build = (error: number) => {
    const pieces: GunPieces = new Map();
    for (const [name, tris] of groups) pieces.set(name, { look: LOOKS[name.replace(/^.*_/, "")], meshes: [simplify(place, tris, error)] });
    return pieces;
  };
  const { near, far, meta } = await replaceGun("smg", LENGTH, { near: build(DETAIL.near), far: build(DETAIL.far) });
  console.log(`[badger] near ${near} tris, far ${far} tris`, JSON.stringify(meta));
}

async function loadMesh() {
  const root = await readFbx(SOURCE);
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh; });
  if (!found) throw new Error("badger: no skinned mesh in the source");
  return found as THREE.SkinnedMesh;
}
