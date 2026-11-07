import fs from "node:fs";

// Reads mesh objects straight out of an uncompressed .blend, so a model shipped only as a Blender
// source needs no Blender here. Nothing in the file is executed: it is parsed as data, using the
// struct layout (SDNA) the file carries. Only the mesh layout Blender 3.6 and earlier write is
// understood; modifiers are not applied.

interface Field { off: number; type: string; size: number }
interface Block { code: string; size: number; ptr: bigint; off: number; scope: Map<bigint, Block> }

export interface BlendObject {
  name: string;
  /** World-space vertices, x y z. */
  verts: Float32Array;
  /** Triangle indices into `verts`, by material name. */
  tris: Map<string, number[]>;
}

const MESH_OBJECT = 1;
const CD_MVERT = 0, CD_MPOLY = 25, CD_MLOOP = 26;

export function readBlendMeshes(file: string): BlendObject[] {
  const d = fs.readFileSync(file);
  if (d.toString("latin1", 0, 9) !== "BLENDER-v") throw new Error(`${file}: expected an uncompressed 64-bit little-endian .blend`);

  const blocks: Block[] = [];
  const global = new Map<bigint, Block>();
  // Old addresses are only unique per ID: the DATA blocks right after an ID block belong to it.
  let scope = new Map<bigint, Block>();
  for (let p = 12; p + 24 <= d.length;) {
    const code = d.toString("latin1", p, p + 4).replace(/\0+$/, "");
    if (code === "ENDB") break;
    const size = d.readInt32LE(p + 4), ptr = d.readBigUInt64LE(p + 8);
    if (code !== "DATA") scope = new Map();
    const block: Block = { code, size, ptr, off: p + 24, scope };
    if (code === "DATA") scope.set(ptr, block);
    else global.set(ptr, block);
    blocks.push(block);
    p += 24 + size;
  }

  const structs = readSdna(d, blocks.find((b) => b.code === "DNA1")!.off);
  const field = (s: string, name: string) => {
    const f = structs.get(s)?.fields.get(name);
    if (!f) throw new Error(`${file}: no ${s}.${name}, unsupported Blender version`);
    return f;
  };
  const ptr = (off: number, s: string, name: string) => d.readBigUInt64LE(off + field(s, name).off);
  const int = (off: number, s: string, name: string) => d.readInt32LE(off + field(s, name).off);
  const short = (off: number, s: string, name: string) => d.readInt16LE(off + field(s, name).off);
  const text = (off: number, s: string, name: string) => {
    const f = field(s, name);
    const raw = d.subarray(off + f.off, off + f.off + f.size);
    return raw.toString("latin1", 0, raw.indexOf(0));
  };
  const idName = (block: Block) => text(block.off, "ID", "name").slice(2);
  const at = (owner: Block, p: bigint) => owner.scope.get(p) ?? global.get(p);

  const layer = (mesh: Block, data: string, type: number) => {
    const cd = mesh.off + field("Mesh", data).off;
    const list = at(mesh, ptr(cd, "CustomData", "layers"));
    const size = structs.get("CustomDataLayer")!.size;
    for (let i = 0; list && i < int(cd, "CustomData", "totlayer"); i++) {
      const o = list.off + i * size;
      if (int(o, "CustomDataLayer", "type") === type) return at(mesh, ptr(o, "CustomDataLayer", "data"))!.off;
    }
    throw new Error(`${file}: ${idName(mesh)} has no legacy layer ${type}, unsupported Blender version`);
  };

  const vertSize = structs.get("MVert")?.size ?? 16, loopSize = structs.get("MLoop")!.size, polySize = structs.get("MPoly")!.size;
  const out: BlendObject[] = [];
  for (const ob of blocks) {
    if (ob.code !== "OB" || short(ob.off, "Object", "type") !== MESH_OBJECT) continue;
    const mesh = global.get(ptr(ob.off, "Object", "data"))!;
    const m = Array.from({ length: 16 }, (_, i) => d.readFloatLE(ob.off + field("Object", "obmat").off + i * 4));
    const vertData = layer(mesh, "vdata", CD_MVERT), polyData = layer(mesh, "pdata", CD_MPOLY), loopData = layer(mesh, "ldata", CD_MLOOP);

    const count = int(mesh.off, "Mesh", "totvert");
    const verts = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const o = vertData + i * vertSize;
      const x = d.readFloatLE(o), y = d.readFloatLE(o + 4), z = d.readFloatLE(o + 8);
      for (let k = 0; k < 3; k++) verts[i * 3 + k] = m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k];
    }

    const slots: string[] = [];
    const slotList = at(mesh, ptr(mesh.off, "Mesh", "mat"));
    for (let i = 0; slotList && i < short(mesh.off, "Mesh", "totcol"); i++) {
      const material = global.get(d.readBigUInt64LE(slotList.off + i * 8));
      slots.push(material ? idName(material) : "none");
    }

    const tris = new Map<string, number[]>();
    for (let i = 0; i < int(mesh.off, "Mesh", "totpoly"); i++) {
      const o = polyData + i * polySize;
      const start = int(o, "MPoly", "loopstart"), corners = int(o, "MPoly", "totloop");
      const name = slots[short(o, "MPoly", "mat_nr")] ?? "none";
      const loop = (k: number) => d.readUInt32LE(loopData + (start + k) * loopSize);
      let list = tris.get(name);
      if (!list) tris.set(name, list = []);
      for (let k = 1; k < corners - 1; k++) list.push(loop(0), loop(k), loop(k + 1));
    }
    out.push({ name: idName(ob), verts, tris });
  }
  return out;
}

/** The file's own description of every struct: field offsets and sizes by name. */
function readSdna(d: Buffer, start: number) {
  let p = start + 8; // "SDNA" "NAME"
  const strings = () => {
    const n = d.readInt32LE(p);
    p += 4;
    const list: string[] = [];
    for (let i = 0; i < n; i++) {
      const end = d.indexOf(0, p);
      list.push(d.toString("latin1", p, end));
      p = end + 1;
    }
    p = (p + 3) & ~3;
    return list;
  };
  const names = strings();
  p += 4; // "TYPE"
  const types = strings();
  p += 4; // "TLEN"
  const lengths = types.map((_, i) => d.readUInt16LE(p + i * 2));
  p = (p + types.length * 2 + 3) & ~3;
  p += 4; // "STRC"
  const structs = new Map<string, { size: number; fields: Map<string, Field> }>();
  const count = d.readInt32LE(p);
  p += 4;
  for (let i = 0; i < count; i++) {
    const type = d.readUInt16LE(p), fieldCount = d.readUInt16LE(p + 2);
    p += 4;
    const fields = new Map<string, Field>();
    let off = 0;
    for (let f = 0; f < fieldCount; f++) {
      const fieldType = d.readUInt16LE(p), raw = names[d.readUInt16LE(p + 2)];
      p += 4;
      const pointer = raw.startsWith("*") || raw.startsWith("(*");
      const items = [...raw.matchAll(/\[(\d+)\]/g)].reduce((a, m) => a * Number(m[1]), 1);
      const size = (pointer ? 8 : lengths[fieldType]) * items;
      fields.set(raw.replace(/\[.*/, "").replace(/[*()]/g, ""), { off, type: types[fieldType], size });
      off += size;
    }
    structs.set(types[type], { size: lengths[type], fields });
  }
  return structs;
}
