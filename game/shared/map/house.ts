import type { PlacedPiece, KitName } from "./types";
import { rng, type Rng } from "../rng";

/**
 * Builds a multi-story house from the Medieval Village MegaKit.
 *
 * Kit conventions (measured from the pieces): 2 m grid, 3 m per story. Wall pieces span
 * x ∈ [-1, 1] with their exterior face toward +Z and 0.31 m of thickness toward -Z.
 * Interior stairs rise 3 m toward -Z over 4.35 m. Roof_RoundTiles_AxB is centered on the
 * footprint with its ridge along Z; Roof_Front_BrickA closes the gable ends.
 *
 * The house is laid out in local space with its footprint at x ∈ [0, 2w], z ∈ [0, 2d] and
 * the front on the local -Z side, then rotated so the front faces the requested world side.
 */

export type Side = "N" | "S" | "E" | "W";

export interface HouseSpec {
  /** World-space footprint rectangle (min corner and size in meters, multiples of 2). */
  x: number;
  z: number;
  sx: number;
  sz: number;
  /** World side the front (with the gable and main door) faces. N = -Z. */
  front: Side;
  floors: number;
  /** Stories built in stone before switching to timber-framed plaster (default 1). */
  stone?: number;
  /** Ground-floor doors as [local side, cell index]; F = front, B = back, R = right side. */
  doors: ["F" | "B" | "R", number][];
  /** Balconies on upper floors: [floor, cell index] on the front side. */
  balconies?: [number, number][];
  seed: number;
  chimney?: boolean;
  /** Skip interior furniture (e.g. for the tower). */
  empty?: boolean;
}

const G = 2;
const STORY = 3;
const PI = Math.PI;

const ROOFS = new Set(["4x4", "4x6", "4x8", "6x6", "6x8", "6x10", "6x12", "6x14", "8x8", "8x10", "8x12", "8x14"]);

interface Local {
  name: string;
  kit?: KitName;
  x: number;
  y: number;
  z: number;
  ry: number;
}

export interface HouseResult {
  pieces: PlacedPiece[];
  /** Interior floor cells in world space (center x, floor y, center z), for spawns and bots. */
  floorCells: { x: number; y: number; z: number }[];
}

