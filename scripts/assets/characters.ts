import path from "node:path";
import { Document } from "@gltf-transform/core";
import { mergeDocuments, prune, resample, dedup } from "@gltf-transform/functions";
import { SHOWOFFS } from "../../game/shared/showcase";
import { RAW, PUBLIC_MODELS, readModel, writeGLB } from "./common";

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

/** The character itself is the soldier (soldier.ts); this stage builds the clips it plays. */
export async function importCharacters() {
  await buildAnimations();
  await buildAnimations(true);
}
