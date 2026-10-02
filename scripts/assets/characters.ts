import path from "node:path";
import { Document, type Node, type Primitive, type Skin } from "@gltf-transform/core";
import { mergeDocuments, prune, resample, dedup, weld, simplifyPrimitive } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { SHOWOFFS } from "../../game/shared/showcase";
import { RAW, PUBLIC_MODELS, readModel, writeGLB, compressTextures, invert } from "./common";

const OUTFITS = path.join(RAW, "outfits/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits");
const BASE_PACK = process.env.CHARACTER_PACK || path.join(RAW, "chars/Universal Base Characters[Standard]");
const BASE = path.join(BASE_PACK, "Base Characters/Godot - UE");
const HAIR = path.join(BASE_PACK, "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)");
const UAL1 = path.join(process.env.ANIMATION_PACK || path.join(RAW, "ual/Universal Animation Library[Standard]"), "Unreal-Godot/UAL1_Standard.glb");
const UAL2 = path.join(RAW, "ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb");

/** Clips the game uses, renamed to stable ids. */
const CLIPS: Record<string, string> = {
  Idle_Loop: "idle",
  Walk_Loop: "walk",
  Jog_Fwd_Loop: "jog",
  Sprint_Loop: "sprint",
  Crouch_Idle_Loop: "crouchIdle",
  Crouch_Fwd_Loop: "crouchWalk",
  Jump_Start: "jumpStart",
  Jump_Loop: "jumpLoop",
  Jump_Land: "jumpLand",
  Death01: "death",
  Hit_Chest: "hitChest",
  Hit_Head: "hitHead",
  Pistol_Idle_Loop: "pistolIdle",
  Pistol_Aim_Neutral: "aimNeutral",
  Pistol_Aim_Up: "aimUp",
  Pistol_Aim_Down: "aimDown",
  Pistol_Reload: "reload",
  Pistol_Shoot: "shoot",
  Roll: "roll",
  Dance_Loop: "dance",
  OverhandThrow: "throw",
  Hit_Knockback: "knockback",
  Slide_Start: "slideStart",
  Slide_Loop: "slideLoop",
  Slide_Exit: "slideExit",
  Idle_FoldArms_Loop: "idleFoldArms",
};

function jointIndex(skin: Skin, name: string) {
  const i = skin.listJoints().findIndex((j) => j.getName() === name);
  if (i < 0) throw new Error(`joint ${name} missing`);
  return i;
}

/** Bind-pose world position of a joint, from the inverse bind matrix. */
function bindPosition(skin: Skin, name: string): number[] {
  const ibm = skin.getInverseBindMatrices()!;
  const m = ibm.getElement(jointIndex(skin, name), new Array(16));
  const w = invert(m);
  return [w[12], w[13], w[14]];
}

/**
 * Copies `prim` (optionally only triangles passing `keepTri`) into a new primitive skinned to
 * `target`, translating positions by `delta` and remapping joint indices by bone name.
 */
