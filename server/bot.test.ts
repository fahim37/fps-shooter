import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Bot } from "./bot";
import { MatchRoom, type ServerPlayer } from "./MatchRoom";
import { PlayerState } from "../game/shared/schema";
import { DASH_MAX, TICK_MS } from "../game/shared/constants";
import { F_DASH } from "../game/shared/messages";
import { GROUP_WORLD } from "../game/shared/physics";
import { SPOT_MS } from "../game/shared/spot";
import { WEAPONS, type WeaponId } from "../game/shared/weapons";
import { init as initRecast } from "recast-navigation";
import { navMeshFromTriangles } from "./navmesh";

const nav = vi.hoisted(() => ({
  computePath: vi.fn(), findRandomPointAroundCircle: vi.fn(), findClosestPoint: vi.fn(), closestPointOnPoly: vi.fn(), raycast: vi.fn(),
}));
vi.mock("./world", async () => ({
  RAPIER: (await import("@dimforge/rapier3d-compat")).default,
  getNav: () => nav, createRoomWorld: vi.fn(),
}));

beforeAll(async () => { await RAPIER.init(); await initRecast(); });
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.restoreAllMocks(); vi.useRealTimers();
});

function fixture(floorLength = 100, slope = 0) {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  nav.computePath.mockImplementation((_from, to) => ({ success: true, path: [to] }));
  nav.findRandomPointAroundCircle.mockReturnValue({ success: true, randomPoint: { x: 20, y: 0, z: 0 } });
  nav.findClosestPoint.mockImplementation((point) => ({ success: true, isPointOverPoly: true, point, polyRef: 1 }));
  nav.closestPointOnPoly.mockImplementation((_ref, point) => ({ success: true, isPointOverPoly: true,
    closestPoint: { ...point, y: Math.tan(slope) * point.x } }));
  nav.raycast.mockReturnValue({ success: true, t: Infinity, path: [1] });
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.1, floorLength).setTranslation(0, -0.1, 0)
    .setRotation({ x: 0, y: 0, z: Math.sin(slope / 2), w: Math.cos(slope / 2) }).setCollisionGroups(GROUP_WORLD));
  const room = Object.assign(Object.create(MatchRoom.prototype), {
    world, state: { phase: "live", mode: "tdm" }, map: { id: "outpost" }, botSkill: 2,
    players: new Map<string, ServerPlayer>(),
    fire: vi.fn(), reload: vi.fn(), throwGrenade: vi.fn(),
  }) as MatchRoom;
  const player = (id: string, team: number, x: number, z: number): ServerPlayer => {
    const st = new PlayerState();
    Object.assign(st, { alive: true, team, x, y: 0.03, z, hp: 100, dash: DASH_MAX });
    const ammo = Object.fromEntries(Object.entries(WEAPONS).map(([w, def]) => [w, { mag: def.mag, reserve: def.mag * 3 }])) as ServerPlayer["ammo"];
    const p = { id, st, ammo, lastFireAt: -1e9, lastSpotAt: 0, lastDamageAt: 0, reloadingUntil: 0,
      grenades: 2, vel: [0, 0, 0], client: { send: vi.fn() } } as unknown as ServerPlayer;
    room.players.set(id, p);
    return p;
  };
  const p = player("bot", 1, 0, 0), enemy = player("enemy", 2, 0, -18), ally = player("ally", 1, 5, 5);
  const bot = new Bot(room, p);
  p.bot = bot; p.st.bot = true;
  bot.onSpawn({ x: 0, y: 0.03, z: 0, yaw: 0, team: 1 });
  cleanup.push(() => { bot.dispose(); world.free(); });
  world.step();
  let sawDash = false;
  const run = (ms: number) => {
    for (let tick = 0; tick < Math.ceil(ms / TICK_MS); tick++) {
      vi.setSystemTime(Date.now() + TICK_MS);
      bot.update(TICK_MS / 1000, Date.now());
      sawDash ||= !!(p.st.flags & F_DASH);
      world.step();
    }
    return sawDash;
  };
  return { room, world, p, enemy, ally, bot, run };
}

