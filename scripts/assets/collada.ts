import fs from "node:fs";

/**
 * A small COLLADA 1.4 reader: triangles and polylists, grouped by the node they sit under
 * and by material, with every node transform and `instance_node` applied. Lines are dropped.
 * Node has no DOM, and three's ColladaLoader needs one.
 */

export interface DaeMaterial { name: string; color: [number, number, number, number]; texture?: string; doubleSided: boolean }
/** Triangles of one geometry primitive in the file's space (Z up, in the file's units). */
export interface DaeMesh {
  /** Node names from the scene root down. */
  path: string[];
  material: string;
  /** Three floats per corner, three corners per triangle. */
  pos: Float32Array;
}
export interface DaeScene { unit: number; materials: Map<string, DaeMaterial>; meshes: DaeMesh[] }

interface El { tag: string; attrs: Record<string, string>; kids: El[]; text: string }

const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

/** Whole-document parse: the file is machine-written, so tags are regular. */
function parseXml(src: string): El {
  const root: El = { tag: "#root", attrs: {}, kids: [], text: "" };
  const stack = [root];
  const tag = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<\?[^>]*\?>|<!--[\s\S]*?-->/g;
  let last = 0;
  for (let m = tag.exec(src); m; m = tag.exec(src)) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.text += src.slice(last, m.index);
    last = tag.lastIndex;
    if (!m[2]) continue;
    if (m[1]) { stack.pop(); continue; }
    const el: El = { tag: m[2], attrs: {}, kids: [], text: "" };
    for (const a of (m[3] ?? "").matchAll(ATTR)) el.attrs[a[1]] = a[2];
    top.kids.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}

const kid = (e: El | undefined, tag: string) => e?.kids.find((k) => k.tag === tag);
const kids = (e: El, tag: string) => e.kids.filter((k) => k.tag === tag);
function floats(text: string) {
  const parts = text.trim().split(/\s+/);
  const out = new Float64Array(parts.length);
  for (let i = 0; i < parts.length; i++) out[i] = +parts[i];
  return out;
}
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

type M4 = number[];
const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** Row-major, as COLLADA writes them. */
function mul(a: M4, b: M4): M4 {
  const o = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}

interface Source { data: Float64Array; stride: number }
interface Prim { symbol: string; pos: Float64Array }

/** A polylist's polygons as triangle fans. Plain triangles (no `vcount`) pass through. */
function fanned(idx: Float64Array, width: number, vcount: El | undefined) {
  if (!vcount) return idx;
  const out: number[] = [];
  let corner = 0;
  for (const n of floats(vcount.text)) {
    for (let k = 1; k < n - 1; k++) {
      for (const c of [corner, corner + k, corner + k + 1]) out.push(...idx.subarray(c * width, (c + 1) * width));
    }
    corner += n;
  }
  return Float64Array.from(out);
}

/** Corners of each <triangles> or <polylist> element, expanded out of its index streams. */
function readGeometry(geometry: El): Prim[] {
  const mesh = kid(geometry, "mesh");
  if (!mesh) return [];
  const sources = new Map<string, Source>();
  for (const s of kids(mesh, "source")) {
    const array = kid(s, "float_array");
    if (!array) continue;
    sources.set(s.attrs.id, { data: floats(array.text), stride: +(kid(kid(s, "technique_common"), "accessor")?.attrs.stride ?? 3) });
  }
  const vertices = new Map<string, Record<string, Source>>();
  for (const v of kids(mesh, "vertices")) {
    const inputs: Record<string, Source> = {};
    for (const i of kids(v, "input")) inputs[i.attrs.semantic] = sources.get(i.attrs.source.slice(1))!;
    vertices.set(v.attrs.id, inputs);
  }
  const prims: Prim[] = [];
  for (const t of [...kids(mesh, "triangles"), ...kids(mesh, "polylist")]) {
    let width = 0;
    let P: { src: Source; off: number } | undefined;
    for (const i of kids(t, "input")) {
      const off = +i.attrs.offset;
      width = Math.max(width, off + 1);
      if (i.attrs.semantic === "VERTEX") P = { src: vertices.get(i.attrs.source.slice(1))!.POSITION, off };
    }
    const p = kid(t, "p");
    if (!p || !P) continue;
    const idx = fanned(floats(p.text), width, kid(t, "vcount")), n = idx.length / width;
    const pos = new Float64Array(n * 3);
    for (let c = 0; c < n; c++) for (let k = 0; k < 3; k++) pos[c * 3 + k] = P.src.data[idx[c * width + P.off] * P.src.stride + k];
    prims.push({ symbol: t.attrs.material ?? "", pos });
  }
  return prims;
}

