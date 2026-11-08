import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import sharp from "sharp";
import { Document, type Material, type Node, type Primitive, type Skin } from "@gltf-transform/core";
import { compactPrimitive, simplifyPrimitive, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { RAW, PUBLIC_MODELS, GENERATED, writeGLB, compressTextures } from "./common";
import { readFbx } from "./gun-mesh";

/**
 * "Soldier Full Tactical Gear (LowPolyGameReady)" by DanlyVostok (Sketchfab), the game's one
 * character. Put the FBX from the download's `source/Mark_1.zip` and its `textures/` folder at
 * assets-raw/soldier.
 *
 * The model is rigged to a Character Creator skeleton in an A-pose; every clip, aim pose, grip and
 * hitbox in the game is built on the Unreal-style skeleton in generated/skeleton.json (the Rangers'
 * one). The mesh is bound to that skeleton instead of being re-posed: each joint's inverse bind
 * matrix carries the soldier bone's own rest frame onto the matching game bone (stretched along the
 * bone to its length), so a pose that bends a joint the way the soldier's rest pose does deforms the
 * mesh exactly as its own rig would. Bones the game lacks (twist, pouch, facial) ride on their parent.
 *
 * About 84,000 triangles, 12 materials and 31 4K maps go down to about 20,000 triangles and two
 * materials: the body, and the sleeves and gloves ("Arms"), which first person shows on their own
 * and therefore get a sharper atlas.
 */
const DIR = path.join(RAW, "soldier");
const FBX = path.join(DIR, "Mark_1_Olive_IdlePose.fbx");
const TEX = path.join(DIR, "textures");

/** Game joint ← the soldier bone whose rest frame it carries (CC_Base_ prefix dropped). */
const PRIMARY: Record<string, string> = {
  root: "RL_BoneRoot", pelvis: "Pelvis", spine_01: "Waist", spine_02: "Spine01", spine_03: "Spine02", neck_01: "NeckTwist01", Head: "Head",
};
for (const [s, S] of [["l", "L"], ["r", "R"]]) {
  Object.assign(PRIMARY, {
    [`clavicle_${s}`]: `${S}_Clavicle`, [`upperarm_${s}`]: `${S}_Upperarm`, [`lowerarm_${s}`]: `${S}_Forearm`, [`hand_${s}`]: `${S}_Hand`,
    [`thigh_${s}`]: `${S}_Thigh`, [`calf_${s}`]: `${S}_Calf`, [`foot_${s}`]: `${S}_Foot`, [`ball_${s}`]: `${S}_ToeBase`,
  });
  const fingers: [string, string][] = [["thumb", "Thumb"], ["index", "Index"], ["middle", "Mid"], ["ring", "Ring"], ["pinky", "Pinky"]];
  for (const [g, c] of fingers) for (const k of [1, 2, 3]) PRIMARY[`${g}_0${k}_${s}`] = `${S}_${c}${k}`;
}
/** Soldier bones folded into a game joint that is not their parent's. */
const EXTRA: Record<string, string> = { Hip: "pelvis", NeckTwist02: "neck_01" };

/** The joint each game bone points at, which sets its axis (missing: a leaf, see leafAxis). */
const CHILD: Record<string, string> = {
  pelvis: "spine_01", spine_01: "spine_02", spine_02: "spine_03", spine_03: "neck_01", neck_01: "Head",
};
for (const s of ["l", "r"]) {
  Object.assign(CHILD, {
    [`clavicle_${s}`]: `upperarm_${s}`, [`upperarm_${s}`]: `lowerarm_${s}`, [`lowerarm_${s}`]: `hand_${s}`, [`hand_${s}`]: `middle_01_${s}`,
    [`thigh_${s}`]: `calf_${s}`, [`calf_${s}`]: `foot_${s}`, [`foot_${s}`]: `ball_${s}`,
  });
  for (const f of ["thumb", "index", "middle", "ring", "pinky"]) { CHILD[`${f}_01_${s}`] = `${f}_02_${s}`; CHILD[`${f}_02_${s}`] = `${f}_03_${s}`; }
}

/** Source material → atlas part. */
const PART: Record<string, string> = {
  Mark_Kitel_1: "Kitel", Mark_Pants_1: "Pants", Mark_Plate_1: "Plate", Mark_Pouches_1: "Pouches", Mark_Helmet1: "Helmet",
  Mark_HeadMasked: "Head", Mark_Boots_2: "Boots", Mark_Gloves_1: "Gloves", Mark_Eye: "Eye", Mark_SunGlusses_Glus: "Glasses",
};
const MAPS: Record<string, { albedo?: string; normal?: string; ao?: string; rough?: string; metal?: string; color?: [number, number, number]; roughness?: number }> = {
  Kitel: { albedo: "Mark_Kitel_1_albedo.jpeg", normal: "Mark_Kitel_1_normal.png", ao: "Mark_Kitel_1_AO.jpeg", rough: "Mark_Kitel_1_roughness.jpeg" },
  Pants: { albedo: "Mark_Pants_1_albedo.jpeg", normal: "Mark_Pants_1_normal.png", ao: "Mark_Pants_1_AO.jpeg", rough: "Mark_Pants_1_roughness.jpeg" },
  Plate: { albedo: "Mark_Plate_1_albedo.jpeg", normal: "Mark_Plate_1_normal.jpeg", ao: "Mark_Plate_1_AO.jpeg", rough: "Mark_Plate_1_roughness.jpeg" },
  Pouches: { albedo: "Mark_Pouches_1_albedo.png", normal: "Mark_Pouches_1_normal.png", ao: "Mark_Pouches_1_AO.jpeg", rough: "Mark_Pouches_1_roughness.jpeg", metal: "Mark_Pouches_1_metallic.jpeg" },
  Helmet: { albedo: "Mark_Helmet1_albedo.jpeg", normal: "Mark_Helmet1_normal.png", ao: "Mark_Helmet1_AO.jpeg", rough: "Mark_Helmet1_roughness.jpeg" },
  Head: { albedo: "Mark_Head_albedo.png", normal: "Mark_Head_normal.png", roughness: 0.55 },
  Boots: { albedo: "Mark_Boots_2_albedo.png", normal: "Mark_Boots_2_normal.png", ao: "Mark_Boots_2_ao.jpeg", roughness: 0.7 },
  Gloves: { albedo: "Mark_Gloves_1_albedo.jpeg", normal: "Mark_Gloves_1_normal.png", ao: "Mark_Gloves_1_AO.jpeg", rough: "Mark_Gloves_1_roughness.jpeg" },
  Eye: { albedo: "Mark_Eye_albedo.jpeg", roughness: 0.2 },
  Glasses: { color: [18, 20, 22], roughness: 0.15 },
};
/** Cloth the team colour tints (the albedo atlas carries this as alpha: 255 tinted, 128 not). */
const TINTED = new Set(["Kitel", "Pants", "Helmet"]);

interface Cell { x: number; y: number; w: number; h: number }
interface Atlas { name: string; width: number; height: number; detail: number; cells: Record<string, Cell> }
const BODY: Atlas = {
  name: "Soldier_Body", width: 2048, height: 2048, detail: 1024,
  cells: {
    Kitel: { x: 0, y: 0, w: 1024, h: 1024 }, Pants: { x: 1024, y: 0, w: 1024, h: 1024 },
    Plate: { x: 0, y: 1024, w: 512, h: 512 }, Pouches: { x: 512, y: 1024, w: 512, h: 512 }, Helmet: { x: 1024, y: 1024, w: 512, h: 512 }, Head: { x: 1536, y: 1024, w: 512, h: 512 },
    Boots: { x: 0, y: 1536, w: 512, h: 512 }, Gloves: { x: 512, y: 1536, w: 512, h: 512 }, Eye: { x: 1024, y: 1536, w: 256, h: 256 }, Glasses: { x: 1280, y: 1536, w: 64, h: 64 },
  },
};
/** Sleeves and gloves fill the bottom of the first-person view. */
const ARMS: Atlas = {
  name: "Soldier_Arms", width: 2048, height: 1024, detail: 2048,
  cells: { Gloves: { x: 0, y: 0, w: 1024, h: 1024 }, Kitel: { x: 1024, y: 0, w: 1024, h: 1024 } },
};

/** Share of each part's triangles kept, and the error (share of the part's size) it may cost. */
const SIMPLIFY: Record<string, [number, number]> = {
  Helmet: [0.1, 0.02], Pouches: [0.3, 0.02], Plate: [0.4, 0.01], Boots: [0.3, 0.01], Pants: [0.45, 0.006], Kitel: [0.5, 0.006],
  Arms_Kitel: [0.7, 0.003], Gloves: [0.65, 0.003], Head: [0.6, 0.004], Eye: [0.25, 0.02], Glasses: [1, 0],
};

interface GameJoint { name: string; parent: string | null; t: number[]; r: number[]; s: number[] }

const ARM_JOINT = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/;
/** The four bags hanging off the belt (dangle bones Pouch1-4: both hips, beside the hands, and two behind): left out. */
const DROPPED_BONE = /^Pouch\d+$/;

/** The match model, and the lobby's full-detail one (no simplifying, a 4K body atlas). */
export async function importSoldier() {
  await buildSoldier("soldier.glb", true, BODY);
  await buildSoldier("soldier_hq.glb", false, scaleAtlas(BODY, 2));
}

/**
 * Triangles of every welded piece of `mesh` that any vertex ties to a DROPPED_BONE, so a bag goes
 * whole, with the loop that holds it to the belt.
 */
function droppedTriangles(mesh: THREE.SkinnedMesh, index: number[]) {
  const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const weld = new Map<string, number>();
  const vert = Array.from({ length: pos.count }, (_, i) => {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!weld.has(k)) weld.set(k, weld.size);
    return weld.get(k)!;
  });
  const parent = Array.from({ length: weld.size }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let t = 0; t < index.length; t += 3) {
    const a = find(vert[index[t]]);
    parent[find(vert[index[t + 1]])] = a;
    parent[find(vert[index[t + 2]])] = a;
  }
  const doomed = new Set<number>();
  for (let i = 0; i < pos.count; i++) {
    for (let k = 0; k < 4; k++) {
      if (sw.getComponent(i, k) > 0 && DROPPED_BONE.test(mesh.skeleton.bones[si.getComponent(i, k)].name.replace(/^CC_Base_/, ""))) doomed.add(find(vert[i]));
    }
  }
  return Array.from({ length: index.length / 3 }, (_, t) => doomed.has(find(vert[index[t * 3]])));
}

