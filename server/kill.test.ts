import { describe, expect, it, vi } from "vitest";
import { MatchRoom, type ServerPlayer } from "./MatchRoom";
import type { KillEvent } from "../game/shared/messages";

vi.mock("./world", () => ({ map: {}, RAPIER: {} }));
vi.mock("./bot", () => ({ Bot: class {}, BOT_NAMES: [] }));

function player(id: string, x: number) {
  return { id, st: { name: id, team: 1, hp: 40, alive: true, x, y: 0, z: 0, weapon: "ar", kills: 0, deaths: 0, assists: 0, score: 0, streak: 0 },
    client: { send: vi.fn() }, ammo: {}, lastAttacker: "", damagedBy: new Map(), reloadingUntil: 0 } as unknown as ServerPlayer;
}

describe("elimination snapshots", () => {
  it("broadcasts health, names, distance, position and the authoritative respawn time", () => {
    const killer = player("Killer", 30), victim = player("Victim", 0), broadcast = vi.fn();
    const room = { state: { phase: "live", mode: "ffa" }, players: new Map([[killer.id, killer], [victim.id, victim]]), broadcast, checkScoreLimit: vi.fn() };
    expect(MatchRoom.prototype.damage.call(room as unknown as MatchRoom, victim, 100, killer, "ar", "head", [30, 1.6, 0])).toBe(true);
    const event = broadcast.mock.calls[0][1] as KillEvent;
    expect(event).toMatchObject({ killer: "Killer", victim: "Victim", headshot: true, distance: 30, respawnAt: victim.respawnAt,
      killerInfo: { name: "Killer", hp: 40, position: [30, 0, 0] }, victimInfo: { name: "Victim" } });
    killer.st.name = "Changed";
    expect(event.killerInfo?.name).toBe("Killer");
  });
  it("does not attach a killer to an unassisted environmental death", () => {
    const victim = player("Victim", 0), broadcast = vi.fn();
    const room = { state: { phase: "live", mode: "ffa" }, players: new Map([[victim.id, victim]]), broadcast, checkScoreLimit: vi.fn() };
    MatchRoom.prototype.damage.call(room as unknown as MatchRoom, victim, 100, null, "fall", "body", [0, 0, 0]);
    expect(broadcast.mock.calls[0][1]).toMatchObject({ killer: "Victim", victim: "Victim" });
    expect(broadcast.mock.calls[0][1].killerInfo).toBeUndefined();
  });

  it("credits an assist to everyone else who hurt the victim recently, but not the killer", () => {
    const killer = player("Killer", 30), helper = player("Helper", 10), stale = player("Stale", 5), victim = player("Victim", 0);
    const room = { state: { phase: "live", mode: "ffa" }, players: new Map([killer, helper, stale, victim].map((p) => [p.id, p])), broadcast: vi.fn(), checkScoreLimit: vi.fn() };
    victim.st.hp = 100;
    const damage = (from: ServerPlayer, amount: number) => MatchRoom.prototype.damage.call(room as unknown as MatchRoom, victim, amount, from, "ar", "body", [0, 0, 0]);
    damage(stale, 10);
    victim.damagedBy.set(stale.id, victim.damagedBy.get(stale.id)! - 11_000);
    damage(helper, 30);
    damage(killer, 20);
    expect(damage(killer, 100)).toBe(true);
    expect([killer.st.kills, killer.st.assists, helper.st.assists, stale.st.assists]).toEqual([1, 0, 1, 0]);
    expect(helper.st.score).toBe(50);
    expect(victim.damagedBy.size).toBe(0);
  });
});

describe("player names", () => {
  it("numbers a duplicate name instead of sharing it", () => {
    const room = { players: new Map([["a", player("Raven", 0)], ["b", player("raven2", 0)]]) };
    expect(MatchRoom.prototype.uniqueName.call(room as unknown as MatchRoom, "Raven")).toBe("Raven3");
    expect(MatchRoom.prototype.uniqueName.call(room as unknown as MatchRoom, "Fox")).toBe("Fox");
    room.players.set("c", player("SixteenCharName!", 0));
    expect(MatchRoom.prototype.uniqueName.call(room as unknown as MatchRoom, "SixteenCharName!")).toBe("SixteenCharName2");
  });
});