describe("bot abilities in the server simulation", () => {
  it("keeps player marks and teammate notifications while bots never initiate them", () => {
    const { p, enemy, ally, room, run } = fixture();
    Object.assign(ally.st, { x: 0, z: 0, yaw: 0 });
    expect(room.spot(p, enemy)).toBe(false);
    run(1000);
    expect(enemy.client!.send).not.toHaveBeenCalled();
    expect(room.spot(ally, enemy)).toBe(true);
    expect(ally.client!.send).toHaveBeenCalledWith("spotted", { id: enemy.id, by: ally.id, ms: SPOT_MS });
    expect(p.client!.send).toHaveBeenCalledWith("spotted", { id: enemy.id, by: ally.id, ms: SPOT_MS });
    expect(enemy.client!.send).toHaveBeenCalledExactlyOnceWith("marked", { ms: SPOT_MS });
    expect(room.spot(ally, enemy)).toBe(false);
    vi.setSystemTime(Date.now() + 800);
    expect(room.spot(ally, p)).toBe(false);
  });

  it("still requires human markers to aim through clear sight", () => {
    const { ally, enemy, room, world } = fixture();
    Object.assign(ally.st, { x: 0, z: 0, yaw: Math.PI });
    expect(room.spot(ally, enemy)).toBe(false);
    ally.st.yaw = 0;
    vi.setSystemTime(Date.now() + 800);
    world.createCollider(RAPIER.ColliderDesc.cuboid(10, 3, 0.3)
      .setTranslation(0, 3, -6).setCollisionGroups(GROUP_WORLD));
    world.step();
    expect(room.spot(ally, enemy)).toBe(false);
    expect(enemy.client!.send).not.toHaveBeenCalled();
  });

  it("lets humans mark bots in free-for-all without sharing with other players", () => {
    const { p, ally, enemy, room } = fixture();
    room.state.mode = "ffa";
    Object.assign(ally.st, { x: 0, z: 5, yaw: 0 });
    expect(room.spot(ally, p)).toBe(true);
    expect(ally.client!.send).toHaveBeenCalledWith("spotted", { id: p.id, by: ally.id, ms: SPOT_MS });
    expect(enemy.client!.send).not.toHaveBeenCalled();
    expect(room.spot(p, ally)).toBe(false);
  });

  it("reacts, spends a dash to close range, and replicates the dash flag and velocity", () => {
    const { p, enemy, run } = fixture();
    enemy.st.z = -45;
    expect(run(150)).toBe(false);
    expect(p.st.dash).toBe(DASH_MAX);
    expect(run(500)).toBe(true);
    expect(p.st.dash).toBe(DASH_MAX - 1);
    expect(p.st.z).toBeLessThan(-7);
    run(600);
    expect(p.st.dash).toBe(DASH_MAX - 1);
  });

  it("saves charges in an unpressured fight at its weapon's range", () => {
    const { p, run } = fixture();
    expect(run(1200)).toBe(false);
    expect(p.st.dash).toBe(DASH_MAX);
  });

  it("uses a connected corridor from the real navmesh query for a dash", () => {
    const query = navMeshFromTriangles([], [], 100);
    try {
      const { enemy, run } = fixture();
      nav.findClosestPoint.mockImplementation((point, options) => query.findClosestPoint(point, options));
      nav.raycast.mockImplementation((ref, from, to) => query.raycast(ref, from, to));
      nav.closestPointOnPoly.mockImplementation((ref, point) => query.closestPointOnPoly(ref, point));
      enemy.st.z = -45;
      expect(run(650)).toBe(true);
    } finally { query.destroy(); }
  });

  it("evades an enemy who is firing and aiming at it", () => {
    const { enemy, p, run } = fixture();
    enemy.st.yaw = Math.PI;
    enemy.lastFireAt = Date.now();
    expect(run(650)).toBe(true);
    expect(Math.abs(p.st.x)).toBeGreaterThan(6);
    expect(p.st.dash).toBe(DASH_MAX - 1);
  });

  it("spaces defensive dashes at least eight seconds apart even on Hard", () => {
    const { p, enemy, run } = fixture();
    for (let second = 0; second < 7; second++) {
      p.lastDamageAt = Date.now();
      enemy.st.x = p.st.x;
      enemy.st.z = p.st.z - 18;
      run(1000);
    }
    expect(p.st.dash).toBe(DASH_MAX - 1);
  });

  it("keeps strafing uphill on a walkable slope without trying a level dash", () => {
    const { p, run } = fixture(100, 0.3);
    expect(run(1400)).toBe(false);
    expect(p.st.x).toBeGreaterThan(1);
    expect(p.st.y).toBeGreaterThan(0.3);
  });

  it("does not mistake losing an enemy beyond view range for reaching cover", () => {
    const { p, enemy, run } = fixture();
    p.st.hp = 30; p.st.dash = 0;
    run(650);
    enemy.st.z = -100;
    run(250);
    const z = p.st.z;
    run(1000);
    expect(p.st.z).toBeLessThan(z - 1);
  });

  it("dashes into real cover while hurt, then holds it instead of chasing through a reload", () => {
    const { world, p, run } = fixture();
    p.st.hp = 30;
    p.reloadingUntil = Date.now() + 4000;
    world.createCollider(RAPIER.ColliderDesc.cuboid(3, 1.5, 0.3)
      .setTranslation(8, 1.5, -4).setCollisionGroups(GROUP_WORLD));
    world.step();
    expect(run(650)).toBe(true);
    expect(p.st.x).toBeGreaterThan(7);
    const position = [p.st.x, p.st.z];
    run(1200);
    expect(Math.hypot(p.st.x - position[0], p.st.z - position[1])).toBeLessThan(1);
  });

  it.each(["low wall", "ledge", "navmesh boundary"])("does not spend a dash into a %s", (obstacle) => {
    const { world, p, enemy, run } = fixture(obstacle === "ledge" ? 6 : 100);
    enemy.st.z = -45;
    if (obstacle === "low wall") world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.3, 0.3)
      .setTranslation(0, 0.3, -5).setCollisionGroups(GROUP_WORLD));
    if (obstacle === "navmesh boundary") nav.raycast.mockReturnValue({ success: true, t: 0.3 });
    world.step();
    expect(run(700)).toBe(false);
    expect(p.st.dash).toBe(DASH_MAX);
  });

  it("cannot spend missing charges or use abilities after death or the end of a match", () => {
    const { room, p, run } = fixture();
    p.st.dash = 0;
    expect(room.dash(p)).toBe(false);
    p.st.dash = 1; p.st.alive = false;
    expect(room.dash(p)).toBe(false);
    p.st.alive = true; room.state.phase = "ended";
    expect(run(1000)).toBe(false);
    expect(room.dash(p)).toBe(false);
    expect(p.st.dash).toBe(1);
  });

  it("clears an old target and maneuver when respawning", () => {
    const { bot, p, enemy, run } = fixture();
    enemy.st.z = -45;
    run(500);
    enemy.st.alive = false;
    Object.assign(p.st, { x: 0, y: 0.03, z: 0, dash: DASH_MAX, flags: 0, weapon: "ar" as WeaponId });
    bot.onSpawn({ x: 0, y: 0.03, z: 0, yaw: 0, team: 1 });
    run(500);
    expect(p.st.flags & F_DASH).toBe(0);
    expect(p.st.dash).toBe(DASH_MAX);
  });
});
