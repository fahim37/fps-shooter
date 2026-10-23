import path from "node:path";
import { getBounds, type Node } from "@gltf-transform/core";
import { dedup, flatten, join } from "@gltf-transform/functions";
import {
  RAW, PUBLIC_MODELS, GENERATED, readModel, writeGLB, buildCollision, writeCollisionBin, pieceBounds, writeJSON,
  type CollisionMesh, type PieceInfo,
} from "./common";

/**
 * "Outpost": the "LOWPOLY | FPS | TDM | GAME | MAP" by ResoForge (Sketchfab, CC BY 4.0), a
 * finished arena in one GLB with flat material colors and no textures.
 *
 * The source is a 8.6 x 16.4 unit diorama where a barrel stands 0.35 units tall. It is scaled up
 * so a barrel stands about a meter high, which also makes the arena roomy enough for 6v6, and the
 * whole map stays one piece placed at the origin (the scale sits on a child node, so the piece
 * itself keeps an identity transform and its parts carry the scale).
 *
 * Players wear blue and red, so the source's red, orange-red and blue materials are repainted in
 * drab military colors. Building footprints for the minimap are measured here too.
 *
 * Put the downloaded GLB at assets-raw/resoforge/map.glb.
 */

export const OUTPOST_SCALE = 4;
const SRC = path.join(RAW, "resoforge/map.glb");

/** Repaints by source material (sRGB hex). Others keep their colors (grays, tan wood). */
const REPAINT: Record<string, string> = {
  material_3: "#6d7448", //  red props → olive drab
  material_9: "#b9a47c", //  orange-red floors, crates and wall caps → sand
  material_6: "#a8873e", //  orange building → ochre
  blue: "#4d6157", //        blue trims → slate green
};

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLinear = (hex: string) => [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));

export async function importOutpost() {
  const doc = await readModel(SRC);
  const root = doc.getRoot();
  for (const m of root.listMaterials()) {
    const hex = REPAINT[m.getName()];
    if (hex) m.setBaseColorFactor([...hexLinear(hex), 1] as [number, number, number, number]);
    // Flat colors: a little roughness reads better under the game's sun than glossy defaults.
    m.setMetallicFactor(0).setRoughnessFactor(Math.max(0.75, m.getRoughnessFactor()));
  }

  const scene = root.listScenes()[0];

  // Minimap footprints: every object at least player height, as a world rectangle.
  const footprints: { x: number; z: number; sx: number; sz: number; h: number }[] = [];
  const S = OUTPOST_SCALE, r = (v: number) => Math.round(v * S * 100) / 100;
  for (const n of findRoot(scene.listChildren()[0]).listChildren()) {
    const b = getBounds(n);
    if (!Number.isFinite(b.min[0])) continue;
    const h = b.max[1] - b.min[1];
    if (h * S < 1.7 || (b.max[0] - b.min[0]) * S > 30) continue; // low clutter; the whole-map floor
    footprints.push({ x: r(b.min[0]), z: r(b.min[2]), sx: r(b.max[0] - b.min[0]), sz: r(b.max[2] - b.min[2]), h: r(h) });
  }

  // Hundreds of small meshes in a handful of colors: merge them per material (about 600 draw
  // calls down to a few dozen).
  await doc.transform(dedup(), flatten(), join({ keepNamed: false }));
  const piece = doc.createNode("Outpost");
  const scaled = doc.createNode("Outpost_scale").setScale([S, S, S]);
  for (const child of scene.listChildren()) { scene.removeChild(child); scaled.addChild(child); }
  piece.addChild(scaled);
  scene.addChild(piece);

  const bytes = await writeGLB(doc, path.join(PUBLIC_MODELS, "outpost.glb"));
  // Collision from the written document's real triangles (low-poly already: light simplification).
  const collision = new Map<string, CollisionMesh | null>([["Outpost", buildCollision(piece, null, 0.02)]]);
  const { ranges, positionsByteLength } = writeCollisionBin(path.join(PUBLIC_MODELS, "outpost.collision.bin"), collision);
  const pieces: Record<string, PieceInfo> = { Outpost: { ...pieceBounds(piece), col: ranges.get("Outpost") } };
  writeJSON(path.join(GENERATED, "outpost-pieces.json"), { positionsByteLength, pieces, footprints });
  const tris = (ranges.get("Outpost")?.[3] ?? 0) / 3;
  const p = pieces.Outpost;
  console.log(`[outpost] ${(bytes / 1e6).toFixed(2)} MB glb, ${tris} collision tris, ${footprints.length} footprints, bounds ${p.min.join(",")} .. ${p.max.join(",")}`);
}

/** The Sketchfab export's "Root" node holding the map objects. */
function findRoot(node: Node): Node {
  let found: Node | null = null;
  node.traverse((n) => { if (!found && n.getName() === "Root") found = n; });
  return found ?? node;
}
