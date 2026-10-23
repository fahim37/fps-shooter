/**
 * Shapes shared by the game server's analytics recorder / admin API and the /admin dashboard.
 * Stored documents use `Date`; over the wire every Date arrives as an ISO string (`Wire<T>`).
 */

export type DeviceType = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export interface ClientInfo {
  browser: string;
  browserVersion: string;
  os: string;
  device: DeviceType;
}

export interface GeoInfo {
  /** ISO 3166-1 alpha-2, "" when unknown, "LAN" for private / loopback addresses. */
  country: string;
  countryName: string;
  region: string;
  city: string;
  lat: number | null;
  lon: number | null;
  timezone: string;
}

/** Combat totals shared by sessions, players and match participants. */
export interface CombatTotals {
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  headshots: number;
  shots: number;
  hits: number;
  damageDealt: number;
  damageTaken: number;
  grenadeKills: number;
  matches: number;
  wins: number;
}

export interface PingStats { avg: number; min: number; max: number; samples: number }

/** One human's connection to one room, from join to leave. */
export interface SessionDoc extends CombatTotals {
  _id: string;
  pid: string;
  name: string;
  char: number;
  sessionId: string;
  ip: string;
  ua: string;
  client: ClientInfo;
  geo: GeoInfo;
  roomId: string;
  roomName: string;
  map: string;
  mode: string;
  queue: string;
  team: number;
  joinedAt: Date;
  leftAt: Date;
  durationMs: number;
  ping: PingStats | null;
  /** Kills by weapon id. */
  weapons: Record<string, number>;
  favoriteWeapon: string;
  bestStreak: number;
  accuracy: number;
  kd: number;
}

/** Lifetime aggregate for one persistent player id. */
export interface PlayerDoc extends CombatTotals {
  _id: string;
  firstSeen: Date;
  lastSeen: Date;
  lastName: string;
  names: string[];
  sessions: number;
  playTimeMs: number;
  weapons: Record<string, number>;
  bestStreak: number;
  lastIp: string;
  ips: string[];
  lastGeo: GeoInfo;
  countries: string[];
  locations: string[];
  lastClient: ClientInfo;
  devices: string[];
  lastMap: string;
  lastMode: string;
}

export interface MatchParticipant {
  pid: string | null;
  sessionId: string;
  name: string;
  bot: boolean;
  team: number;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  /** Left before the match ended. */
  left: boolean;
  won: boolean;
}

export interface MatchDoc {
  _id: string;
  roomId: string;
  roomName: string;
  map: string;
  mode: string;
  queue: string;
  format: string;
  scoreLimit: number;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  endReason: "score" | "time" | "abandoned";
  /** TDM: "1" | "2" | "draw"; FFA: the winner's name; "" when abandoned. */
  winner: string;
  team1: number;
  team2: number;
  humans: number;
  bots: number;
  participants: MatchParticipant[];
}

export interface KillDoc {
  at: Date;
  matchId: string | null;
  roomId: string;
  map: string;
  mode: string;
  weapon: string;
  headshot: boolean;
  distance: number | null;
  killerPid: string | null;
  killerName: string;
  killerBot: boolean;
  victimPid: string | null;
  victimName: string;
  victimBot: boolean;
}

export interface ConcurrencySample { at: Date; players: number; bots: number; rooms: number }

/** Recursively turns Dates into ISO strings: what JSON.stringify sends. */
export type Wire<T> = T extends Date ? string
  : T extends (infer U)[] ? Wire<U>[]
  : T extends object ? { [K in keyof T]: Wire<T[K]> }
  : T;

// ----- admin API responses -----

export type StorageStatus = "connected" | "connecting" | "unavailable" | "disabled";

export interface AdminStatus {
  enabled: boolean;
  authenticated: boolean;
  storage: StorageStatus;
  user?: string;
}

export interface LivePlayer {
  sessionId: string;
  pid: string;
  name: string;
  char: number;
  ip: string;
  geo: GeoInfo;
  client: ClientInfo;
  roomId: string;
  roomName: string;
  map: string;
  mode: string;
  phase: string;
  team: number;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  /** Totals for the whole session so far (all matches). */
  session: { kills: number; deaths: number; assists: number; shots: number; hits: number; headshots: number };
  ping: number;
  connected: boolean;
  alive: boolean;
  joinedAt: number;
}

