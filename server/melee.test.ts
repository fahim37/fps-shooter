import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MatchRoom, type ServerPlayer } from "./MatchRoom";
import { initWorldData, RAPIER } from "./world";
import { MatchState, PlayerState } from "../game/shared/schema";
import { buildWorld, type World } from "../game/shared/physics";
import { PoseHistory } from "../game/shared/lagcomp";
import { aimDir, lookAt } from "../game/shared/aim";
import { EYE_HEIGHT } from "../game/shared/constants";
import { WEAPONS, isBackstab, type MeleeId } from "../game/shared/weapons";
import type { MapData } from "../game/shared/map/types";

type V3 = [number, number, number];

/** An open field: the ground and the boundary walls only. */
const FIELD: MapData = { id: "outpost", pieces: [], spawns: [], half: 60, kits: [], overview: { roads: [], plazas: [], buildings: [], labels: [] } };

let world: World;
beforeAll(async () => { await initWorldData(); world = buildWorld(RAPIER, FIELD, {}); }, 60_000);
afterAll(() => world?.free());

function player(id: string, team: number, x: number, z: number, melee: MeleeId = "knife"): ServerPlayer {
  const st = new PlayerState();
  Object.assign(st, { id, alive: true, hp: 100, shield: 0, team, x, y: 0, z, primary: "ar", weapon: melee, melee, emote: "idle", protectedUntil: 0 });
  const ammo = Object.fromEntries(Object.values(WEAPONS).map((w) => [w.id, { mag: w.mag, reserve: w.reserve }])) as ServerPlayer["ammo"];
  return { id, st, history: new PoseHistory(), ammo, reloadingUntil: 0, lastFireAt: 0, lastSwingAt: 0, heavyUntil: 0, client: { send: vi.fn() } } as unknown as ServerPlayer;
}

/** The attacker at the origin; the target `dist` m ahead (-Z), `side` m to the right, facing `yaw` (0: away from the attacker). */
function fixture(dist: number, { side = 0, yaw = Math.PI, melee = "knife" as MeleeId } = {}) {
  const attacker = player("a", 1, 0, 0, melee), target = player("b", 2, side, -dist);
  for (let t = Date.now() - 400; t <= Date.now(); t += 33) target.history.push(t, { x: side, y: 0, z: -dist, crouch: false, yaw });
  const room = Object.assign(Object.create(MatchRoom.prototype), {
    state: Object.assign(new MatchState(), { phase: "live", mode: "tdm" }), world, map: FIELD,
    players: new Map([["a", attacker], ["b", target]]), broadcast: vi.fn(),
    moveStats: { speed: 0, wall: 0, height: 0, hover: 0, aim: 0 },
  }) as MatchRoom;
  const hits = vi.spyOn(room, "damage").mockReturnValue(false);
  return { room, attacker, target, hits };
}

/** Swings from the attacker's eye at `at` (the reported view looks there too unless `view` says otherwise). */
function swing(room: MatchRoom, attacker: ServerPlayer, at: V3, weapon: MeleeId = attacker.st.melee as MeleeId, view?: { yaw: number; pitch: number }, blow?: "light" | "heavy") {
  const origin: V3 = [0, EYE_HEIGHT, 0];
  const look = lookAt(origin, at);
  attacker.st.yaw = (view ?? look).yaw; attacker.st.pitch = (view ?? look).pitch;
  room.melee(attacker, { weapon, blow, viewTime: Date.now(), origin, dir: aimDir(look.yaw, look.pitch) });
}

describe("blade swings", () => {
  it("cuts a body in reach for the blade's damage", () => {
    const { room, attacker, target, hits } = fixture(1.4);
    swing(room, attacker, [0, 1.2, -1.4]);
    expect(hits).toHaveBeenCalledWith(target, WEAPONS.knife.damage, attacker, "knife", expect.anything(), expect.anything());
    expect(room.broadcast).toHaveBeenCalledWith("swing", expect.objectContaining({ id: "a", hit: "b", backstab: false }), expect.anything());
  });

  it("backstabs a body facing away", () => {
    const { room, attacker, target, hits } = fixture(1.4, { yaw: 0 });
    swing(room, attacker, [0, 1.2, -1.4]);
    expect(hits).toHaveBeenCalledWith(target, WEAPONS.knife.melee!.backstab, attacker, "knife", expect.anything(), expect.anything());
  });

  it("does not reach past the blade", () => {
    const knife = fixture(WEAPONS.knife.melee!.range + 0.8);
    swing(knife.room, knife.attacker, [0, 1.2, -(WEAPONS.knife.melee!.range + 0.8)]);
    expect(knife.hits).not.toHaveBeenCalled();
    // A body the katana's longer blade still reaches.
    const katana = fixture(2.6, { melee: "katana" });
    swing(katana.room, katana.attacker, [0, 1.2, -2.6]);
    expect(katana.hits).toHaveBeenCalledTimes(1);
  });

  it("sweeps a body a little off the crosshair", () => {
    const { room, attacker, hits } = fixture(1.3, { side: 0.55 });
    swing(room, attacker, [0, 1.2, -1.3]);
    expect(hits).toHaveBeenCalledTimes(1);
  });

  it("cuts nothing swung off the reported view", () => {
    const { room, attacker, hits } = fixture(1.4);
    swing(room, attacker, [0, 1.2, -1.4], "knife", { yaw: Math.PI, pitch: 0 });
    expect(hits).not.toHaveBeenCalled();
  });

  it("swings no faster than the blade's rate", () => {
    const { room, attacker, hits } = fixture(1.4);
    swing(room, attacker, [0, 1.2, -1.4]);
    swing(room, attacker, [0, 1.2, -1.4]);
    expect(hits).toHaveBeenCalledTimes(1);
  });

  it.each(["knife", "katana"] as const)("enforces the %s heavy recovery even when followed by a light", (weapon) => {
    const { room, attacker, target, hits } = fixture(1.4, { melee: weapon });
    const heavy = WEAPONS[weapon].melee!.heavy;
    vi.useFakeTimers();
    try {
      swing(room, attacker, [0, 1.2, -1.4], weapon, undefined, "heavy");
      expect(hits).toHaveBeenCalledWith(target, heavy.damage, attacker, weapon, expect.anything(), expect.anything());
      expect(room.broadcast).toHaveBeenCalledWith("swing", expect.objectContaining({ blow: "heavy" }), expect.anything());
      vi.advanceTimersByTime(heavy.intervalMs - 1);
      swing(room, attacker, [0, 1.2, -1.4]);
      expect(hits).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      swing(room, attacker, [0, 1.2, -1.4]);
      expect(attacker.st.shots).toBe(2);
    } finally { vi.useRealTimers(); }
  });

  it("ignores a blade the player does not carry", () => {
    const { room, attacker, hits } = fixture(1.4);
    swing(room, attacker, [0, 1.2, -1.4], "katana");
    expect(hits).not.toHaveBeenCalled();
  });
});

describe("backstab", () => {
  it("needs the attacker behind the target and facing its way", () => {
    // Target at the origin facing -Z (yaw 0).
    const target = { x: 0, z: 0, yaw: 0 };
    expect(isBackstab({ x: 0, z: 1, yaw: 0 }, target)).toBe(true);
    expect(isBackstab({ x: 0, z: -1, yaw: Math.PI }, target)).toBe(false);
    // Behind, but turned side-on.
    expect(isBackstab({ x: 0, z: 1, yaw: Math.PI / 2 }, target)).toBe(false);
  });
});
