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
/** Sliding, the body is laid back along the ground: the eye is level with the drawn head. */
export const SLIDE_EYE_HEIGHT = 0.8;

/** Movement (m/s, m/s²). */
export const WALK_SPEED = 5.75;
export const SPRINT_SPEED = 8.4;
export const CROUCH_SPEED = 2.5;
export const ADS_SPEED_MULT = 0.6;
export const GROUND_ACCEL = 55;
export const AIR_ACCEL = 12;
export const FRICTION = 12;
export const JUMP_VELOCITY = 6.4;
export const GRAVITY = 20;

/**
 * Slide: crouching out of a sprint throws the player forward at SLIDE_SPEED (scaled by the gun's
 * handling), then the ground drags it down at SLIDE_FRICTION until it falls to SLIDE_END_SPEED,
 * about 7 m later. A jump out of it carries the speed through the air.
 */
export const SLIDE_SPEED = 10.4;
export const SLIDE_FRICTION = 4.4;
export const SLIDE_END_SPEED = 3.6;
/** Ground speed a sprint must have for a slide to start. */
export const SLIDE_MIN_ENTRY = 6.5;
/** Longest a slide lasts, and the wait after one before the next (s). */
export const SLIDE_MAX_SECONDS = 1.7;
export const SLIDE_COOLDOWN = 0.55;
/** How fast a slide's direction follows the keys (rad/s at full input). */
export const SLIDE_STEER = 1.1;
/** Dash (F): a very fast, level burst the way the keys point (straight ahead with none held). About 11 m. */
export const DASH_SPEED = 46;
export const DASH_SECONDS = 0.235;
/** Looking up lifts a dash a little: the share of its speed that goes upward at the steepest look that counts. */
export const DASH_LIFT = 0.3;
/** A life starts with DASH_MAX dashes, the most held at once. Below that, every DASH_KILLS kills give DASH_REFILL more. */
export const DASH_MAX = 2;
export const DASH_KILLS = 2;
export const DASH_REFILL = 2;
/** A jump pressed this long before landing still happens on landing (ms). */
export const JUMP_BUFFER_MS = 130;

export const MAX_HEALTH = 100;
/** Taken before health. Never regenerates: every life starts with it and kill streaks refill it. */
export const MAX_SHIELD = 20;
/** Every this many kills in a row refills the shield. */
export const SHIELD_STREAK = 3;
export const REGEN_DELAY_MS = 5000;
export const REGEN_PER_SEC = 20;
export const RESPAWN_MS = 3500;
export const SPAWN_PROTECTION_MS = 4000;
export const GRENADES_PER_LIFE = 2;
export const FALL_DAMAGE_MIN_SPEED = 13;

export const MAX_PLAYERS = 20;
export const ROOM_NAME = "match";

export type GameMode = "ffa" | "tdm";
export const MODE_INFO: Record<GameMode, { name: string; scoreLimit: number; minutes: number }> = {
  ffa: { name: "Free for All", scoreLimit: 30, minutes: 10 },
  tdm: { name: "Team Deathmatch", scoreLimit: 60, minutes: 10 },
};

/** Eliminations to win that a room creator can choose; the mode's default is among them. */
export const SCORE_LIMITS: Record<GameMode, readonly number[]> = { tdm: [30, 60, 100, 150, 200], ffa: [20, 30, 50, 75, 100, 150, 200] };
export const ROOM_SIZES = [2, 4, 6, 8, 10, 12, 16, 20] as const;

/** A listed score limit for the mode, or the mode's default. */
export function scoreLimitFor(mode: GameMode, requested?: unknown): number {
  return typeof requested === "number" && SCORE_LIMITS[mode].includes(requested) ? requested : MODE_INFO[mode].scoreLimit;
}

/** Higher targets get a longer clock (rounded up to 5 minutes) so they stay reachable. */
export function matchMinutes(mode: GameMode, scoreLimit: number): number {
  const { minutes, scoreLimit: base } = MODE_INFO[mode];
  return Math.max(minutes, Math.ceil((minutes * scoreLimit) / base / 5) * 5);
}

export const WARMUP_MS = 8000;
export const END_SCREEN_MS = 12000;

/** Outfit tints: neutral, blue and red. In a match these mean ally and enemy as seen by the viewer. */
export const TEAM_COLORS = ["#e8e8e8", "#3f86ff", "#ff4d3d"] as const;
export const TEAM_NAMES = ["", "Blue", "Red"] as const;
