import path from "node:path";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import type * as THREE from "three";
import { RAW } from "./common";
import { readFbx, replaceGun, simplify, type GunPieces, type Look } from "./gun-mesh";

// The sidearm: a Colt Single Action Army, modelled part by part with a 2K texture set. That texture
// is only flat steel and walnut, so each triangle takes one of those two looks at import and the
// game needs no texture for it: one draw call and no texture memory, like the other guns.
const DIR = path.join(RAW, "peacemaker");

/** Sealed inside the frame. */
const HIDDEN = new Set(["spring"]);
/** The pieces that move, by the prefix that lets the client find them. */
const MOVING: Record<string, string> = { Cylinder: "Cyl_", hammer: "Hammer_" };

/** A quarter over life size: the characters have big hands, and at true size one hides the gun while aiming. */
const LENGTH = 0.4;
/** Source point (Y up, Z along the gun, muzzle toward -Z) that becomes the weapon origin, in the grip. */
const ORIGIN = { y: -35, z: 180 };
/** Metres the surface may move when simplified, by level. */
const DETAIL = { near: 0.00052, far: 0.002 };

const LOOKS: Record<string, Look> = {
  steel: { color: [0.2, 0.2, 0.21], metal: 0.9, rough: 0.38 },
  walnut: { color: [0.15, 0.07, 0.028], metal: 0, rough: 0.5 },
};

export async function importPeacemaker() {
  await MeshoptSimplifier.ready;
  const { data, info } = await sharp(path.join(DIR, "saa_t.png")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const isWood = (u: number, v: number) => {
    const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor((1 - (v - Math.floor(v))) * info.height)));
    const i = (y * info.width + x) * 3;
    return data[i] > data[i + 2] * 1.5;
  };

  const root = await readFbx(path.join(DIR, "peacemaker.fbx"));
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !HIDDEN.has(o.name)) meshes.push(o as THREE.Mesh); });

  const placed = meshes.map((mesh) => {
    const pos = mesh.geometry.getAttribute("position"), e = mesh.matrixWorld.elements;
    const world = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      for (let k = 0; k < 3; k++) world[i * 3 + k] = e[k] * x + e[4 + k] * y + e[8 + k] * z + e[12 + k];
    }
    return world;
  });
  let min = Infinity, max = -Infinity;
  for (const w of placed) for (let i = 2; i < w.length; i += 3) { min = Math.min(min, w[i]); max = Math.max(max, w[i]); }
  const scale = LENGTH / (max - min);

  const build = (error: number) => {
    const pieces: GunPieces = new Map();
    meshes.forEach((mesh, m) => {
      const world = placed[m], geometry = mesh.geometry;
      const place = new Float32Array(world.length);
      for (let i = 0; i < world.length; i += 3) {
        place[i] = world[i] * scale;
        place[i + 1] = (world[i + 1] - ORIGIN.y) * scale;
        place[i + 2] = (world[i + 2] - ORIGIN.z) * scale;
      }
      const uv = geometry.getAttribute("uv");
      const count = geometry.index ? geometry.index.count : geometry.getAttribute("position").count;
      const vertex = (k: number) => geometry.index ? geometry.index.getX(k) : k;
      const groups = new Map<string, number[]>();
      for (let k = 0; k < count; k += 3) {
        const a = vertex(k), b = vertex(k + 1), c = vertex(k + 2);
        const wood = isWood((uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3, (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3);
        const look = wood ? "walnut" : "steel";
        const list = groups.get(look) ?? [];
        list.push(a, b, c);
        groups.set(look, list);
      }
      for (const [look, tris] of groups) {
        const name = `${MOVING[mesh.name] ?? ""}${look}`;
        const piece = pieces.get(name) ?? { look: LOOKS[look], meshes: [] };
        piece.meshes.push(simplify(place, tris, error));
        pieces.set(name, piece);
      }
    });
    return pieces;
  };
  const { near, far, meta } = await replaceGun("pistol", LENGTH, { near: build(DETAIL.near), far: build(DETAIL.far) });
  console.log(`[peacemaker] near ${near} tris, far ${far} tris`, JSON.stringify(meta));
}