function scaleAtlas(a: Atlas, k: number): Atlas {
  const cells = Object.fromEntries(Object.entries(a.cells).map(([p, c]) => [p, { x: c.x * k, y: c.y * k, w: c.w * k, h: c.h * k }]));
  return { ...a, width: a.width * k, height: a.height * k, detail: a.detail * k, cells };
}

async function buildSoldier(file: string, simplify: boolean, BODY: Atlas) {
  await MeshoptSimplifier.ready;
  THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };

  // Game skeleton at rest (which is its bind pose), world space.
  const joints: GameJoint[] = JSON.parse(fs.readFileSync(path.join(GENERATED, "skeleton.json"), "utf8"));
  const restWorld = new Map<string, THREE.Matrix4>();
  for (const j of joints) {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...j.t), new THREE.Quaternion(...j.r), new THREE.Vector3(...j.s));
    restWorld.set(j.name, j.parent ? restWorld.get(j.parent)!.clone().multiply(local) : local);
  }
  const gamePos = (n: string) => new THREE.Vector3().setFromMatrixPosition(restWorld.get(n)!);

  // Soldier: bind-pose bone positions (m) and its bone tree.
  const fbx = await readFbx(FBX);
  const meshes: THREE.SkinnedMesh[] = [];
  fbx.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  const ref = meshes.find((m) => PART[(m.material as THREE.Material).name] === "Kitel")!.skeleton;
  const short = (n: string) => n.replace(/^CC_Base_/, "");
  const srcPos = new Map<string, THREE.Vector3>();
  ref.bones.forEach((b, i) => srcPos.set(short(b.name), new THREE.Vector3().setFromMatrixPosition(ref.boneInverses[i].clone().invert()).multiplyScalar(0.01)));
  const sp = (n: string) => { const p = srcPos.get(n); if (!p) throw new Error(`soldier bone ${n} missing`); return p.clone(); };

  // Per game joint: soldier rest frame → game rest frame, stretched to the game bone's length.
  const FWD = new THREE.Vector3(0, 0, 1), LEFT = new THREE.Vector3(1, 0, 0), UP = new THREE.Vector3(0, 1, 0);
  const g = gamePos("Head").y / sp("Head").y;
  const frame = (origin: THREE.Vector3, axis: THREE.Vector3, ref: THREE.Vector3) => {
    const x = axis.clone().normalize();
    const z = ref.clone().addScaledVector(x, -ref.dot(x)).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
  };
  /** Axes for the bone of `game` in one skeleton, given that skeleton's joint positions. */
  const boneFrame = (game: string, pos: (gameJoint: string) => THREE.Vector3) => {
    const side = game.slice(-1);
    const o = pos(game);
    const lateral = () => pos(`index_01_${side}`).sub(pos(`pinky_01_${side}`));
    const handAxis = () => pos(`middle_01_${side}`).sub(pos(`hand_${side}`));
    let axis: THREE.Vector3, len: number | null;
    const child = CHILD[game];
    if (child) { axis = pos(child).sub(o); len = axis.length(); }
    else if (/_03_/.test(game)) { axis = o.clone().sub(pos(game.replace("_03_", "_02_"))); len = null; } // fingertip: on along the finger
    else if (/^ball_/.test(game)) { axis = FWD.clone(); len = null; }
    else { axis = UP.clone(); len = null; } // head, root
    let refDir: THREE.Vector3;
    if (/^(thumb)_/.test(game)) refDir = new THREE.Vector3().crossVectors(handAxis(), lateral());
    else if (/^(hand|index|middle|ring|pinky)_/.test(game)) refDir = lateral();
    else if (/^(foot|ball)_/.test(game)) refDir = LEFT.clone();
    else refDir = FWD.clone();
    return { f: frame(o, axis, refDir), len };
  };
  const gameJointPos = (j: string) => gamePos(j);
  const srcJointPos = (j: string) => sp(PRIMARY[j]);
  const ibm = new Map<string, THREE.Matrix4>();
  for (const j of joints) {
    const rest = restWorld.get(j.name)!;
    if (!PRIMARY[j.name]) { ibm.set(j.name, rest.clone().invert()); continue; }
    const a = boneFrame(j.name, gameJointPos), b = boneFrame(j.name, srcJointPos);
    const r = a.len !== null && b.len ? a.len / b.len : g;
    const stretch = new THREE.Matrix4().makeScale(r, g, g);
    ibm.set(j.name, rest.clone().invert().multiply(a.f).multiply(stretch).multiply(b.f.clone().invert()));
  }

  // Soldier bone → game joint: by name, else the nearest mapped ancestor.
  const toGame = new Map<string, string>(Object.entries(PRIMARY).map(([game, src]) => [src, game]));
  for (const [src, game] of Object.entries(EXTRA)) toGame.set(src, game);
  const gameOf = (bone: THREE.Object3D): string => {
    for (let b: THREE.Object3D | null = bone; b; b = b.parent) { const hit = toGame.get(short(b.name)); if (hit) return hit; }
    return "root";
  };

  // Output document: the game armature, one skin, two materials.
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene("soldier");
  const armature = doc.createNode("Armature");
  scene.addChild(armature);
  const nodes = new Map<string, Node>();
  for (const j of joints) {
    const n = doc.createNode(j.name).setTranslation(j.t as [number, number, number]).setRotation(j.r as [number, number, number, number]).setScale(j.s as [number, number, number]);
    nodes.set(j.name, n);
    (j.parent ? nodes.get(j.parent)! : armature).addChild(n);
  }
  const skin: Skin = doc.createSkin("Soldier").setSkeleton(nodes.get("root")!);
  const ibmData = new Float32Array(joints.length * 16);
  joints.forEach((j, i) => { skin.addJoint(nodes.get(j.name)!); ibmData.set(ibm.get(j.name)!.elements, i * 16); });
  skin.setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(ibmData).setBuffer(buffer));
  const jointIndex = new Map(joints.map((j, i) => [j.name, i]));

  const bodyMat = await atlasMaterial(doc, BODY);
  const armsMat = await atlasMaterial(doc, ARMS);

  const acc = (type: "VEC2" | "VEC3" | "VEC4" | "SCALAR", arr: Float32Array | Uint16Array | Uint32Array) =>
    doc.createAccessor().setType(type).setArray(arr as Float32Array<ArrayBuffer>).setBuffer(buffer);
  const pieces: { name: string; prim: Primitive; key: string }[] = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), toMetres = new THREE.Matrix4().makeScale(0.01, 0.01, 0.01);
  for (const mesh of meshes) {
    const part = PART[(mesh.material as THREE.Material).name];
    if (!part) throw new Error(`unknown soldier material ${(mesh.material as THREE.Material).name}`);
    const geo = mesh.geometry;
    const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const place = toMetres.clone().multiply(mesh.bindMatrix);
    const turn = new THREE.Matrix3().getNormalMatrix(place);
    const count = pos.count;
    const P = new Float32Array(count * 3), N = new Float32Array(count * 3), UV = new Float32Array(count * 2), J = new Uint16Array(count * 4), W = new Float32Array(count * 4);
    const arm = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(place).toArray(P, i * 3);
      n.fromBufferAttribute(nrm, i).applyMatrix3(turn).normalize().toArray(N, i * 3);
      // FBXLoader UVs follow three's flipY (origin bottom left); glTF's origin is the top left.
      UV[i * 2] = THREE.MathUtils.clamp(uv.getX(i), 0, 1);
      UV[i * 2 + 1] = THREE.MathUtils.clamp(1 - uv.getY(i), 0, 1);
      const merged = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w <= 0) continue;
        const game = gameOf(mesh.skeleton.bones[si.getComponent(i, k)]);
        if (ARM_JOINT.test(game)) arm[i] += w;
        const ji = jointIndex.get(game)!;
        merged.set(ji, (merged.get(ji) ?? 0) + w);
      }
      const top = [...merged].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = top.reduce((s, [, w]) => s + w, 0) || 1;
      top.forEach(([ji, w], k) => { J[i * 4 + k] = ji; W[i * 4 + k] = w / total; });
      if (!top.length) { J[i * 4] = jointIndex.get("root")!; W[i * 4] = 1; }
    }
    const index = geo.index ? Array.from(geo.index.array) : Array.from({ length: count }, (_, i) => i);
    const dropped = droppedTriangles(mesh, index);
    // Sleeves (and gloves) go to the first-person arms; the rest of the jacket stays on the body.
    const groups: { arms: boolean; tris: number[] }[] = [{ arms: false, tris: [] }, { arms: true, tris: [] }];
    for (let t = 0; t < index.length; t += 3) {
      if (dropped[t / 3]) continue;
      const a = index[t], b = index[t + 1], c = index[t + 2];
      const isArm = part === "Gloves" || (part === "Kitel" && arm[a] > 0.5 && arm[b] > 0.5 && arm[c] > 0.5);
      groups[isArm ? 1 : 0].tris.push(a, b, c);
    }
    for (const grp of groups) {
      if (!grp.tris.length) continue;
      const atlas = grp.arms ? ARMS : BODY;
      const cell = atlas.cells[part];
      const uvOut = new Float32Array(UV.length);
      // Half a texel in from the cell edge, so filtering stays inside the part.
      const px = 2 / atlas.width, py = 2 / atlas.height;
      for (let i = 0; i < count; i++) {
        uvOut[i * 2] = cell.x / atlas.width + px + UV[i * 2] * (cell.w / atlas.width - 2 * px);
        uvOut[i * 2 + 1] = cell.y / atlas.height + py + UV[i * 2 + 1] * (cell.h / atlas.height - 2 * py);
      }
      const prim = doc.createPrimitive()
        .setAttribute("POSITION", acc("VEC3", P.slice()))
        .setAttribute("NORMAL", acc("VEC3", N.slice()))
        .setAttribute("TEXCOORD_0", acc("VEC2", uvOut))
        .setAttribute("JOINTS_0", acc("VEC4", J.slice()))
        .setAttribute("WEIGHTS_0", acc("VEC4", W.slice()))
        .setIndices(acc("SCALAR", new Uint32Array(grp.tris)))
        .setMaterial(grp.arms ? armsMat : bodyMat);
      const key = grp.arms && part === "Kitel" ? "Arms_Kitel" : part;
      pieces.push({ name: `${grp.arms ? "Arms" : "Body"}_${part}`, prim, key });
    }
  }

  // Each piece keeps only its own vertices, welded, then simplified part by part.
  for (const { name, prim } of pieces) {
    compactPrimitive(prim);
    const mesh = doc.createMesh(name).addPrimitive(prim);
    armature.addChild(doc.createNode(name).setMesh(mesh).setSkin(skin));
  }
  await doc.transform(weld());
  let before = 0, after = 0;
  for (const { prim, key } of pieces) {
    const tris0 = prim.getIndices()!.getCount() / 3;
    const [ratio, error] = SIMPLIFY[key];
    if (simplify && ratio < 1) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: true });
    const tris1 = prim.getIndices()!.getCount() / 3;
    before += tris0; after += tris1;
  }
  console.log(`[soldier] ${before} → ${after} triangles`);
  await compressTextures(doc, 4096, 86);
  const out = path.join(PUBLIC_MODELS, file);
  const bytes = await writeGLB(doc, out, { compress: true });
  console.log(`[soldier] ${path.basename(out)} ${(bytes / 1e6).toFixed(2)} MB`);
}

