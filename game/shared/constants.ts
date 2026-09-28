/** Simulation and networking rates. */
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
/** Remote players are rendered this far in the past so there are always two snapshots to blend. */
export const INTERP_DELAY_MS = 100;
/** Longest rewind the server grants for lag compensation. */
export const MAX_REWIND_MS = 300;

/** Player body (meters). Position is the feet. */
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE_HEIGHT = 1.12;

/** Movement (m/s, m/s²). */
export const WALK_SPEED = 5.2;
export const SPRINT_SPEED = 7.6;
export const CROUCH_SPEED = 2.5;
export const ADS_SPEED_MULT = 0.62;
export const GROUND_ACCEL = 55;
export const AIR_ACCEL = 12;
export const FRICTION = 12;
export const JUMP_VELOCITY = 6.4;
export const GRAVITY = 20;

export const MAX_HEALTH = 100;
export const REGEN_DELAY_MS = 5000;
export const REGEN_PER_SEC = 20;
export const RESPAWN_MS = 3500;
export const SPAWN_PROTECTION_MS = 2000;
export const GRENADES_PER_LIFE = 2;
export const FALL_DAMAGE_MIN_SPEED = 13;

export const MAX_PLAYERS = 12;
export const ROOM_NAME = "match";

export type GameMode = "ffa" | "tdm";
export const MODE_INFO: Record<GameMode, { name: string; scoreLimit: number; minutes: number }> = {
  ffa: { name: "Free for All", scoreLimit: 30, minutes: 10 },
  tdm: { name: "Team Deathmatch", scoreLimit: 60, minutes: 10 },
};

export const WARMUP_MS = 8000;
export const END_SCREEN_MS = 12000;

export const TEAM_COLORS = ["#e8e8e8", "#3f86ff", "#ff4d3d"] as const;
export const TEAM_NAMES = ["", "Blue", "Red"] as const;