function transplant(
  doc: Document, prim: Primitive, from: Skin, target: Skin, delta: number[],
  keepVertex: ((joints: number[], weights: number[]) => boolean) | null,
): Primitive {
  const pos = prim.getAttribute("POSITION")!;
  const nrm = prim.getAttribute("NORMAL");
  const uv = prim.getAttribute("TEXCOORD_0");
  const jnt = prim.getAttribute("JOINTS_0")!;
  const wgt = prim.getAttribute("WEIGHTS_0")!;
  const idx = prim.getIndices()!;
  const remapJoint = from.listJoints().map((j) => jointIndex(target, j.getName()));

  const keep = new Uint8Array(pos.getCount());
  const j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) {
    jnt.getElement(i, j4); wgt.getElement(i, w4);
    keep[i] = !keepVertex || keepVertex(j4.map((j) => from.listJoints()[j].getName() as unknown as number), w4) ? 1 : 0;
  }

  const newIndex = new Map<number, number>();
  const P: number[] = [], N: number[] = [], U: number[] = [], J: number[] = [], W: number[] = [], I: number[] = [];
  const v3 = [0, 0, 0], v2 = [0, 0];
  const add = (i: number) => {
    let n = newIndex.get(i);
    if (n !== undefined) return n;
    n = newIndex.size;
    newIndex.set(i, n);
    pos.getElement(i, v3); P.push(v3[0] + delta[0], v3[1] + delta[1], v3[2] + delta[2]);
    if (nrm) { nrm.getElement(i, v3); N.push(...v3); }
    if (uv) { uv.getElement(i, v2); U.push(...v2); }
    jnt.getElement(i, j4); J.push(...j4.map((j) => remapJoint[j]));
    wgt.getElement(i, w4); W.push(...w4);
    return n;
  };
  for (let t = 0; t < idx.getCount(); t += 3) {
    const a = idx.getScalar(t), b = idx.getScalar(t + 1), c = idx.getScalar(t + 2);
    if (!keep[a] || !keep[b] || !keep[c]) continue;
    I.push(add(a), add(b), add(c));
  }
  const buffer = doc.getRoot().listBuffers()[0];
  const acc = (type: "VEC2" | "VEC3" | "VEC4" | "SCALAR", arr: ArrayLike<number>, Ctor: typeof Float32Array | typeof Uint16Array | typeof Uint32Array) =>
    doc.createAccessor().setType(type).setArray(new Ctor(arr as number[])).setBuffer(buffer);
  const out = doc.createPrimitive()
    .setMaterial(prim.getMaterial())
    .setAttribute("POSITION", acc("VEC3", P, Float32Array))
    .setAttribute("JOINTS_0", acc("VEC4", J, Uint16Array))
    .setAttribute("WEIGHTS_0", acc("VEC4", W, Float32Array))
    .setIndices(acc("SCALAR", I, Uint32Array));
  if (nrm) out.setAttribute("NORMAL", acc("VEC3", N, Float32Array));
  if (uv) out.setAttribute("TEXCOORD_0", acc("VEC2", U, Float32Array));
  return out;
}

function findMeshNode(doc: Document, test: (n: Node) => boolean): Node {
  const n = doc.getRoot().listNodes().find((n) => n.getMesh() && test(n));
  if (!n) throw new Error("mesh node not found");
  return n;
}

async function buildCharacter(gender: "Male" | "Female") {
  const doc = await readModel(path.join(OUTFITS, `${gender}_Ranger.gltf`));
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const armature = root.listScenes()[0].listChildren().find((n) => n.getName() === "Armature")!;
  const targetHead = bindPosition(skin, "Head");

  const graft = async (file: string, meshTest: (n: Node) => boolean, name: string,
    keepVertex: ((joints: number[], weights: number[]) => boolean) | null) => {
    const src = await readModel(file);
    const srcSkin = src.getRoot().listSkins()[0];
    const srcHead = bindPosition(srcSkin, "Head");
    const delta = targetHead.map((v, i) => v - srcHead[i]);
    const map = mergeDocuments(doc, src);
    const copiedSkin = map.get(srcSkin) as Skin;
    const node = map.get(findMeshNode(src, meshTest)) as Node;
    const mesh = doc.createMesh(name);
    for (const p of node.getMesh()!.listPrimitives()) mesh.addPrimitive(transplant(doc, p, copiedSkin, skin, delta, keepVertex));
    armature.addChild(doc.createNode(name).setMesh(mesh).setSkin(skin));
    // Drop everything else that came with the source file.
    for (const s of doc.getRoot().listScenes().slice(1)) {
      s.traverse((n) => n.dispose());
      s.dispose();
    }
    copiedSkin.dispose();
  };

  const baseFile = path.join(BASE, `Superhero_${gender}_FullBody.gltf`);
  // Face, scalp and neck of the base body: vertices driven mostly by the head/neck bones.
  const headOnly = (names: number[], w: number[]) => {
    let s = 0;
    (names as unknown as string[]).forEach((n, i) => { if (n === "Head" || n === "neck_01") s += w[i]; });
    return s >= 0.5;
  };
  await graft(baseFile, (n) => /^Super[Hh]ero_/.test(n.getName()), "Head", headOnly);
  await graft(baseFile, (n) => n.getName() === "Eyes", "Eyes", null);
  await graft(baseFile, (n) => n.getName() === "Eyebrows", "Eyebrows", null);
  if (gender === "Male") await graft(path.join(HAIR, "Hair_Beard.gltf"), () => true, "Beard", null);

  for (const b of root.listBuffers().slice(1)) {
    for (const a of root.listAccessors()) if (a.getBuffer() === b) a.setBuffer(root.listBuffers()[0]);
    b.dispose();
  }
  await doc.transform(dedup(), prune(), weld());
  // Reduce dense accessories, preserving faces, hands and first-person arm geometry.
  await MeshoptSimplifier.ready;
  for (const mesh of root.listMeshes()) {
    if (!/Feet|Boots|Bracer|Belt|Pauldron/.test(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0.55, error: 0.001, lockBorder: true });
    }
  }
  await compressTextures(doc, 1024);
  const out = path.join(PUBLIC_MODELS, `char_${gender.toLowerCase()}.glb`);
  const bytes = await writeGLB(doc, out, { compress: true });
  console.log(`[characters] ${path.basename(out)} ${(bytes / 1e6).toFixed(1)} MB, meshes: ${root.listMeshes().map((m) => m.getName()).join(", ")}`);
}

