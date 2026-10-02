/** Stable, server-validated IDs; only these clips are shipped to the lobby. */
export const SHOWOFFS = [
  { id: "idle", label: "At ease", source: "Idle_Loop" },
  { id: "dance", label: "Dance", source: "Dance_Loop" },
  { id: "talk", label: "Talk", source: "Idle_Talking_Loop" },
  { id: "magic", label: "Spell stance", source: "Spell_Simple_Idle_Loop" },
] as const;

export type ShowoffId = typeof SHOWOFFS[number]["id"];
export const SHOWOFF_COOLDOWN_MS = 750;

export function isShowoff(value: unknown): value is ShowoffId {
  return SHOWOFFS.some((item) => item.id === value);
}

export function canShowoff(phase: string, connected: boolean, value: unknown, lastAt: number, now: number) {
  return phase === "waiting" && connected && isShowoff(value) && now - lastAt >= SHOWOFF_COOLDOWN_MS;
}

export interface ShowcasePlayer {
  id: string;
  name: string;
  char: number;
  team: number;
  emote: string;
}
