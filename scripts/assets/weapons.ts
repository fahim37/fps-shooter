import path from "node:path";
import { Document, type Material, type mat4 } from "@gltf-transform/core";
import { transformMesh, prune } from "@gltf-transform/functions";
import { RAW, PUBLIC_MODELS, GENERATED, readModel, writeGLB, writeJSON } from "./common";
import { mergeDocuments } from "@gltf-transform/functions";

// Quaternius "Ultimate Guns" (CC0, via poly.pizza). Source models point the muzzle along +X
// in arbitrary units with the origin near the grip.
const GUNS: { id: string; file: string; length: number }[] = [
  { id: "ar", file: "rifle.glb", length: 0.88 },
  { id: "smg", file: "smg.glb", length: 0.62 },
  { id: "shotgun", file: "shotgun.glb", length: 1.0 },
  { id: "sniper", file: "sniper3.glb", length: 1.18 },
  { id: "pistol", file: "pistol.glb", length: 0.21 },
];

type Look = { color: [number, number, number]; metal: number; rough: number };
// Linear-space PBR looks by source material name; the originals are near-black flat colors.
const LOOKS: Record<string, Look> = {
  Metal: { color: [0.22, 0.22, 0.23], metal: 1, rough: 0.38 },
  DarkMetal: { color: [0.1, 0.1, 0.11], metal: 1, rough: 0.45 },
  LightMetal: { color: [0.45, 0.45, 0.47], metal: 1, rough: 0.3 },
  Black: { color: [0.025, 0.025, 0.027], metal: 0, rough: 0.55 },
  Black2: { color: [0.02, 0.02, 0.02], metal: 0, rough: 0.6 },
  Grey: { color: [0.08, 0.085, 0.09], metal: 0.3, rough: 0.5 },
  Wood: { color: [0.2, 0.09, 0.035], metal: 0, rough: 0.55 },
  DarkWood: { color: [0.11, 0.05, 0.022], metal: 0, rough: 0.6 },
  Green: { color: [0.07, 0.1, 0.055], metal: 0, rough: 0.6 },
  Glass: { color: [0.02, 0.03, 0.035], metal: 0.2, rough: 0.05 },
  Main: { color: [0.03, 0.03, 0.032], metal: 0.2, rough: 0.5 },
  MainDark: { color: [0.018, 0.018, 0.02], metal: 0.2, rough: 0.55 },
  MainLight: { color: [0.06, 0.065, 0.07], metal: 0.5, rough: 0.45 },
};

export async function importWeapons() {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene("weapons");
  const shared = new Map<string, Material>();
  const meta: Record<string, { length: number; muzzle: number[]; min: number[]; max: number[] }> = {};

  for (const gun of GUNS) {
    const src = await readModel(path.join(RAW, "guns", gun.file));
    const map = mergeDocuments(doc, src);
    const merged = map.get(src.getRoot().listScenes()[0]) as ReturnType<Document["createScene"]>;
    const holder = doc.createNode(gun.id);
    scene.addChild(holder);

    // Measure the source extent along X to derive the scale.
    let minX = Infinity, maxX = -Infinity;
    merged.traverse((n) => {
      const mesh = n.getMesh();
      if (!mesh) return;
      const m = n.getWorldMatrix();
      for (const p of mesh.listPrimitives()) {
        const pos = p.getAttribute("POSITION")!;
        const v = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        }
      }
    });
    const s = gun.length / (maxX - minX);
    // Rotate +90° about Y so +X (muzzle) maps to -Z, then scale to meters.
    const fix = [0, 0, -s, 0, 0, s, 0, 0, s, 0, 0, 0, 0, 0, 0, 1];

    const meshNodes: ReturnType<Document["createNode"]>[] = [];
    merged.traverse((n) => { if (n.getMesh()) meshNodes.push(n); });
    for (const n of meshNodes) {
      const mesh = n.getMesh()!;
      transformMesh(mesh, mul(fix, n.getWorldMatrix()));
      const part = doc.createNode(`${gun.id}_${n.getName()}`).setMesh(mesh);
      holder.addChild(part);
      for (const p of mesh.listPrimitives()) {
        const name = p.getMaterial()?.getName() ?? "Metal";
        const look = LOOKS[name] ?? LOOKS.Metal;
        if (!LOOKS[name]) console.warn(`  weapons: no look for material ${name}`);
        let mat = shared.get(name);
        if (!mat) {
          mat = doc.createMaterial(`Gun_${name}`)
            .setBaseColorFactor([...look.color, 1])
            .setMetallicFactor(look.metal)
            .setRoughnessFactor(look.rough);
          shared.set(name, mat);
        }
        p.setMaterial(mat);
      }
    }
    for (const c of merged.listChildren()) c.dispose();
    merged.dispose();

    // Bounds and muzzle point (centroid of the front-most vertices).
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const all: number[][] = [];
    for (const part of holder.listChildren()) {
      for (const p of part.getMesh()!.listPrimitives()) {
        const pos = p.getAttribute("POSITION")!;
        const v = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          all.push([...v]);
          for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
        }
      }
    }
    const front = all.filter((v) => v[2] < min[2] + 0.01);
    const muzzle = [0, 1, 2].map((k) => front.reduce((a, v) => a + v[k], 0) / front.length);
    const r = (x: number) => Math.round(x * 10000) / 10000;
    meta[gun.id] = { length: gun.length, muzzle: muzzle.map(r), min: min.map(r), max: max.map(r) };
  }

  for (const b of doc.getRoot().listBuffers().slice(1)) {
    for (const a of doc.getRoot().listAccessors()) if (a.getBuffer() === b) a.setBuffer(doc.getRoot().listBuffers()[0]);
    b.dispose();
  }
  for (const s of doc.getRoot().listScenes()) if (s !== scene) s.dispose();
  await doc.transform(prune());
  const bytes = await writeGLB(doc, path.join(PUBLIC_MODELS, "weapons.glb"), { compress: false });
  writeJSON(path.join(GENERATED, "weapons-meta.json"), meta);
  console.log(`[weapons] ${(bytes / 1e3).toFixed(0)} KB`, JSON.stringify(meta));
}

function mul(a: number[], b: number[]) {
  const o: mat4 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
