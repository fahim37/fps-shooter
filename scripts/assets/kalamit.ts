import path from "node:path";
import { MeshoptSimplifier } from "meshoptimizer";
import { RAW } from "./common";
import { readDae } from "./collada";
import { replaceGun, simplify, type GunPieces, type Look } from "./gun-mesh";

// The sniper: a Kalamit 52B. Its parts arrive grouped by material, so the pieces that matter are
// picked out of those groups by where they sit (source units, muzzle +X, up +Y, the gun's right +Z).
const SOURCE = path.join(RAW, "kalamit", "model.dae");

/** Overall length, as the gun it replaces: the rig's stance and reach are tuned to it. */
const LENGTH = 1.18;
/** Source point that becomes the weapon origin, at the top of the grip. */
const ORIGIN = { x: -0.434, y: -0.024 };
/** Metres the surface may move when simplified, by level. */
const DETAIL = { near: 0.0009, far: 0.0036 };

type Point = readonly [number, number, number];

/** The bipod, folded out to the sides: it would stand through walls. */
const dropped = (node: string, [x]: Point) => (node === "Dec2_low" && x > 0.3) || (node === "Dec1_low" && x > 0.1);

/** The prefix of a piece that moves while reloading, which is how the client finds it. */
function moving(node: string, [x, y, z]: Point) {
  if (node === "Dec2_low" && x < -0.05) return "Mag_";
  // A cocking knob stands on each side of the receiver; the right one works the bolt.
  if (node === "Dec4_low" && x > -0.29 && x < -0.21 && z > 0.02 && y < 0.01) return "Bolt_";
  return "";
}

// Linear-space PBR by source material, lifted a little from the source so the gun keeps its shape in shade.
const steel = (v: number, rough = 0.45): Look => ({ color: [v, v, v * 1.04], metal: 0.7, rough });
const LOOKS: Record<string, Look> = {
  Body: { color: [0.035, 0.035, 0.038], metal: 0.4, rough: 0.52 },
  Body_UP: steel(0.1, 0.4),
  GripScope_UP: steel(0.035),
  Barrel: steel(0.04, 0.42),
  Barrel_2: steel(0.1, 0.38),
  Handles: { color: [0.03, 0.03, 0.032], metal: 0.2, rough: 0.58 },
  Handles_2: steel(0.08),
  Scope: steel(0.05),
  Scope_Glass: { color: [0.1, 0.03, 0.03], metal: 0.2, rough: 0.08 },
  Detail_Parts: steel(0.06),
  Trigger: steel(0.04),
};

export async function importKalamit() {
  await MeshoptSimplifier.ready;
  const scene = readDae(SOURCE);
  const scale = LENGTH / 2; // The source runs from -1 to +1.

  const build = (error: number) => {
    const pieces: GunPieces = new Map();
    for (const mesh of scene.meshes) {
      const node = mesh.path[mesh.path.length - 1];
      const look = LOOKS[mesh.material];
      if (!look) throw new Error(`kalamit: no look for material ${mesh.material}`);
      const p = mesh.pos;
      const place = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) {
        place[i] = p[i + 2] * scale;
        place[i + 1] = (p[i + 1] - ORIGIN.y) * scale;
        place[i + 2] = (ORIGIN.x - p[i]) * scale;
      }
      const groups = new Map<string, number[]>();
      for (let v = 0; v < p.length / 3; v += 3) {
        const at = (k: number) => (p[v * 3 + k] + p[v * 3 + 3 + k] + p[v * 3 + 6 + k]) / 3;
        const c: Point = [at(0), at(1), at(2)];
        if (dropped(node, c)) continue;
        const name = `${moving(node, c)}${mesh.material}`;
        const list = groups.get(name) ?? [];
        list.push(v, v + 1, v + 2);
        groups.set(name, list);
      }
      for (const [name, tris] of groups) {
        const piece = pieces.get(name) ?? { look, meshes: [] };
        piece.meshes.push(simplify(place, tris, error));
        pieces.set(name, piece);
      }
    }
    return pieces;
  };
  const { near, far, meta } = await replaceGun("sniper", LENGTH, { near: build(DETAIL.near), far: build(DETAIL.far) });
  console.log(`[kalamit] near ${near} tris, far ${far} tris`, JSON.stringify(meta));
}
