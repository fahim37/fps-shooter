import { schema, t, type SchemaType } from "@colyseus/schema";

/** Replicated player state. Positions are client-authoritative (validated), the rest server-owned. */
export const PlayerState = schema({
  name: t.string().default(""),
  team: t.uint8().default(0),
  char: t.uint8().default(0),
  bot: t.boolean().default(false),
  x: t.float32().default(0),
  y: t.float32().default(0),
  z: t.float32().default(0),
  yaw: t.float32().default(0),
  pitch: t.float32().default(0),
  flags: t.uint8().default(0),
  weapon: t.string().default("ar"),
  primary: t.string().default("ar"),
  hp: t.uint8().default(100),
  alive: t.boolean().default(false),
  protectedUntil: t.float64().default(0),
  kills: t.uint16().default(0),
  deaths: t.uint16().default(0),
  score: t.uint16().default(0),
  streak: t.uint8().default(0),
  ping: t.uint16().default(0),
  /** Increments on every shot so remote clients can play fire animations. */
  shots: t.uint8().default(0),
  connected: t.boolean().default(true),
}, "PlayerState");
export type PlayerState = SchemaType<typeof PlayerState>;

export const GrenadeState = schema({
  owner: t.string().default(""),
  x: t.float32().default(0),
  y: t.float32().default(0),
  z: t.float32().default(0),
}, "GrenadeState");
export type GrenadeState = SchemaType<typeof GrenadeState>;

export const MatchState = schema({
  /** Server clock (ms) at the last simulation tick; stamps each state snapshot for interpolation. */
  serverTime: t.float64().default(0),
  mode: t.string().default("ffa"),
  roomName: t.string().default(""),
  code: t.string().default(""),
  /** "warmup" | "live" | "ended" */
  phase: t.string().default("warmup"),
  /** Server time (ms) when the current phase ends. */
  phaseEndsAt: t.float64().default(0),
  scoreLimit: t.uint16().default(30),
  team1: t.uint16().default(0),
  team2: t.uint16().default(0),
  /** Session id of the winning player, or "1"/"2" for a team. */
  winner: t.string().default(""),
  players: t.map(PlayerState),
  grenades: t.map(GrenadeState),
}, "MatchState");
export type MatchState = SchemaType<typeof MatchState>;
