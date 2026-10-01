import { describe, expect, it } from "vitest";
import { startBlockReason, type LobbyPlayer } from "./lobby";

const player = (team: number, ready = true): LobbyPlayer => ({ team, ready, connected: true, bot: false });
const duel = { format: "1v1", mode: "tdm", maxPlayers: 2, botFill: 0 };
describe("room start requirements", () => {
  it("requires exactly two humans for a duel, with no bots substituting", () => {
    expect(startBlockReason(duel, [player(1), { ...player(2), bot: true }])).toContain("Invite 1 more player");
    expect(startBlockReason(duel, [player(1), player(2)])).toBe("");
  });
  it("requires a full and balanced 2v2 roster", () => {
    const doubles = { ...duel, format: "2v2", maxPlayers: 4 };
    expect(startBlockReason(doubles, [player(1), player(2)])).toContain("Invite 2 more players");
    expect(startBlockReason(doubles, [player(1), player(1), player(1), player(2)])).toContain("same number");
    expect(startBlockReason(doubles, [player(1), player(1), player(2), player(2)])).toBe("");
  });
  it("blocks an unready or disconnected player", () => {
    expect(startBlockReason(duel, [player(1), player(2, false)])).toContain("ready up");
    expect(startBlockReason(duel, [player(1), { ...player(2), connected: false }])).toContain("reconnect");
  });
  it("allows smaller balanced custom matches", () => {
    expect(startBlockReason({ ...duel, format: "custom", maxPlayers: 12 }, [player(1), player(2)])).toBe("");
  });
  it("lets a solo player start only with practice bots enabled", () => {
    expect(startBlockReason({ ...duel, format: "custom", mode: "ffa" }, [player(0)])).toContain("another player");
    expect(startBlockReason({ ...duel, format: "custom", botFill: 4 }, [player(1)])).toBe("");
  });
});
