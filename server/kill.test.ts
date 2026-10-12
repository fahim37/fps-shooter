import { describe, expect, it, vi } from "vitest";
import { MatchRoom, type ServerPlayer } from "./MatchRoom";
import type { KillEvent } from "../game/shared/messages";

vi.mock("./world", () => ({ map: {}, RAPIER: {} }));
vi.mock("./bot", () => ({ Bot: class {}, BOT_NAMES: [] }));

function player(id: string, x: number) {
  return { id, st: { name: id, team: 1, hp: 40, alive: true, x, y: 0, z: 0, weapon: "ar", kills: 0, deaths: 0, score: 0, streak: 0 },
    client: { send: vi.fn() }, ammo: {}, lastAttacker: "", reloadingUntil: 0 } as unknown as ServerPlayer;
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
});
