import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  RAW, PUBLIC_MODELS, GENERATED, mergeAsPieces, compressTextures, writeGLB,
  buildCollision, writeCollisionBin, pieceBounds, writeJSON, type CollisionMesh, type PieceInfo,
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
  /** Simplifier error for collision meshes, in meters. */
  collisionError: number;
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

export const KITS = { village, nature, props };

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

  const pieces: Record<string, PieceInfo> = {};
  const collision = new Map<string, CollisionMesh | null>();
  for (const node of doc.getRoot().listScenes()[0].listChildren()) {
    const name = node.getName();
    pieces[name] = pieceBounds(node);
    const collides = !kit.noCollide?.test(name);
    collision.set(name, collides ? buildCollision(node, kit.noCollideMaterial ?? null, kit.collisionError) : null);
  }
  const { ranges, positionsByteLength } = writeCollisionBin(
    path.join(PUBLIC_MODELS, `${kit.name}.collision.bin`), collision,
  );
  for (const [name, r] of ranges) pieces[name].col = r;

  await compressTextures(doc, kit.textureSize);
  const bytes = await writeGLB(doc, path.join(PUBLIC_MODELS, `${kit.name}.glb`));
  writeJSON(path.join(GENERATED, `${kit.name}-pieces.json`), { positionsByteLength, pieces });

  let tris = 0;
  for (const r of ranges.values()) tris += r[3] / 3;
  console.log(`[${kit.name}] ${(bytes / 1e6).toFixed(1)} MB glb, ${ranges.size} colliders (${tris} tris)`);
}

/** Multiplies the RGB of a white alpha-masked texture by a color, keeping alpha. */
async function tintMask(file: string, rgb: [number, number, number]): Promise<Buffer> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * rgb[c]);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}
