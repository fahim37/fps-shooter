import path from "node:path";
import { MeshoptSimplifier } from "meshoptimizer";
import { RAW } from "./common";
import { readBlendMeshes, type BlendObject } from "./blend";
import { replaceGun, simplify, type GunPieces, type Look } from "./gun-mesh";

// The assault rifle: a low-poly STM-556, shipped only as a Blender file and far denser than the
// other guns (28,000 triangles against about 1,300). Parts that cannot be seen are dropped and the
// rest simplified.
const SOURCE = path.join(RAW, "stm556", "stm556.blend");

/** Rounds and a spare magazine laid out beside the gun, and the bolt sealed inside it. */
const DROPPED = new Set(["55645", "55645 case", "ar15 30rnd mag  (stm)", "stm556 bolt"]);
/**
 * The tall optic on the rail: the magnified scope, shown only when a 2× or 4× is chosen. Optics are
 * not sent to other players, so only the player's own (near) gun carries it.
 */
const SCOPE = "stm556 red dot";
/** The pieces that move while reloading, by the prefix that lets the client find them. */
const MOVING: Record<string, string> = { "ar15 30rnd mag epmty (stm)": "Mag_", "stm556 charging handle": "Charge_", [SCOPE]: "Scope_" };

/** Overall length, as the gun it replaces: the rig's stance and reach are tuned to it. */
const LENGTH = 0.88;
/** Source point that becomes the weapon origin (the top of the grip). Bore height follows from it. */
const ORIGIN = { x: -1.6, z: -0.7666 };
/** Metres the surface may move when simplified, by level. The receiver runs through the view, so it stays sharper. */
const DETAIL = {
  near: { error: 0.0018, fine: { "stm556 upper": 0.0007, "stm556 lower": 0.001, [SCOPE]: 0.001 } as Record<string, number> },
  far: { error: 0.006, fine: { "stm556 upper": 0.005, "stm556 lower": 0.005 } as Record<string, number> },
};

// Linear-space PBR by source material, lifted a little from the source's near-black so the gun
// keeps its shape in shade.
const LOOKS: Record<string, Look> = {
  "h-190": { color: [0.032, 0.032, 0.035], metal: 0.6, rough: 0.48 },
  stell: { color: [0.2, 0.2, 0.205], metal: 0.8, rough: 0.42 },
  polymer: { color: [0.03, 0.03, 0.031], metal: 0, rough: 0.62 },
  polycarbonate: { color: [0.11, 0.113, 0.118], metal: 0, rough: 0.5 },
  // Coated glass: dark, with a cold glint. Opaque, so the gun stays one draw.
  lens: { color: [0.012, 0.02, 0.03], metal: 0.5, rough: 0.08 },
};

export async function importStm() {
  await MeshoptSimplifier.ready;
  const objects = readBlendMeshes(SOURCE).filter((o) => !DROPPED.has(o.name));
  let min = Infinity, max = -Infinity;
  for (const o of objects) if (o.name !== SCOPE) for (let i = 0; i < o.verts.length; i += 3) { min = Math.min(min, o.verts[i]); max = Math.max(max, o.verts[i]); }
  const scale = LENGTH / (max - min);

  const build = ({ error, fine }: typeof DETAIL.near, scope: boolean) => {
    const pieces: GunPieces = new Map();
    for (const o of objects) {
      if (o.name === SCOPE && !scope) continue;
      const place = toWeaponSpace(o, scale);
      for (const [material, tris] of o.tris) {
        const look = LOOKS[material];
        if (!look) throw new Error(`stm: no look for material ${material}`);
        const name = `${MOVING[o.name] ?? ""}${material}`;
        const piece = pieces.get(name) ?? { look, meshes: [] };
        piece.meshes.push(simplify(place, tris, fine[o.name] ?? error));
        pieces.set(name, piece);
      }
    }
    return pieces;
  };
  const { near, far, meta } = await replaceGun("ar", LENGTH, { near: build(DETAIL.near, true), far: build(DETAIL.far, false) });
  console.log(`[stm] near ${near} tris, far ${far} tris`, JSON.stringify(meta));
}

/** Muzzle from source +X to -Z, up from +Z to +Y, in metres with the grip at the origin. */
function toWeaponSpace(o: BlendObject, scale: number) {
  const out = new Float32Array(o.verts.length);
  for (let i = 0; i < out.length; i += 3) {
    out[i] = -o.verts[i + 1] * scale;
    out[i + 1] = (o.verts[i + 2] - ORIGIN.z) * scale;
    out[i + 2] = (ORIGIN.x - o.verts[i]) * scale;
  }
  return out;
}
