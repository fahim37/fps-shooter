import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MatchRoom, type ServerPlayer } from "./MatchRoom";
import { initWorldData, RAPIER } from "./world";
import { MatchState, PlayerState } from "../game/shared/schema";
import { buildWorld, type World } from "../game/shared/physics";
import { PoseHistory } from "../game/shared/lagcomp";
import { aimDir, lookAt } from "../game/shared/aim";
import { EYE_HEIGHT } from "../game/shared/constants";
import { WEAPONS, type WeaponId } from "../game/shared/weapons";
import type { MapData } from "../game/shared/map/types";
import type { FireMsg } from "../game/shared/messages";

type V3 = [number, number, number];

/** An open field: the ground and the boundary walls only. */
const FIELD: MapData = { id: "outpost", pieces: [], spawns: [], half: 60, kits: [], overview: { roads: [], plazas: [], buildings: [], labels: [] } };

let world: World;
beforeAll(async () => { await initWorldData(); world = buildWorld(RAPIER, FIELD, {}); }, 60_000);
afterAll(() => world?.free());

function player(id: string, team: number, x: number, z: number): ServerPlayer {
  const st = new PlayerState();
  Object.assign(st, { id, alive: true, hp: 100, shield: 0, team, x, y: 0, z, primary: "sniper", weapon: "sniper", emote: "idle", protectedUntil: 0 });
  const ammo = Object.fromEntries(Object.values(WEAPONS).map((w) => [w.id, { mag: w.mag, reserve: w.reserve }])) as ServerPlayer["ammo"];
  return { id, st, history: new PoseHistory(), ammo, reloadingUntil: 0, lastFireAt: 0, client: { send: vi.fn() } } as unknown as ServerPlayer;
}

function fixture() {
  const shooter = player("a", 1, 0, 0), target = player("b", 2, 0, -30);
  for (let t = Date.now() - 400; t <= Date.now(); t += 33) target.history.push(t, { x: 0, y: 0, z: -30, crouch: false, yaw: 0 });
  const room = Object.assign(Object.create(MatchRoom.prototype), {
    state: Object.assign(new MatchState(), { phase: "live", mode: "tdm" }), world, map: FIELD,
    players: new Map([["a", shooter], ["b", target]]), broadcast: vi.fn(),
    claimStats: { taken: 0, refused: 0, headTaken: 0, headRefused: 0 }, claimsByGun: {}, moveStats: { speed: 0, wall: 0, height: 0, hover: 0, aim: 0 },
  }) as MatchRoom;
  const hits = vi.spyOn(room, "damage").mockReturnValue(false);
  return { room, shooter, target, hits };
}

/** Fires from the shooter's eye along `dir`, the client claiming a body hit on the target 30 m away. */
function shoot(room: MatchRoom, shooter: ServerPlayer, dir: V3, weapon: WeaponId = "sniper") {
  const origin: V3 = [0, EYE_HEIGHT, 0];
  const msg: FireMsg = { weapon, viewTime: Date.now(), origin, dirs: [dir], claims: [{ id: "b", part: "body", dist: 30 }] };
  shooter.lastFireAt = 0;
  room.fire(shooter, msg);
}

describe("shots must leave along the view the shooter reports", () => {
  const atChest = lookAt([0, EYE_HEIGHT, 0], [0, 1.2, -30]);
  it("hits along the reported view", () => {
    const { room, shooter, hits } = fixture();
    shooter.st.yaw = atChest.yaw; shooter.st.pitch = atChest.pitch;
    shoot(room, shooter, aimDir(atChest.yaw, atChest.pitch));
    expect(hits).toHaveBeenCalledTimes(1);
  });
  it("hits with the recoil kick and the widest hip-fire spread on top of the view", () => {
    const { room, shooter, hits } = fixture();
    // The view reported a little off the target: the shot still leaves within the cone.
    shooter.st.yaw = atChest.yaw + (WEAPONS.sniper.spreadHip + 4) * Math.PI / 180; shooter.st.pitch = atChest.pitch;
    shoot(room, shooter, aimDir(atChest.yaw, atChest.pitch));
    expect(hits).toHaveBeenCalledTimes(1);
  });
  it("hits nothing with a shot fired behind the shooter's back (silent aim)", () => {
    const { room, shooter, hits } = fixture();
    shooter.st.yaw = atChest.yaw + Math.PI; shooter.st.pitch = 0;
    shoot(room, shooter, aimDir(atChest.yaw, atChest.pitch));
    expect(hits).not.toHaveBeenCalled();
    // The round is still spent, and everyone else still sees the shot.
    expect(shooter.ammo.sniper.mag).toBe(WEAPONS.sniper.mag - 1);
    expect(room.broadcast).toHaveBeenCalledWith("shot", expect.objectContaining({ hits: [] }), expect.anything());
  });
  it("hits nothing 60 degrees off the view", () => {
    const { room, shooter, hits } = fixture();
    shooter.st.yaw = atChest.yaw + Math.PI / 3; shooter.st.pitch = atChest.pitch;
    shoot(room, shooter, aimDir(atChest.yaw, atChest.pitch));
    expect(hits).not.toHaveBeenCalled();
  });
});
