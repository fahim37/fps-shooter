import { beforeAll, describe, expect, it } from "vitest";
import { createRoomWorld, getNav, initWorldData, RAPIER } from "./world";
import { getMap, MAP_IDS } from "../game/shared/map/maps";
import { buildCity } from "../game/shared/map/city";
import { PIECES, QUERY_WORLD, type World } from "../game/shared/physics";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../game/shared/constants";

// Real collision data and navmeshes, exactly as the game server loads them.
beforeAll(() => initWorldData(), 60_000);

describe.each(MAP_IDS)("map %s", (id) => {
  const map = getMap(id);
  let world: World;
  beforeAll(() => { world = createRoomWorld(map); });

  it("places only pieces that exist in its kits", () => {
    for (const p of map.pieces) {
      expect(map.kits).toContain(p.kit);
      expect(PIECES[p.kit].pieces[p.name], `${p.kit}/${p.name}`).toBeDefined();
    }
  });

  it("has team and free-for-all spawns inside the play area", () => {
    for (const team of [0, 1, 2] as const) expect(map.spawns.filter((s) => s.team === team).length).toBeGreaterThanOrEqual(8);
    for (const s of map.spawns) {
      expect(Math.abs(s.x)).toBeLessThan(map.half - 1);
      expect(Math.abs(s.z)).toBeLessThan(map.half - 1);
    }
  });

  it("spawns players clear of geometry and standing on a floor", () => {
    const capsule = new RAPIER.Capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS);
    for (const s of map.spawns) {
      const at = `${s.x},${s.z}`;
      const blocked = world.intersectionWithShape({ x: s.x, y: s.y + PLAYER_HEIGHT / 2 + 0.05, z: s.z }, { x: 0, y: 0, z: 0, w: 1 }, capsule, undefined, QUERY_WORLD);
      expect(blocked, `spawn ${at} overlaps geometry`).toBeNull();
      const floor = world.castRay(new RAPIER.Ray({ x: s.x, y: s.y + 0.5, z: s.z }, { x: 0, y: -1, z: 0 }), 1, true, undefined, QUERY_WORLD);
      expect(floor, `spawn ${at} has no floor`).not.toBeNull();
      expect(floor!.timeOfImpact, `spawn ${at} floats`).toBeLessThan(0.8);
    }
  });

  it("lets bots walk between every pair of spawn regions", () => {
    const nav = getNav(id);
    const half = { x: 2, y: 3, z: 2 };
    const spawns = map.spawns;
    for (let i = 0; i < spawns.length; i += 3) {
      for (let j = i + 1; j < spawns.length; j += 4) {
        const a = spawns[i], b = spawns[j];
        const res = nav.computePath({ x: a.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: b.z }, { halfExtents: half });
        expect(res.success, `no path ${a.x},${a.z} → ${b.x},${b.z}`).toBe(true);
        const end = res.path[res.path.length - 1];
        expect(Math.hypot(end.x - b.x, end.z - b.z), `path ${a.x},${a.z} → ${b.x},${b.z} stops short`).toBeLessThan(1.5);
      }
    }
  });

  it("only picks reachable roam goals for bots", () => {
    const nav = getNav(id);
    const from = map.spawns[0];
    for (let k = 0; k < 40; k++) {
      const r = nav.findRandomPointAroundCircle({ x: from.x, y: from.y, z: from.z }, 70, { halfExtents: { x: 3, y: 4, z: 3 } });
      expect(r.success).toBe(true);
      const res = nav.computePath({ x: from.x, y: from.y, z: from.z }, r.randomPoint, { halfExtents: { x: 2, y: 3, z: 2 } });
      const end = res.path[res.path.length - 1];
      expect(Math.hypot(end.x - r.randomPoint.x, end.z - r.randomPoint.z)).toBeLessThan(1.5);
    }
  });
});

describe("downtown", () => {
  it("is deterministic, so server and clients build the same world", () => {
    expect(JSON.stringify(buildCity())).toBe(JSON.stringify(buildCity()));
  });

  it("gives both teams mirror-image spawns", () => {
    const { spawns } = getMap("downtown");
    const green = spawns.filter((s) => s.team === 2);
    for (const s of spawns.filter((sp) => sp.team === 1)) {
      expect(green.some((r) => Math.abs(r.x + s.x) < 1e-6 && Math.abs(r.z + s.z) < 1e-6)).toBe(true);
    }
  });

  it("reaches every shop rooftop by stairs", () => {
    const map = getMap("downtown");
    const nav = getNav("downtown");
    const roofs = map.pieces.filter((p) => p.name === "Roof_2x2" && p.y > 3.3 && p.y < 3.5);
    expect(roofs.length).toBeGreaterThan(0);
    // One roof tile per shop (one shop per quadrant; street kiosks sit lower, on the asphalt).
    const shops = [...new Map(roofs.map((r) => [`${Math.sign(r.x)},${Math.sign(r.z)}`, r])).values()];
    expect(shops).toHaveLength(4);
    const start = map.spawns[0];
    for (const roof of shops) {
      const target = { x: roof.x, y: 3.16, z: roof.z };
      const res = nav.computePath({ x: start.x, y: start.y, z: start.z }, target, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
      const end = res.path[res.path.length - 1];
      expect(res.success && Math.hypot(end.x - target.x, end.z - target.z) < 1 && end.y > 2.8, `roof ${roof.x},${roof.z}`).toBe(true);
    }
  });
});