export function buildHouse(spec: HouseSpec): HouseResult {
  const r = rng(spec.seed);
  const rot = { N: 0, W: 1, S: 2, E: 3 }[spec.front];
  const alongX = rot % 2 === 0;
  const w = (alongX ? spec.sx : spec.sz) / G;
  const d = (alongX ? spec.sz : spec.sx) / G;
  const floors = spec.floors;
  const stone = spec.stone ?? 1;
  const out: Local[] = [];
  const cells: Local[] = [];
  const put = (name: string, x: number, y: number, z: number, ry = 0, kit?: KitName) => out.push({ name, x, y, z, ry, kit });

  if (!ROOFS.has(`${2 * w}x${2 * d}`)) throw new Error(`no roof for ${2 * w}x${2 * d}`);
  if (d < 3) throw new Error("house needs at least 3 cells of depth for stairs");

  // Stairs alternate columns so each flight lands on floor that the next one does not cut.
  const stairCol = (f: number) => (f % 2 === 0 ? 0 : w - 1);
  const holes = (f: number): Set<string> => {
    const s = new Set<string>();
    if (f === 0) return s;
    const c = stairCol(f - 1);
    const rows = (f - 1) % 2 === 0 ? [d - 1, d - 2] : [0, 1];
    for (const j of rows) s.add(`${c},${j}`);
    return s;
  };

  for (let f = 0; f < floors; f++) {
    const y = f * STORY;
    const isStone = f < stone;
    const wallSet = isStone ? "UnevenBrick" : "Plaster";

    // Floors.
    const hole = holes(f);
    for (let i = 0; i < w; i++)
      for (let j = 0; j < d; j++) {
        if (hole.has(`${i},${j}`)) continue;
        put(f === 0 && isStone ? "Floor_Brick" : "Floor_WoodDark", 2 * i + 1, y + (f === 0 ? 0.03 : 0), 2 * j + 1);
        cells.push({ name: "", x: 2 * i + 1, y: y + (f === 0 ? 0.03 : 0), z: 2 * j + 1, ry: 0 });
      }

    // Walls, going around the footprint. Each slot: position, rotation, local side, index.
    const slots: { x: number; z: number; ry: number; side: "F" | "B" | "L" | "R"; i: number }[] = [];
    for (let i = 0; i < w; i++) slots.push({ x: 2 * i + 1, z: 0, ry: PI, side: "F", i });
    for (let i = 0; i < w; i++) slots.push({ x: 2 * i + 1, z: 2 * d, ry: 0, side: "B", i });
    for (let j = 0; j < d; j++) slots.push({ x: 0, z: 2 * j + 1, ry: -PI / 2, side: "L", i: j });
    for (let j = 0; j < d; j++) slots.push({ x: 2 * w, z: 2 * j + 1, ry: PI / 2, side: "R", i: j });

    for (const s of slots) {
      const door = f === 0 && spec.doors.some(([side, i]) => side === s.side && i === s.i);
      const balcony = f > 0 && s.side === "F" && spec.balconies?.some(([bf, bi]) => bf === f && bi === s.i);
      // Keep the wall beside a stair flight solid so windows don't cut through the steps.
      const besideStair = (s.side === "L" && stairCol(f) === 0) || (s.side === "R" && stairCol(f) === w - 1);
      let name: string;
      let shutters: string | null = null;
      if (door) {
        name = `Wall_${wallSet}_Door_Round`;
      } else if (balcony) {
        name = "Wall_Plaster_Door_Flat";
      } else if (!besideStair && r.chance(0.62)) {
        const kind = r.pick(["Wide_Flat", "Wide_Round", "Thin_Round"] as const);
        name = `Wall_${wallSet}_Window_${kind}`;
        if (r.chance(0.35)) shutters = `WindowShutters_${kind}_Open`;
      } else {
        name = isStone ? "Wall_UnevenBrick_Straight" : r.chance(0.3) ? "Wall_Plaster_WoodGrid" : "Wall_Plaster_Straight";
      }
      put(name, s.x, y, s.z, s.ry);
      if (shutters) put(shutters, s.x, y, s.z, s.ry);
      if (!isStone) put("Wall_BottomCover", s.x, y, s.z, s.ry);
      if (isStone && f === 0 && !door && r.chance(0.18)) put(r.pick(["Prop_Vine1", "Prop_Vine2", "Prop_Vine4", "Prop_Vine5"]), s.x, y, s.z, s.ry);

      if (balcony) {
        // Floor tile outside the door, railings on three sides, braces underneath.
        const ox = s.x, oz = s.z - 1;
        put("Floor_WoodDark", ox, y, oz);
        put("Balcony_Cross_Straight", ox, y, oz, PI);
        put("Balcony_Cross_Straight", ox, y, oz, PI / 2);
        put("Balcony_Cross_Straight", ox, y, oz, -PI / 2);
        put("Prop_Support", s.x - 0.75, y - STORY, s.z, PI);
        put("Prop_Support", s.x + 0.75, y - STORY, s.z, PI);
      }
    }

    // Corner posts.
    const corner = isStone ? "Corner_Exterior_Brick" : "Corner_Exterior_Wood";
    put(corner, 0, y, 2 * d, 0);
    put(corner, 2 * w, y, 2 * d, PI / 2);
    put(corner, 2 * w, y, 0, PI);
    put(corner, 0, y, 0, -PI / 2);

    // Stair flight up to the next floor.
    if (f < floors - 1) {
      const c = stairCol(f);
      const sx = c === 0 ? 1.2 : 2 * w - 1.2;
      if (f % 2 === 0) put("Stair_Interior_Solid", sx, y, 2 * d - 0.35, 0);
      else put("Stair_Interior_Solid", sx, y, 0.35, PI);
    }

    // A little furniture for cover, away from stairs and doors.
    if (!spec.empty) {
      const stairCells = new Set<string>();
      if (f < floors - 1) {
        const c = stairCol(f);
        for (let j = 0; j < d; j++) stairCells.add(`${c},${j}`);
      }
      const free: [number, number][] = [];
      for (let i = 0; i < w; i++)
        for (let j = 0; j < d; j++) {
          const k = `${i},${j}`;
          if (hole.has(k) || stairCells.has(k)) continue;
          if (f === 0 && spec.doors.some(([side, di]) => (side === "F" && di === i && j === 0) || (side === "B" && di === i && j === d - 1) || (side === "R" && di === j && i === w - 1))) continue;
          free.push([i, j]);
        }
      const n = Math.min(free.length, r.int(1, 2));
      for (let k = 0; k < n; k++) {
        const [i, j] = free.splice(r.int(0, free.length - 1), 1)[0];
        const prop = r.pick(f === 0
          ? ["Barrel", "Crate_Wooden", "Table_Large", "Workbench", "FarmCrate_Apple", "Cabinet"]
          : ["Bed_Twin1", "Table_Large", "Bookcase_2", "Chest_Wood", "Barrel", "Crate_Wooden"]);
        put(prop, 2 * i + 1 + r.range(-0.3, 0.3), y + 0.02, 2 * j + 1 + r.range(-0.3, 0.3), (r.int(0, 3) * PI) / 2, "props");
      }
    }
  }

  // Roof and gables.
  const top = floors * STORY;
  put(`Roof_RoundTiles_${2 * w}x${2 * d}`, w, top, d, 0);
  put(`Roof_Front_Brick${2 * w}`, w, top, 2 * d, 0);
  put(`Roof_Front_Brick${2 * w}`, w, top, 0, PI);
  if (spec.chimney) put(r.pick(["Prop_Chimney", "Prop_Chimney2"]), 2 * w - 1.4, top + 0.6, 2 * d - 1.6, 0);

  // Local → world.
  const theta = (rot * PI) / 2;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const origin = [
    [spec.x, spec.z],
    [spec.x, spec.z + spec.sz],
    [spec.x + spec.sx, spec.z + spec.sz],
    [spec.x + spec.sx, spec.z],
  ][rot];
  const toWorld = (p: Local) => ({
    x: round(origin[0] + p.x * cos + p.z * sin),
    y: round(p.y),
    z: round(origin[1] - p.x * sin + p.z * cos),
  });
  return {
    pieces: out.map((p) => ({ kit: p.kit ?? "village", name: p.name, ...toWorld(p), ry: round(p.ry + theta) })),
    floorCells: cells.map(toWorld),
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function randomSeed(r: Rng) {
  return r.int(1, 1e9);
}
