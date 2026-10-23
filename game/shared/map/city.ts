import type { MapData, MapOverview, MapRect, PlacedPiece, SpawnPoint } from "./types";

/**
 * "Downtown" — a compact city block built only from the Downtown City MegaKit, so a match
 * downloads one 2.7 MB kit. Deterministic: the server and every client get identical pieces,
 * spawns and collision.
 *
 * World axes: +X east, +Z south (N = -Z). A 4-lane avenue (E–W) and cross street (N–S) meet
 * at a central intersection. Prefab buildings line the streets; alleys between them lead to
 * walled courtyards, each with an enterable shop and rooftop access. Streets are the middle
 * lane, courtyards the flanks. The layout is 180°-rotationally symmetric, so the west (Blue)
 * and east (Red) halves are mirror images.
 *
 * Kit conventions (measured): street tiles keep asphalt 0.15 m below the sidewalk top; walls
 * are 2 m wide and 3 m tall with the exterior face at local z = 0 (+Z out) and thickness
 * toward -Z; concrete entrance stairs rise 1.01 m over 2 m toward local -Z.
 */

export const CITY_HALF = 46;
/** Half-width of a 4-lane street including sidewalks (asphalt is |offset| < 6). */
const ROAD = 9;
/** Street tiles are lifted so their asphalt meets the ground collider at y = 0. */
const STREET_Y = 0.15;
/** Sidewalks, courtyards and building floors. */
const LOT = 0.15;
const STEP = 1.01; // entrance stair / concrete block height
const PI = Math.PI;

type Front = "N" | "S" | "E" | "W";
/** Rotation that turns a piece's +Z (front / exterior) toward a world side. */
const FRONT_RY: Record<Front, number> = { S: 0, E: PI / 2, N: PI, W: -PI / 2 };

type Prefab = "Building_Large_2" | "Building_Medium_2_001" | "Building_Small_1";
/** Body boxes in piece space [x0, z0, x1, z1]: the collision proxies the importer measured. */
const PREFABS: Record<Prefab, [number, number, number, number]> = {
  Building_Large_2: [-9.32, -16.32, 11.32, 0.32],
  Building_Medium_2_001: [-7.18, -11.96, 7.18, 0.57],
  Building_Small_1: [-7.17, -12.17, 5.17, 0.17],
};

const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0; // +0 turns -0 into 0
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface Out {
  pieces: PlacedPiece[];
  buildings: MapRect[];
}

/**
 * Places template content into the world. Templates are authored in the south-east quadrant
 * (x, z >= 9); `sx` / `sz` mirror them into the other quadrants.
 */
class Block {
  constructor(private out: Out, private sx: 1 | -1 = 1, private sz: 1 | -1 = 1) {}

  piece(name: string, x: number, y: number, z: number, ry = 0) {
    const m = this.sx < 0 ? (this.sz < 0 ? ry + PI : -ry) : this.sz < 0 ? PI - ry : ry;
    this.out.pieces.push({ kit: "city", name, x: r3(x * this.sx), y: r3(y), z: r3(z * this.sz), ry: r3(wrap(m)) });
  }

  /** Records a footprint (template coordinates) for the minimap and spawn checks. */
  footprint(x0: number, z0: number, x1: number, z1: number) {
    const [ax, bx] = [x0 * this.sx, x1 * this.sx].sort((a, b) => a - b);
    const [az, bz] = [z0 * this.sz, z1 * this.sz].sort((a, b) => a - b);
    this.out.buildings.push({ x: r3(ax), z: r3(az), sx: r3(bx - ax), sz: r3(bz - az) });
  }

  private front(f: Front): Front {
    if (this.sx < 0 && (f === "E" || f === "W")) f = f === "E" ? "W" : "E";
    if (this.sz < 0 && (f === "N" || f === "S")) f = f === "N" ? "S" : "N";
    return f;
  }