/** Packs each part's maps into one albedo (alpha: team tint mask), normal and occlusion/roughness/metal atlas. */
async function atlasMaterial(doc: Document, atlas: Atlas): Promise<Material> {
  const scale = atlas.detail / atlas.width;
  const W = atlas.width, H = atlas.height, dw = Math.round(W * scale), dh = Math.round(H * scale);
  const albedo = Buffer.alloc(W * H * 4);
  const normal = Buffer.alloc(dw * dh * 3);
  const orm = Buffer.alloc(dw * dh * 3);
  for (let i = 0; i < dw * dh; i++) { normal[i * 3] = 128; normal[i * 3 + 1] = 128; normal[i * 3 + 2] = 255; orm[i * 3] = 255; orm[i * 3 + 1] = 200; }
  const raw = async (file: string, w: number, h: number, channels: 1 | 3) => {
    const img = sharp(path.join(TEX, file)).resize(w, h, { fit: "fill" }).removeAlpha();
    return (channels === 1 ? img.greyscale() : img.toColourspace("srgb")).raw().toBuffer();
  };
  const blit = (dst: Buffer, dstW: number, dstC: number, src: Buffer, srcC: number, x0: number, y0: number, w: number, h: number, channel = -1) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = ((y0 + y) * dstW + x0 + x) * dstC, s = (y * w + x) * srcC;
      if (channel >= 0) dst[d + channel] = src[s];
      else for (let c = 0; c < srcC; c++) dst[d + c] = src[s + c];
    }
  };
  for (const [part, cell] of Object.entries(atlas.cells)) {
    const maps = MAPS[part];
    // Never 0: WebP drops the colour of fully transparent pixels.
    const tint = TINTED.has(part) ? 255 : 128;
    if (maps.albedo) blit(albedo, W, 4, await raw(maps.albedo, cell.w, cell.h, 3), 3, cell.x, cell.y, cell.w, cell.h);
    else for (let y = 0; y < cell.h; y++) for (let x = 0; x < cell.w; x++) { const d = ((cell.y + y) * W + cell.x + x) * 4; albedo[d] = maps.color![0]; albedo[d + 1] = maps.color![1]; albedo[d + 2] = maps.color![2]; }
    for (let y = 0; y < cell.h; y++) for (let x = 0; x < cell.w; x++) albedo[((cell.y + y) * W + cell.x + x) * 4 + 3] = tint;
    const cx = Math.round(cell.x * scale), cy = Math.round(cell.y * scale), cw = Math.round(cell.w * scale), ch = Math.round(cell.h * scale);
    if (maps.normal) blit(normal, dw, 3, await raw(maps.normal, cw, ch, 3), 3, cx, cy, cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const d = ((cy + y) * dw + cx + x) * 3;
      orm[d] = 255; orm[d + 1] = Math.round((maps.roughness ?? 0.8) * 255); orm[d + 2] = 0;
    }
    if (maps.ao) blit(orm, dw, 3, await raw(maps.ao, cw, ch, 1), 1, cx, cy, cw, ch, 0);
    if (maps.rough) blit(orm, dw, 3, await raw(maps.rough, cw, ch, 1), 1, cx, cy, cw, ch, 1);
    if (maps.metal) blit(orm, dw, 3, await raw(maps.metal, cw, ch, 1), 1, cx, cy, cw, ch, 2);
  }
  const png = (data: Buffer, w: number, h: number, channels: 3 | 4) => sharp(data, { raw: { width: w, height: h, channels } }).png().toBuffer();
  const tex = async (name: string, data: Buffer, w: number, h: number, channels: 3 | 4) =>
    doc.createTexture(name).setImage(new Uint8Array(await png(data, w, h, channels))).setMimeType("image/png");
  return doc.createMaterial(atlas.name)
    .setBaseColorTexture(await tex(`${atlas.name}_BaseColor`, albedo, W, H, 4))
    .setNormalTexture(await tex(`${atlas.name}_Normal`, normal, dw, dh, 3))
    .setOcclusionTexture(await tex(`${atlas.name}_ORM`, orm, dw, dh, 3))
    .setMetallicRoughnessTexture(doc.getRoot().listTextures().find((t) => t.getName() === `${atlas.name}_ORM`)!)
    .setMetallicFactor(1).setRoughnessFactor(1)
    .setAlphaMode("OPAQUE");
}
