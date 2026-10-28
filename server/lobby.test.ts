import { describe, expect, it, vi } from "vitest";
import type { Client } from "colyseus";
import { MatchRoom } from "./MatchRoom";
import { MatchState, PlayerState } from "../game/shared/schema";

vi.mock("./world", () => ({ map: {}, RAPIER: {} }));
vi.mock("./bot", () => ({ Bot: class {}, BOT_NAMES: [] }));

function fixture() {
  const room = Object.assign(Object.create(MatchRoom.prototype), {
    state: new MatchState(), players: new Map(), grenades: new Map(), maxClients: 6,
    updateMeta: vi.fn(), balanceBots: vi.fn(), spawn: vi.fn(), unlock: vi.fn(), setPrivate: vi.fn(),
    allowReconnection: vi.fn().mockResolvedValue(undefined),
  });
  room.state.lobby = true; room.state.mode = "tdm"; room.state.phase = "waiting";
  const client = { sessionId: "host", send: vi.fn() } as unknown as Client;
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

describe("waiting-room management", () => {
  function managed() {
    const f = fixture();
    f.room.state.maxPlayers = 6;
    const guest = { sessionId: "guest", send: vi.fn(), leave: vi.fn() } as unknown as Client;
    f.room.onJoin(guest, { name: "Guest", char: 0, team: 2 });
    return { ...f, guest, target: f.room.state.players.get("guest") as PlayerState };
  }
  const settings = { roomName: "New room", maxPlayers: 4, scoreLimit: 200, privateRoom: false, practiceBots: true };

  it("lets the host move a player without losing readiness and enforces team capacity", () => {
    const { room, client, target } = managed(); target.ready = true;
    room.managePlayer(client, { action: "team", playerId: "guest", team: 1 });
    expect(target.team).toBe(1); expect(target.ready).toBe(true);
    room.onJoin({ sessionId: "third" } as Client, { name: "Third", char: 0, team: 1 });
    room.onJoin({ sessionId: "fourth" } as Client, { name: "Fourth", char: 0, team: 2 });
    room.managePlayer(client, { action: "team", playerId: "fourth", team: 1 });
    expect(room.state.players.get("fourth").team).toBe(2);
    expect(client.send).toHaveBeenCalledWith("lobbyError", expect.stringContaining("full"));
  });

  it("transfers every host permission and prevents guests or the old host from managing players", () => {
    const { room, client, guest, host, target } = managed();
    for (const action of ["team", "kick", "host"]) room.managePlayer(guest, { action, playerId: "host", team: 2 });
    expect(host.team).toBe(1); expect(room.state.hostId).toBe("host");
    room.managePlayer(client, { action: "host", playerId: "guest" });
    expect(room.state.hostId).toBe("guest");
    room.managePlayer(client, { action: "team", playerId: "guest", team: 1 });
    room.changeRoomSettings(client, settings);
    expect(target.team).toBe(2); expect(room.maxClients).toBe(6);
    room.changeRoomSettings(guest, settings);
    expect(room.maxClients).toBe(4); expect(room.state.scoreLimit).toBe(200);
  });

  it("swaps players across full teams atomically and rejects invalid swap targets", () => {
    const { room, client, target } = managed(); room.maxClients = 2; target.ready = true;
    room.managePlayer(client, { action: "team", playerId: "host", team: 2, swapWith: "missing" });
    expect(target.team).toBe(2);
    room.managePlayer(client, { action: "team", playerId: "host", team: 2, swapWith: "host" });
    expect(target.team).toBe(2);
    room.managePlayer(client, { action: "team", playerId: "host", team: 2, swapWith: "guest" });
    expect(room.state.players.get("host").team).toBe(2); expect(target.team).toBe(1); expect(target.ready).toBe(true);
  });

  it("kicks a peer without allowing automatic reconnection, and cannot kick itself", () => {
    const { room, client, guest, target } = managed();
    room.managePlayer(client, { action: "kick", playerId: "host" });
    expect(room.state.hostId).toBe("host");
    room.managePlayer(client, { action: "kick", playerId: "guest" });
    expect(target.connected).toBe(false);
    expect(guest.leave).toHaveBeenCalledWith(4000, expect.stringContaining("removed"));
  });

  it("rejects stale, disconnected and malformed management requests", () => {
    const { room, client, guest, target } = managed(); target.connected = false;
    room.managePlayer(client, { action: "host", playerId: "guest" });
    for (const value of [null, 1, "guest", {}, { action: "team", playerId: "guest", team: 3 }, { action: "kick", playerId: "missing" }]) room.managePlayer(client, value);
    expect(room.state.hostId).toBe("host"); expect(guest.leave).not.toHaveBeenCalled();
    target.connected = true;
    room.state.phase = "live";
    room.managePlayer(client, { action: "host", playerId: "guest" });
    room.changeRoomSettings(client, settings); room.renamePlayer(guest, "Changed");
    expect(room.state.hostId).toBe("host"); expect(room.maxClients).toBe(6); expect(target.name).toBe("Guest");
  });

  it("renames only the sender, sanitizes and deduplicates names, and preserves readiness", () => {
    const { room, guest, host, target } = managed(); target.ready = true;
    room.renamePlayer(guest, "  <Host>  ");
    expect(target.name).toBe("Host2"); expect(host.name).toBe("Host"); expect(target.ready).toBe(true);
    room.renamePlayer(guest, "HOST2"); expect(target.name).toBe("HOST2");
    room.renamePlayer(guest, "LongPlayerNameBeyondTheLimit"); expect(target.name.length).toBeLessThanOrEqual(16);
    const saved = target.name;
    for (const value of [null, { name: "Oops" }, "", "<>!", "---"]) room.renamePlayer(guest, value);
    expect(target.name).toBe(saved);
    expect(guest.send).toHaveBeenCalledWith("nameChanged", saved);
  });

  it("updates settings for everyone and refuses sizes smaller than the roster or a team", () => {
    const { room, client, guest, host } = managed();
    room.changeRoomSettings(guest, settings); expect(room.maxClients).toBe(6);
    room.state.players.get("guest").team = 1;
    room.changeRoomSettings(client, { ...settings, maxPlayers: 2 });
    expect(room.maxClients).toBe(6); expect(room.state.scoreLimit).not.toBe(200);
    room.changeRoomSettings(client, settings);
    expect(room.state).toMatchObject({ roomName: "New room", maxPlayers: 4, scoreLimit: 200, botFill: 4, privateRoom: false });
    expect(room.maxClients).toBe(4); expect(host.ready).toBe(true);
    expect(room.setPrivate).toHaveBeenCalledWith(false);
    room.state.format = "2v2";
    room.changeRoomSettings(client, { ...settings, maxPlayers: 6, practiceBots: false }); expect(room.maxClients).toBe(4);
    room.changeRoomSettings(client, { ...settings, practiceBots: true }); expect(client.send).toHaveBeenCalledWith("lobbyError", expect.stringContaining("fixed"));
  });

  it("rejects invalid settings atomically", () => {
    const { room, client } = managed();
    for (const invalid of [null, {}, { ...settings, maxPlayers: 100 }, { ...settings, maxPlayers: 3 }, { ...settings, scoreLimit: 201 }, { ...settings, roomName: " " }, { ...settings, privateRoom: "yes" }]) room.changeRoomSettings(client, invalid);
    expect(room.maxClients).toBe(6); expect(room.state.scoreLimit).not.toBe(200);
  });
});