export interface LiveRoom {
  roomId: string;
  roomName: string;
  map: string;
  mode: string;
  phase: string;
  queue: string;
  format: string;
  privateRoom: boolean;
  humans: number;
  bots: number;
  maxPlayers: number;
  team1: number;
  team2: number;
  scoreLimit: number;
  phaseEndsAt: number;
  matchStartedAt: number | null;
  createdAt: number;
}

export interface LiveSnapshot {
  now: number;
  players: LivePlayer[];
  rooms: LiveRoom[];
  storage: StorageStatus;
  /** Most humans online at once since the game server started. */
  peakSinceStart: { players: number; at: number };
  serverStartedAt: number;
}

export interface WindowStats {
  sessions: number;
  players: number;
  newPlayers: number;
  playTimeMs: number;
  avgSessionMs: number;
  matches: number;
  kills: number;
}

export interface PeakStat { players: number; at: string | null }

export interface OverviewStats {
  totalPlayers: number;
  totalSessions: number;
  totalMatches: number;
  today: WindowStats;
  d7: WindowStats;
  d30: WindowStats;
  peak: { today: PeakStat; d7: PeakStat; d30: PeakStat };
  /** Last 14 days of daily active players, oldest first. */
  dau: { day: string; players: number }[];
}

export interface DailyRow { day: string; players: number; sessions: number; playTimeMs: number; newPlayers: number; matches: number }
export interface CountRow { key: string; label: string; players: number; sessions: number }
export interface MapRow { key: string; sessions: number; playTimeMs: number; matches: number }
export interface WeaponRow { weapon: string; kills: number; headshots: number; deaths: number; avgDistance: number | null }

export interface AnalyticsSeries {
  days: number;
  tz: string;
  daily: DailyRow[];
  countries: CountRow[];
  devices: CountRow[];
  browsers: CountRow[];
  os: CountRow[];
  maps: MapRow[];
  modes: MapRow[];
  weapons: WeaponRow[];
  /** [dayOfWeek 0=Sunday][hour 0..23] session starts in `tz`. */
  heatmap: number[][];
}

export interface Page<T> { items: T[]; total: number; page: number; size: number }

export type PlayerSort = "lastSeen" | "firstSeen" | "sessions" | "playTimeMs" | "kills" | "kd" | "score";

export interface PlayerMatchRow {
  matchId: string;
  map: string;
  mode: string;
  endedAt: Date;
  durationMs: number;
  endReason: MatchDoc["endReason"];
  team: number;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  won: boolean;
  left: boolean;
  place: number;
  players: number;
}

export interface PlayerWeaponRow { weapon: string; kills: number; headshots: number; deaths: number; avgDistance: number | null }
export interface RivalRow { name: string; pid: string | null; bot: boolean; count: number }

export interface PlayerDetail {
  player: PlayerDoc;
  sessions: SessionDoc[];
  matches: PlayerMatchRow[];
  weapons: PlayerWeaponRow[];
  /** Who this player kills the most / who kills this player the most. */
  victims: RivalRow[];
  nemeses: RivalRow[];
}

export interface MatchDetail {
  match: MatchDoc;
  kills: KillDoc[];
}

/** Regional-indicator flag for an ISO country code ("" for unknown / LAN). */
export function flagEmoji(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return "";
  return String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function emptyTotals(): CombatTotals {
  return { kills: 0, deaths: 0, assists: 0, score: 0, headshots: 0, shots: 0, hits: 0, damageDealt: 0, damageTaken: 0, grenadeKills: 0, matches: 0, wins: 0 };
}

export const LOCAL_GEO: GeoInfo = { country: "LAN", countryName: "Local network", region: "", city: "", lat: null, lon: null, timezone: "" };
export const UNKNOWN_GEO: GeoInfo = { country: "", countryName: "Unknown", region: "", city: "", lat: null, lon: null, timezone: "" };