async function buildAnimations(lobby = false) {
  const doc = await readModel(UAL1);
  const root = doc.getRoot();
  const selected: Record<string, string> = lobby ? Object.fromEntries(SHOWOFFS.map((clip) => [clip.source, clip.id])) : CLIPS;
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));

  if (!lobby) {
    const src2 = await readModel(UAL2);
    const map = mergeDocuments(doc, src2);
    for (const anim of src2.getRoot().listAnimations()) {
      const copy = map.get(anim) as ReturnType<Document["createAnimation"]>;
      for (const ch of copy.listChannels()) ch.setTargetNode(byName.get(ch.getTargetNode()!.getName())!);
    }
    for (const s of root.listScenes().slice(1)) { s.traverse((n) => n.dispose()); s.dispose(); }
  }

  for (const anim of root.listAnimations()) {
    const id = selected[anim.getName()];
    if (!id || root.listAnimations().some((a) => a !== anim && a.getName() === id)) {
      // Samplers outlive a disposed animation and keep their accessors alive; drop them too.
      for (const ch of anim.listChannels()) ch.dispose();
      for (const s of anim.listSamplers()) s.dispose();
      anim.dispose();
      continue;
    }
    anim.setName(id);
    for (const ch of anim.listChannels()) {
      const p = ch.getTargetPath();
      const bone = ch.getTargetNode()!.getName();
      if (p === "scale" || bone.includes("_leaf") || (p === "translation" && bone !== "pelvis")) {
        ch.getSampler()!.dispose();
        ch.dispose();
      }
    }
  }
  // Keep only the bone hierarchy: no meshes or skins.
  for (const n of root.listNodes()) { if (n.getMesh()) n.dispose(); }
  for (const s of root.listSkins()) s.dispose();
  for (const b of root.listBuffers().slice(1)) {
    for (const a of root.listAccessors()) if (a.getBuffer() === b) a.setBuffer(root.listBuffers()[0]);
    b.dispose();
  }
  await doc.transform(resample({ tolerance: 1e-4 }), prune({ keepLeaves: true }));
  // Rotations as normalized int16 (allowed by glTF for rotation outputs) halve the file.
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== "rotation") continue;
      const out = ch.getSampler()!.getOutput()!;
      if (!(out.getArray() instanceof Float32Array)) continue;
      const q = Int16Array.from(out.getArray()!, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767));
      out.setArray(q).setNormalized(true);
    }
  }
  await doc.transform(dedup({ propertyTypes: ["Accessor"] }));
  const missing = Object.values(selected).filter((id) => !root.listAnimations().some((a) => a.getName() === id));
  if (missing.length) throw new Error(`Missing clips: ${missing.join(", ")}`);
  const filename = lobby ? "lobby-anims.glb" : "anims.glb";
  const bytes = await writeGLB(doc, path.join(PUBLIC_MODELS, filename), { compress: true });
  console.log(`[characters] ${filename} ${(bytes / 1e3).toFixed(0)} KB, ${root.listAnimations().length} clips`);
}

export async function importCharacters() {
  await buildCharacter("Male");
  await buildCharacter("Female");
  await buildAnimations();
  await buildAnimations(true);
}
