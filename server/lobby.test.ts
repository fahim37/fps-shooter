import { describe, expect, it, vi } from "vitest";
import type { Client } from "colyseus";
import { MatchRoom } from "./MatchRoom";
import { MatchState, PlayerState } from "../game/shared/schema";

vi.mock("./world", () => ({ map: {}, RAPIER: {} }));
vi.mock("./bot", () => ({ Bot: class {}, BOT_NAMES: [] }));

function fixture() {
  const room = Object.assign(Object.create(MatchRoom.prototype), {
    state: new MatchState(), players: new Map(), grenades: new Map(), maxClients: 6,
    updateMeta: vi.fn(), balanceBots: vi.fn(), spawn: vi.fn(), unlock: vi.fn(),
    allowReconnection: vi.fn().mockResolvedValue(undefined),
  });
  room.state.lobby = true; room.state.mode = "tdm"; room.state.phase = "waiting";
  const client = { sessionId: "host" } as Client;
  room.onJoin(client, { name: "Host", char: 0 });
  room.state.players.get("host").ready = true;
  return { room, client, host: room.state.players.get("host") as PlayerState };
}

describe("persistent lobby readiness and late joins", () => {
  it("keeps the host ready when guests join and leave", () => {
    const { room, host } = fixture();
    const guest = { sessionId: "guest" } as Client;
    room.onJoin(guest, { name: "Guest", char: 0 });
    expect(host.ready).toBe(true);
    expect(room.state.players.get("guest").ready).toBe(false);
    room.onLeave(guest);
    expect(host.ready).toBe(true);
  });
  it("preserves readiness through a connection drop and reconnect", async () => {
    const { room, client, host } = fixture();
    await room.onDrop(client);
    expect(host.connected).toBe(false); expect(host.ready).toBe(true);
    room.onReconnect(client);
    expect(host.connected).toBe(true); expect(host.ready).toBe(true);
  });
  it("preserves readiness when returning to the lobby for another round", () => {
    const { room, host } = fixture();
    room.state.phase = "ended";
    room.startPhase("waiting");
    expect(host.ready).toBe(true); expect(host.alive).toBe(false);
  });
  it.each(["warmup", "live"])("joins the chosen team during %s without interrupting the match", (phase) => {
    const { room, host } = fixture(); room.state.phase = phase;
    const guest = { sessionId: "late" } as Client;
    room.onJoin(guest, { name: "Late", char: 0, team: 2 });
    const late = room.state.players.get("late");
    expect(late.team).toBe(2); expect(late.ready).toBe(true);
    expect(room.spawn).toHaveBeenCalledWith(room.players.get("late"));
    room.onLeave(guest);
    expect(room.state.phase).toBe(phase); expect(host.ready).toBe(true);
  });
  it("replaces a bot on the crowded team when a human chooses that side", () => {
    const { room } = fixture();
    room.state.phase = "live"; room.botTarget = 4;
    for (const [id, team] of [["human2", 2], ["late", 2], ["bot-blue", 1], ["bot-red", 2]] as const) {
      const st = new PlayerState(); st.team = team;
      const p = room.newPlayer(id, st);
      if (id.startsWith("bot")) { st.bot = true; p.bot = { dispose: vi.fn() }; }
      room.state.players.set(id, st);
    }
    delete room.balanceBots;
    room.balanceBots();
    expect(room.players.has("bot-red")).toBe(false);
    expect(room.players.has("bot-blue")).toBe(true);
    expect([...room.players.values()].map((p: { st: PlayerState }) => p.st.team).sort()).toEqual([1, 1, 2, 2]);
  });
});