  /** A prefab building whose body box has its min corner at template (x0, z0). */
  prefab(name: Prefab, front: Front, x0: number, z0: number, footprint = true) {
    const [bx0, bz0, bx1, bz1] = PREFABS[name];
    const across = front === "N" || front === "S";
    const w = across ? bx1 - bx0 : bz1 - bz0;
    const d = across ? bz1 - bz0 : bx1 - bx0;
    if (footprint) this.footprint(x0, z0, x0 + w, z0 + d);
    // World min corner after mirroring, then the offset of the rotated body box.
    const wx = Math.min(x0 * this.sx, (x0 + w) * this.sx);
    const wz = Math.min(z0 * this.sz, (z0 + d) * this.sz);
    const ry = FRONT_RY[this.front(front)];
    const c = Math.cos(ry), s = Math.sin(ry);
    let mx = Infinity, mz = Infinity;
    for (const [px, pz] of [[bx0, bz0], [bx1, bz0], [bx1, bz1], [bx0, bz1]]) {
      mx = Math.min(mx, px * c + pz * s);
      mz = Math.min(mz, -px * s + pz * c);
    }
    this.out.pieces.push({ kit: "city", name, x: r3(wx - mx), y: LOT, z: r3(wz - mz), ry: r3(wrap(ry)) });
  }

  /** 2 m wall pieces along an axis-aligned line, exterior facing `face`. */
  wallRun(names: string[], x0: number, z0: number, x1: number, z1: number, face: Front, y = LOT) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(len / 2 - 0.01);
    for (let k = 0; k < n; k++) {
      const t = (2 * k + 1) / len;
      this.piece(names[k % names.length], x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, FRONT_RY[face]);
    }
  }

  /** Concrete blocks stacked `levels` high (1 m each). */
  blocks(name: "Entrance_Concrete_2x2" | "Entrance_Concrete_2x1", x: number, z: number, levels = 1, ry = 0) {
    for (let k = 0; k < levels; k++) this.piece(name, x, LOT + k * STEP, z, ry);
  }
}

interface Frame {
  /** Local (x along the front, z inward) → template coordinates. */
  at(lx: number, lz: number): [number, number];
  theta: number;
  /** Cells along the front and in depth. */
  w: number;
  d: number;
}

/**
 * Local frame of a rectangular structure (2 m cells): footprint x ∈ [0, 2w], z ∈ [0, 2d] with
 * the front on local z = 0, rotated so the front faces `front` (same scheme as house.ts).
 */
function frame(x: number, z: number, sx: number, sz: number, front: Front): Frame {
  const rot = { N: 0, W: 1, S: 2, E: 3 }[front];
  const alongX = rot % 2 === 0;
  const theta = (rot * PI) / 2;
  const c = Math.cos(theta), s = Math.sin(theta);
  const [ox, oz] = [[x, z], [x, z + sz], [x + sx, z + sz], [x + sx, z]][rot];
  return { at: (lx, lz) => [ox + lx * c + lz * s, oz - lx * s + lz * c], theta, w: (alongX ? sx : sz) / 2, d: (alongX ? sz : sx) / 2 };
}

/** Wall slots around a frame's footprint: local center, rotation and side. */
function slots(f: Frame) {
  const out: { x: number; z: number; ry: number; side: "F" | "B" | "L" | "R"; i: number }[] = [];
  for (let i = 0; i < f.w; i++) out.push({ x: 2 * i + 1, z: 0, ry: PI, side: "F", i });
  for (let i = 0; i < f.w; i++) out.push({ x: 2 * i + 1, z: 2 * f.d, ry: 0, side: "B", i });
  for (let j = 0; j < f.d; j++) out.push({ x: 0, z: 2 * j + 1, ry: -PI / 2, side: "L", i: j });
  for (let j = 0; j < f.d; j++) out.push({ x: 2 * f.w, z: 2 * j + 1, ry: PI / 2, side: "R", i: j });
  return out;
}

interface ShopSpec {
  x: number; z: number; sx: number; sz: number; front: Front;
  /** Front door cell; the rest of the front is open storefront. */
  door: number;
  /** Second way in, on the back or a side wall. */
  exit: { side: "B" | "L" | "R"; cell: number };
  /**
   * Rooftop access along the back wall: a landing level with the roof at `cell` (where the
   * parapet opens) and three flights descending from it in direction `dir` along local x.
   */
  stairs: { cell: number; dir: 1 | -1 };
}

/**
 * A one-story corner shop: storefront, brick sides with open windows, a counter for cover,
 * and a flat roof with a 1 m parapet reached by concrete stairs along the back wall.
 */
