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

/** Emotes a player can do during a match (T); moving or any combat action ends one. */
export const EMOTES = [
  { id: "dance", label: "Dance" },
  { id: "talk", label: "Talk" },
  { id: "magic", label: "Spell stance" },
  { id: "idleFoldArms", label: "Arms folded" },
] as const;

export type EmoteId = typeof EMOTES[number]["id"];

export function isEmote(value: unknown): value is EmoteId {
  return EMOTES.some((item) => item.id === value);
}

/** A living player may start an emote (rate limited) or end theirs ("idle") at any time. */
export function canEmote(alive: boolean, connected: boolean, value: unknown, lastAt: number, now: number) {
  if (!alive || !connected) return false;
  return value === "idle" || isEmote(value) && now - lastAt >= SHOWOFF_COOLDOWN_MS;
}

export interface ShowcasePlayer {
  id: string;
  name: string;
  char: number;
  team: number;
  emote: string;
}
