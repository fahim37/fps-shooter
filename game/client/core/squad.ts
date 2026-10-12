import type { GameMode } from "../../shared/constants";

/** Slot colors, PUBG-style: you are always slot 1; teammates keep their join order. */
export const SQUAD_COLORS = ["#e5fa8a", "#ffb547", "#6cc4ff", "#7be39a", "#d996ff", "#ff8fbf"] as const;

export interface SquadMember {
  id: string;
  name: string;
  hp: number;
  alive: boolean;
  connected: boolean;
  bot: boolean;
  me: boolean;
  slot: number;
}

interface SquadSource { name: string; team: number; hp: number; alive: boolean; connected: boolean; bot: boolean }

/** Your team in TDM, you first. Free-for-all has no squad. */
export function buildSquad(players: Iterable<[string, SquadSource]>, myId: string, myTeam: number, mode: GameMode): SquadMember[] {
  if (mode !== "tdm" || !myTeam) return [];
  const members: Omit<SquadMember, "slot">[] = [];
  for (const [id, p] of players) {
    if (p.team !== myTeam) continue;
    const member = { id, name: p.name, hp: p.alive ? Math.round(p.hp) : 0, alive: p.alive, connected: p.connected, bot: p.bot, me: id === myId };
    if (member.me) members.unshift(member); else members.push(member);
  }
  return members.slice(0, SQUAD_COLORS.length).map((member, slot) => ({ ...member, slot }));
}