function shop(b: Block, spec: ShopSpec) {
  const f = frame(spec.x, spec.z, spec.sx, spec.sz, spec.front);
  const put = (name: string, lx: number, y: number, lz: number, ry = 0) => {
    const [x, z] = f.at(lx, lz);
    b.piece(name, x, y, z, ry + f.theta);
  };
  b.footprint(spec.x, spec.z, spec.x + spec.sx, spec.z + spec.sz);

  for (let i = 0; i < f.w; i++)
    for (let j = 0; j < f.d; j++) {
      put("Floor_2x2", 2 * i + 1, LOT + 0.01, 2 * j + 1);
      put("Floor_2x2", 2 * i + 1, LOT + 3, 2 * j + 1); // roof slab; its underside is the ceiling
      put("Roof_2x2", 2 * i + 1, LOT + 3.21, 2 * j + 1);
    }

  const { cell: top, dir } = spec.stairs;
  for (const s of slots(f)) {
    let name: string;
    if (s.side === "F") name = s.i === spec.door ? "DoorFrame_Metal_Single" : "Metal_FirstFloor_Window";
    else if (s.side === spec.exit.side && s.i === spec.exit.cell) name = "DoorFrame_Wooden";
    else if (s.side === "B") name = "Brick_Plain_3";
    else name = s.i % 2 === 0 ? "Brick_Window_Square_Single" : "Brick_Plain_3";
    put(name, s.x, LOT, s.z, s.ry);
    // Parapet, open where the stairs arrive.
    if (!(s.side === "B" && s.i === top)) put("Brick_Plain_1", s.x, LOT + 3, s.z, s.ry);
  }

  // Counter for cover, clear of both doors.
  put("Entrance_Concrete_2x1", f.w, LOT, 2 * f.d - 1.7);

  // Landing: three stacked blocks put its top (LOT + 3.03) flush with the roof, so the whole
  // parapet opening is walkable. Flights descend from it on blocks of decreasing height.
  for (let j = 0; j < 3; j++) put("Entrance_Concrete_2x2", 2 * top + 1, LOT + j * STEP, 2 * f.d + 1);
  for (let k = 0; k < 3; k++) {
    const cell = top + dir * (k + 1);
    const high = dir < 0 ? 2 * cell + 2 : 2 * cell; // edge of this flight nearest the landing
    for (let j = 0; j < 2 - k; j++) put("Entrance_Concrete_2x2", 2 * cell + 1, LOT + j * STEP, 2 * f.d + 1);
    put("Stairs_Entrance_Concrete", high, LOT + (2 - k) * STEP, 2 * f.d + 1, dir < 0 ? -PI / 2 : PI / 2);
  }
}

/** A closed kiosk / newsstand (solid cover) with a flat roof. */
function kiosk(b: Block, x: number, z: number, sx: number, sz: number, walls: string[], y = 0) {
  const f = frame(x, z, sx, sz, "N");
  const put = (name: string, lx: number, py: number, lz: number, ry = 0) => {
    const [px, pz] = f.at(lx, lz);
    b.piece(name, px, py, pz, ry + f.theta);
  };
  b.footprint(x, z, x + sx, z + sz);
  slots(f).forEach((s, k) => put(walls[k % walls.length], s.x, y, s.z, s.ry));
  for (let i = 0; i < f.w; i++)
    for (let j = 0; j < f.d; j++) {
      put("Floor_2x2", 2 * i + 1, y + 3, 2 * j + 1);
      put("Roof_2x2", 2 * i + 1, y + 3.21, 2 * j + 1);
    }
}

const BOUNDARY = ["Brick_Plain_3"], BOUNDARY_TOP = ["Brick_TopTrim"];

/** Courtyard walls along the map edge, two stories tall, facing the play area. */
function boundaryWall(b: Block, x0: number, z0: number, x1: number, z1: number, face: Front) {
  b.wallRun(BOUNDARY, x0, z0, x1, z1, face);
  b.wallRun(BOUNDARY_TOP, x0, z0, x1, z1, face, LOT + 3);
}

