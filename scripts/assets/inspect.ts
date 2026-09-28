// Prints a quick summary of glTF files: bounds, meshes, materials, skins, animations.
// Usage: npx tsx scripts/assets/inspect.ts <file...>
import { getBounds } from "@gltf-transform/core";
import { readModel } from "./common";

async function main() {
  for (const f of process.argv.slice(2)) {
    const doc = await readModel(f);
    const r = doc.getRoot();
    const b = getBounds(r.listScenes()[0]);
    const fmt = (v: number[]) => v.map((x) => x.toFixed(2)).join(",");
    console.log(`## ${f.split(/[\\/]/).pop()}  bounds ${fmt(b.min)} | ${fmt(b.max)}`);
    for (const n of r.listNodes().filter((n) => n.getMesh())) {
      const prims = n.getMesh()!.listPrimitives()
        .map((p) => `${p.getMaterial()?.getName()}:${(p.getIndices()?.getCount() ?? 0) / 3}`);
      console.log(`  mesh ${n.getName()}${n.getSkin() ? " (skinned)" : ""} [${prims.join(", ")}]`);
    }
    console.log(`  skins ${r.listSkins().map((s) => s.listJoints().length).join(",") || "-"}  anims ${r.listAnimations().length}`);
    console.log(`  textures ${r.listTextures().map((t) => t.getURI() || t.getName()).join(", ")}`);
  }
}
main();
