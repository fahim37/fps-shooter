export interface LobbyPlayer { team: number; ready: boolean; connected: boolean; bot: boolean }

/** Shared explanation; the server makes the final decision to start. */
export function startBlockReason(room: { format: string; mode: string; maxPlayers: number; botFill: number }, roster: LobbyPlayer[]): string {
  const humans = roster.filter((p) => !p.bot);
  if (humans.some((p) => !p.connected)) return "Waiting for a player to reconnect.";
  if (room.format === "1v1" || room.format === "2v2") {
    const needed = room.format === "1v1" ? 2 : 4;
    if (humans.length !== needed) return `Invite ${needed - humans.length} more ${needed - humans.length === 1 ? "player" : "players"} to play ${room.format}.`;
  } else if (Math.max(humans.length, room.botFill) < 2) return "Invite another player or create a room with practice bots.";
  if (room.mode === "tdm" && room.botFill === 0) {
    const blue = humans.filter((p) => p.team === 1).length;
    const red = humans.filter((p) => p.team === 2).length;
    if (!blue || blue !== red) return "Choose teams with the same number of players.";
  }
  if (humans.some((p) => !p.ready)) return "Waiting for everyone to ready up.";
  return "";
}