/** "Hotel block": large corner building, walk-up on the avenue, shop with stairs on the east. */
function blockA(b: Block) {
  b.prefab("Building_Large_2", "N", 9, 9); //       x 9..29.6,  z 9..25.6
  b.prefab("Building_Small_1", "N", 33.66, 9); //   x 33.7..46, z 9..21.3 (stairs onto the sidewalk)
  b.prefab("Building_Medium_2_001", "W", 9, 31.64); // x 9..21.5, z 31.6..46
  shop(b, { x: 28, z: 31, sx: 10, sz: 6, front: "N", door: 2, exit: { side: "B", cell: 0 }, stairs: { cell: 4, dir: -1 } });
  boundaryWall(b, 46, 21.34, 46, 46, "W");
  boundaryWall(b, 21.53, 46, 46, 46, "N");

  // Courtyard and alley cover.
  b.blocks("Entrance_Concrete_2x2", 24.5, 34, 2);
  b.blocks("Entrance_Concrete_2x2", 44, 33, 2);
  b.blocks("Entrance_Concrete_2x1", 44.5, 37, 1, PI / 2);
  b.blocks("Entrance_Concrete_2x2", 25, 41);
  b.blocks("Entrance_Concrete_2x1", 31.65, 15, 1, PI / 2); // L–S alley
  b.blocks("Entrance_Concrete_2x1", 16, 28); //               L–M alley
  b.piece("Prop_Planter_Single", 33, LOT, 43.5);
  b.piece("Prop_ACUnit", 14, LOT, 25.66);
  b.piece("Prop_ACUnit", 19, LOT, 25.66);
  b.piece("Prop_ACUnit", 21.55, LOT, 38, PI / 2);
  // No Sidewalk_Planter here: its iron tree guard is taller than the autostep and walls off
  // most of the 3 m sidewalk.
}

/** "Market block": walk-up on the cross street, wide alley, shop facing west. */
function blockB(b: Block) {
  b.prefab("Building_Medium_2_001", "N", 9, 9); // x 9..23.4,  z 9..21.5
  b.prefab("Building_Large_2", "N", 26, 9); //      x 26..46.6,  z 9..25.6
  b.prefab("Building_Small_1", "W", 9, 33.66); //   x 9..21.3,   z 33.7..46 (stairs onto the sidewalk)
  shop(b, { x: 28, z: 32, sx: 6, sz: 8, front: "W", door: 1, exit: { side: "R", cell: 1 }, stairs: { cell: 3, dir: -1 } });
  boundaryWall(b, 46, 25.64, 46, 46, "W");
  boundaryWall(b, 21.34, 46, 46, 46, "N");

  b.blocks("Entrance_Concrete_2x2", 14, 27, 2); // wide alley
  b.blocks("Entrance_Concrete_2x2", 19.5, 30.5, 2);
  b.blocks("Entrance_Concrete_2x1", 24, 30.5);
  b.blocks("Entrance_Concrete_2x1", 38, 27);
  b.blocks("Entrance_Concrete_2x2", 42.5, 36, 2);
  b.blocks("Entrance_Concrete_2x2", 31, 43);
  b.piece("Prop_Planter_Single", 37.5, LOT, 43.5);
  b.piece("Prop_ACUnit", 25.98, LOT, 15, -PI / 2); // M–L alley
  b.piece("Prop_ACUnit", 30, LOT, 25.66);
  b.piece("Prop_ACUnit", 35, LOT, 25.66);
}

/** One street arm (east of the intersection); repeated in all four directions. */
function streetArm(out: Out, rot: number) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const raw = new Block(out);
  const put = (name: string, x: number, y: number, z: number, ry = 0) => raw.piece(name, x * c + z * s, y, -x * s + z * c, ry + rot);
  for (let x = 12; x <= 54; x += 6) put("Street_4Lane", x, STREET_Y, 0);
  // Newsstand in the westbound lanes, and staggered barriers that break the long sightline.
  const [kx, kz] = [21 * c - 3.5 * s, -21 * s - 3.5 * c];
  const kRot = Math.abs(s) > 0.5;
  kiosk(raw, kx - (kRot ? 1 : 2), kz - (kRot ? 2 : 1), kRot ? 2 : 4, kRot ? 4 : 2, ["Trim_Plain_3", "Brick_Plain_3"]);
  for (const [x, z] of [[15, 2.5], [15, 4.5], [29, -1.5], [29, -3.5], [38, 3], [38, 5]]) put("Entrance_Concrete_2x1", x, 0, z, PI / 2);
  put("Entrance_Concrete_2x2", 33, 0, 1.5);
  put("Entrance_Concrete_2x2", 33, STEP, 1.5);
  put("Prop_ManholeCover", 25, 0, 2);
  put("Decal_ArrowStraight", 16.5, 0, -3, PI / 2);
  for (const x of [11, 12.2, 13.4]) for (const z of [-6.5, 6.5]) put("Prop_Bollard", x, LOT, z);
}

