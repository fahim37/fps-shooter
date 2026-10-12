import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Document, Mesh } from "@gltf-transform/core";
import { simplifyPrimitive, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import {
  RAW, PUBLIC_MODELS, GENERATED, mergeAsPieces, compressTextures, writeGLB,
  buildCollision, buildBoxProxyCollision, writeCollisionBin, pieceBounds, writeJSON, type CollisionMesh, type PieceInfo,
} from "./common";

interface KitConfig {
  name: string;
  dir: string;
  /** Piece names to import (default: every .gltf in dir). */
  include?: (name: string) => boolean;
  /** Pieces without collision (foliage, decals, tiny props). */
  noCollide?: RegExp;
  /** Materials never used for collision (leaves, vines). */
  noCollideMaterial?: RegExp;
  /** Replacement images keyed by texture file name: a file path, or a function producing PNG bytes. */
  imageOverrides?: Record<string, string | (() => Promise<Buffer>)>;
  textureSize: number;
  /** Smaller size for normal, occlusion and metal/roughness maps (default: textureSize). */
  detailTextureSize?: number;
  /** Drop COLOR_0: some packs store shader masks (wear, dirt) there, which read as tints in three. */
  stripVertexColors?: boolean;
  /** Removes primitives using `materials` from pieces matching `pieces`. */
  dropMaterials?: { pieces: RegExp; materials: RegExp };
  /** Simplify the render meshes of pieces with more triangles than this. */
  simplifyOver?: number;
  /** Simplifier error for collision meshes, in meters. */
  collisionError: number;
  /** Solid prefab buildings: a box for the body plus street-level details (see buildBoxProxyCollision). */
  boxProxy?: RegExp;
}

const village: KitConfig = {
  name: "village",
  dir: path.join(RAW, "village/glTF"),
  noCollide: /^Prop_Vine|^Prop_Brick\d/,
  noCollideMaterial: /Vine|Leaf/i,
  // The pack's glTF folder ships DirectX (Unreal) normals; glTF expects OpenGL.
  imageOverrides: Object.fromEntries(
    ["Brick", "Plaster", "RockTrim", "RoundTiles", "UnevenBrick", "WoodTrim"].map((n) => [
      `T_${n}_Normal.png`,
      path.join(RAW, `village/Textures/Normals Godot-Unity/T_${n}_Normal.png`),
    ]),
  ),
  textureSize: 1024,
  collisionError: 0.03,
};

const nature: KitConfig = {
  name: "nature",
  dir: path.join(RAW, "nature/glTF"),
  // Twisted trees and bushes ship with red autumn leaves; tint the white leaf mask green instead.
  imageOverrides: {
    "Leaves_TwistedTree_C.png": () => tintMask(path.join(RAW, "nature/Textures/Leaves_TwistedTree.png"), [0.36, 0.52, 0.17]),
  },
  include: (n) => !/^Petal_|^Clover_2|^Flower_\d_Single/.test(n),
  noCollide: /^(Bush|Clover|Fern|Flower|Grass|Mushroom|Pebble|Plant|RockPath)/,
  noCollideMaterial: /Leaves|Leaf|Grass|Flowers/i,
  textureSize: 1024,
  collisionError: 0.08,
};

const PROPS = [
  "Barrel", "Barrel_Apples", "Barrel_Holder", "Bench", "Bucket_Wooden_1", "Cage_Small", "Cauldron",
  "Chest_Wood", "Crate_Metal", "Crate_Wooden", "Dummy", "FarmCrate_Apple", "FarmCrate_Carrot",
  "FarmCrate_Empty", "Lantern_Wall", "Stall_Cart_Empty", "Stall_Empty", "Table_Large", "Stool",
  "Torch_Metal", "Workbench", "WeaponStand", "Anvil", "Anvil_Log", "Banner_1", "Banner_2", "Bag", "Pot_1",
  "Rope_1", "Shield_Wooden", "Vase_2", "Vase_4", "Vase_Rubble_Medium", "Chair_1", "Bed_Twin1", "Cabinet",
  "Bookcase_2", "Shelf_Simple", "Nightstand_Shelf", "CandleStick_Stand", "Chandelier",
];

const props: KitConfig = {
  name: "props",
  dir: path.join(RAW, "props/Exports/glTF"),
  include: (n) => PROPS.includes(n),
  noCollide: /^(Rope_|Lantern_Wall|Banner_|Chandelier|CandleStick|Torch_Metal|Bag|Pot_1|Vase_Rubble)/,
  textureSize: 1024,
  collisionError: 0.03,
};

/** Downtown City MegaKit (Standard, CC0). Only the pieces the city map places are shipped. */
const CITY = [
  "Building_Large_2", "Building_Medium_2_001", "Building_Small_1",
  "Street_4WayIntersection", "Street_TIntersection", "Street_2Lane", "Street_4Lane", "Street_Asphalt_6x6",
  "Sidewalk_Straight_3m", "Sidewalk_NoCurb_3m", "Sidewalk_Corner_Round_3m", "Sidewalk_Planter",
  "Decal_Crosswalk", "Decal_ArrowStraight", "Decal_Stop", "Decal_Slow",
  "Brick_Plain_3", "Brick_Plain_1", "Brick_TopTrim", "Brick_Window_Trim", "Brick_Window_Trim_Single",
  "Brick_Window_Square_Single", "Brick_Inset_Window", "Brick_Corner_Plain", "Brick_TopTrim_Corner",
  "Metal_FirstFloor_Wall", "Metal_FirstFloor_Window", "Metal_FullWindow", "Metal_Plain_3", "Metal_Plain_1",
  "Trim_FirstFloor_Wall", "Trim_FirstFloor_Window_001", "Trim_Corner", "Trim_Plain_3",
  "DoorFrame_Metal_Single", "DoorFrame_Wooden", "DoorFrame_Trim",
  "Cornice_Brick_Center", "Cornice_Brick_90Angle_L", "Cornice_Metal_Center", "Cornice_Metal_90Angle_L",
  "Floor_4x4", "Floor_2x2", "Roof_4x4", "Roof_2x2", "Stairs_Rails_Metal", "Stairs_Entrance_Concrete",
  "Entrance_Concrete_2x2", "Entrance_Concrete_2x1",
  "Prop_ACUnit", "Prop_Bollard", "Prop_ManholeCover", "Prop_Drain", "Prop_Planter_Single",
];

const city: KitConfig = {
  name: "city",
  dir: path.join(RAW, "city/Exports/glTF (Godot)"),
  include: (n) => CITY.includes(n),
  noCollide: /^(Decal_|Prop_ManholeCover|Prop_Drain)/,
  noCollideMaterial: /Glass|StreetDecals/i,
  stripVertexColors: true,
  // Modular windows and doors become open frames: a pane bullets pass through would hide players
  // standing behind it, and the fake-interior card would block the real room. Prefab buildings
  // are solid, so they keep their glass and fake interiors.
  dropMaterials: { pieces: /^(?!Building_)/, materials: /^MI_(Glass|FakeInterior)/ },
  textureSize: 1024,
  // Normal/ORM detail barely reads at FPS distances; halving them saves most of the kit's VRAM.
  detailTextureSize: 512,
  // Building facades are dense ornament; ~1 cm simplification removes ~40% of triangles invisibly.
  simplifyOver: 2000,
  collisionError: 0.05,
  // Thousands of facade-ornament triangles collapse to one box; entrance stairs keep their shape.
  boxProxy: /^Building_/,
};

export const KITS = { village, nature, props, city };

export async function importKit(kit: KitConfig) {
  const files = fs.readdirSync(kit.dir)
    .filter((f) => f.endsWith(".gltf"))
    .map((f) => path.join(kit.dir, f))
    .filter((f) => !kit.include || kit.include(path.basename(f, ".gltf")));
  console.log(`[${kit.name}] merging ${files.length} pieces`);
  const doc = await mergeAsPieces(files, (f) => path.basename(f, ".gltf"));

  if (kit.imageOverrides) {
    for (const tex of doc.getRoot().listTextures()) {
      const override = kit.imageOverrides[path.basename(tex.getURI())];
      if (typeof override === "string") tex.setImage(fs.readFileSync(override)).setMimeType("image/png");
      else if (override) tex.setImage(await override()).setMimeType("image/png");
    }
  }

  if (kit.dropMaterials) {
    const { pieces, materials } = kit.dropMaterials;
    for (const node of doc.getRoot().listScenes()[0].listChildren()) {
      if (!pieces.test(node.getName())) continue;
      node.traverse((n) => {
        const mesh = n.getMesh();
        for (const prim of mesh?.listPrimitives() ?? []) {
          if (materials.test(prim.getMaterial()?.getName() ?? "")) { mesh!.removePrimitive(prim); prim.dispose(); }
        }
      });
    }
  }

  if (kit.stripVertexColors) {
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute("COLOR_0", null);
  }

  const pieces: Record<string, PieceInfo> = {};
  const collision = new Map<string, CollisionMesh | null>();
  for (const node of doc.getRoot().listScenes()[0].listChildren()) {
    const name = node.getName();
    pieces[name] = pieceBounds(node);
    const collides = !kit.noCollide?.test(name);
    collision.set(name, collides ? (kit.boxProxy?.test(name) ? buildBoxProxyCollision : buildCollision)(node, kit.noCollideMaterial ?? null, kit.collisionError) : null);
  }
  const { ranges, positionsByteLength } = writeCollisionBin(
    path.join(PUBLIC_MODELS, `${kit.name}.collision.bin`), collision,
  );
  for (const [name, r] of ranges) pieces[name].col = r;

  // After collision, so colliders come from the original surfaces.
  if (kit.simplifyOver) await simplifyHeavy(doc, kit.simplifyOver);
  await compressTextures(doc, kit.textureSize, 86, kit.detailTextureSize);
  const bytes = await writeGLB(doc, path.join(PUBLIC_MODELS, `${kit.name}.glb`));
  writeJSON(path.join(GENERATED, `${kit.name}-pieces.json`), { positionsByteLength, pieces });

  let tris = 0;
  for (const r of ranges.values()) tris += r[3] / 3;
  console.log(`[${kit.name}] ${(bytes / 1e6).toFixed(1)} MB glb, ${ranges.size} colliders (${tris} tris)`);
}

/** Simplifies the meshes of pieces above `maxTris` at ~0.05% of their radius (UV seams stay locked). */
async function simplifyHeavy(doc: Document, maxTris: number) {
  const tris = (m: Mesh) => m.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  const heavy = doc.getRoot().listMeshes().filter((m) => tris(m) > maxTris);
  if (!heavy.length) return;
  const before = heavy.reduce((n, m) => n + tris(m), 0);
  await doc.transform(weld());
  for (const mesh of heavy)
    for (const prim of mesh.listPrimitives()) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error: 0.0005, lockBorder: false });
  console.log(`  simplified ${heavy.length} heavy meshes: ${before} → ${heavy.reduce((n, m) => n + tris(m), 0)} tris`);
}

/** Multiplies the RGB of a white alpha-masked texture by a color, keeping alpha. */
async function tintMask(file: string, rgb: [number, number, number]): Promise<Buffer> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * rgb[c]);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}