export function readDae(file: string): DaeScene {
  const root = kid(parseXml(fs.readFileSync(file, "utf8")), "COLLADA")!;
  const unit = +(kid(kid(root, "asset"), "unit")?.attrs.meter ?? 1);

  const images = new Map<string, string>();
  for (const i of kid(root, "library_images")?.kids ?? []) images.set(i.attrs.id, unescape(kid(i, "init_from")?.text.trim() ?? ""));

  const effects = new Map<string, Omit<DaeMaterial, "name">>();
  for (const e of kid(root, "library_effects")?.kids ?? []) {
    const profile = kid(e, "profile_COMMON");
    if (!profile) continue;
    const surfaces = new Map<string, string>(), samplers = new Map<string, string>();
    for (const p of kids(profile, "newparam")) {
      const surface = kid(p, "surface"), sampler = kid(p, "sampler2D");
      if (surface) surfaces.set(p.attrs.sid, kid(surface, "init_from")?.text.trim() ?? "");
      if (sampler) samplers.set(p.attrs.sid, kid(sampler, "source")?.text.trim() ?? "");
    }
    const shader = kid(profile, "technique")?.kids.find((k) => /lambert|phong|blinn|constant/.test(k.tag));
    const diffuse = kid(shader, "diffuse");
    const color = kid(diffuse, "color"), texture = kid(diffuse, "texture");
    const c = color ? floats(color.text) : [1, 1, 1, 1];
    const image = texture ? images.get(surfaces.get(samplers.get(texture.attrs.texture) ?? "") ?? "") : undefined;
    const transparency = +(kid(kid(shader, "transparency"), "float")?.text ?? 1);
    const doubleSided = (kid(profile, "extra")?.kids ?? []).some((k) => /double/i.test(JSON.stringify(k)));
    effects.set(e.attrs.id, { color: [c[0], c[1], c[2], transparency], texture: image, doubleSided });
  }

  const materials = new Map<string, DaeMaterial>();
  for (const m of kid(root, "library_materials")?.kids ?? []) {
    const effect = effects.get(kid(m, "instance_effect")?.attrs.url.slice(1) ?? "");
    materials.set(m.attrs.id, { name: unescape(m.attrs.name ?? m.attrs.id), color: effect?.color ?? [1, 1, 1, 1], texture: effect?.texture, doubleSided: effect?.doubleSided ?? false });
  }

  const geometries = new Map<string, El>();
  for (const g of kid(root, "library_geometries")?.kids ?? []) geometries.set(g.attrs.id, g);
  const parsed = new Map<string, Prim[]>();
  const library = new Map<string, El>();
  for (const n of kid(root, "library_nodes")?.kids ?? []) library.set(n.attrs.id, n);

  const meshes: DaeMesh[] = [];
  const visit = (node: El, parent: M4, path: string[], depth: number) => {
    if (depth > 64) throw new Error("node cycle");
    let m = parent;
    for (const k of node.kids) if (k.tag === "matrix") m = mul(m, Array.from(floats(k.text)));
    const here = node.attrs.name ? [...path, unescape(node.attrs.name)] : path;
    for (const k of node.kids) {
      if (k.tag === "node") visit(k, m, here, depth + 1);
      else if (k.tag === "instance_node") visit(library.get(k.attrs.url.slice(1))!, m, here, depth + 1);
      else if (k.tag === "instance_geometry") {
        const id = k.attrs.url.slice(1);
        let prims = parsed.get(id);
        if (!prims) parsed.set(id, (prims = readGeometry(geometries.get(id)!)));
        const bindings = new Map<string, string>();
        for (const b of kid(kid(k, "bind_material"), "technique_common")?.kids ?? []) bindings.set(b.attrs.symbol, b.attrs.target.slice(1));
        for (const prim of prims) meshes.push(place(prim, m, here, bindings.get(prim.symbol) ?? ""));
      }
    }
  };
  const scene = kid(root, "library_visual_scenes")?.kids[0];
  for (const n of scene ? kids(scene, "node") : []) visit(n, IDENTITY, [], 0);
  return { unit, materials, meshes };
}

/** A primitive through its node's matrix. A mirrored node flips winding, so its corners swap. */
function place(prim: Prim, m: M4, path: string[], material: string): DaeMesh {
  const n = prim.pos.length / 3;
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
  const pos = new Float32Array(n * 3);
  for (let c = 0; c < n; c++) {
    const src = det < 0 && c % 3 ? c + (c % 3 === 1 ? 1 : -1) : c;
    const [x, y, z] = [prim.pos[src * 3], prim.pos[src * 3 + 1], prim.pos[src * 3 + 2]];
    pos[c * 3] = m[0] * x + m[1] * y + m[2] * z + m[3];
    pos[c * 3 + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    pos[c * 3 + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return { path, material, pos };
}