/** Two stories of brick facade across the end of each street, just outside the play area. */
function streetEnds(b: Block) {
  b.prefab("Building_Large_2", "W", CITY_HALF + 0.5, -10.32, false);
  b.prefab("Building_Large_2", "E", -CITY_HALF - 0.5 - 16.64, -10.32, false);
  b.prefab("Building_Large_2", "S", -10.32, -CITY_HALF - 0.5 - 16.64, false);
  b.prefab("Building_Large_2", "N", -10.32, CITY_HALF + 0.5, false);
}

export function buildCity(): MapData {
  const out: Out = { pieces: [], buildings: [] };
  const world = new Block(out);

  // Streets: intersection, four arms, and courtyard pavement at sidewalk height.
  world.piece("Street_4WayIntersection", 0, STREET_Y, 0);
  for (let k = 0; k < 4; k++) streetArm(out, (k * PI) / 2);
  for (const sx of [1, -1] as const)
    for (const sz of [1, -1] as const)
      for (let x = ROAD + 3; x < CITY_HALF + 6; x += 6)
        for (let z = ROAD + 3; z < CITY_HALF + 6; z += 6) new Block(out, sx, sz).piece("Street_Asphalt_6x6", x, LOT + 0.15, z);

  // Blocks: A in the south-east and (rotated) north-west, B in the north-east and south-west.
  blockA(new Block(out, 1, 1));
  blockA(new Block(out, -1, -1));
  blockB(new Block(out, 1, -1));
  blockB(new Block(out, -1, 1));

  // Center kiosk breaks the sightline down both streets; planters mark the corners.
  kiosk(world, -3, -3, 6, 6, ["Brick_Plain_3", "Trim_Plain_3", "Brick_Plain_3"]);
  for (const [x, z] of [[6.5, 6.5], [-6.5, 6.5], [6.5, -6.5], [-6.5, -6.5]]) world.piece("Prop_Planter_Single", x, 0, z);
  streetEnds(world);

  // Spawns: east (Red) side authored here, west (Blue) is the 180° rotation.
  const spawns: SpawnPoint[] = [];
  const east: [number, number, number][] = [
    [42, -4.5, 0], [42, -1.5, 0], [42, 1.5, 0], [42, 4.5, 0],
    [42, 24.5, LOT], [42, 42.5, LOT], [40, -30, LOT], [40, -43, LOT],
  ];
  for (const [x, z, y] of east) {
    spawns.push({ x, y: y + 0.1, z, yaw: PI / 2, team: 2 });
    spawns.push({ x: -x, y: y + 0.1, z: -z, yaw: -PI / 2, team: 1 });
  }
  // Free-for-all: alleys, courtyards and the street arms, spread over the whole map.
  const ffa: [number, number, number][] = [
    [25, 28.5, LOT], [44, 44, LOT], [31, 19.5, LOT], [12, 28.6, LOT], // block A (SE)
    [24.7, -18, LOT], [20, -25, LOT], [43, -43, LOT], [24.5, -37, LOT], // block B (NE)
    [20, 4, 0], [4, -20, 0],
  ];
  for (const [x, z, y] of ffa) {
    spawns.push({ x, y: y + 0.1, z, yaw: Math.atan2(x, z), team: 0 });
    spawns.push({ x: -x, y: y + 0.1, z: -z, yaw: Math.atan2(-x, -z), team: 0 });
  }

  const overview: MapOverview = {
    roads: [
      { x: -CITY_HALF, z: -ROAD, sx: CITY_HALF * 2, sz: ROAD * 2 },
      { x: -ROAD, z: -CITY_HALF, sx: ROAD * 2, sz: CITY_HALF * 2 },
    ],
    plazas: [{ x: -ROAD, z: -ROAD, sx: ROAD * 2, sz: ROAD * 2 }],
    buildings: out.buildings,
    labels: [],
  };
  return { id: "downtown", pieces: out.pieces, spawns, half: CITY_HALF, kits: ["city"], overview };
}

let cached: MapData | null = null;
export function getCity(): MapData {
  return (cached ??= buildCity());
}
