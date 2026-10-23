import { emptyTotals, type ClientInfo, type CombatTotals, type GeoInfo, type PlayerDoc, type SessionDoc } from "../../game/shared/adminApi";
import { geoLabel } from "./geo";

/** Running per-session counters; everything a session document needs beyond its metadata. */
export class SessionStats implements CombatTotals {
  kills = 0; deaths = 0; assists = 0; score = 0; headshots = 0; shots = 0; hits = 0;
  damageDealt = 0; damageTaken = 0; grenadeKills = 0; matches = 0; wins = 0;
  bestStreak = 0;
  weapons: Record<string, number> = {};
  private pingSum = 0; private pingN = 0; private pingMin = Infinity; private pingMax = 0;

  shot(hit: boolean) { this.shots++; if (hit) this.hits++; }

  kill(weapon: string, headshot: boolean, streak: number) {
    this.kills++;
    if (headshot) this.headshots++;
    if (weapon === "grenade") this.grenadeKills++;
    if (/^[a-z0-9_]{1,16}$/.test(weapon)) this.weapons[weapon] = (this.weapons[weapon] ?? 0) + 1;
    this.bestStreak = Math.max(this.bestStreak, streak);
  }

  ping(ms: number) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 5000) return;
    this.pingSum += ms; this.pingN++;
    this.pingMin = Math.min(this.pingMin, ms); this.pingMax = Math.max(this.pingMax, ms);
  }

  pingStats(): SessionDoc["ping"] {
    if (!this.pingN) return null;
    return { avg: Math.round(this.pingSum / this.pingN), min: Math.round(this.pingMin), max: Math.round(this.pingMax), samples: this.pingN };
  }
}

/** Score / assists only change at eliminations: the recorder reads them as deltas of the replicated state. */
export class Counter {
  private last = 0;
  /** Returns how much `value` grew since the last read; a reset (new match) just moves the baseline. */
  delta(value: number): number {
    const d = value > this.last ? value - this.last : 0;
    this.last = value;
    return d;
  }
}

export function kdRatio(kills: number, deaths: number) {
  return Math.round((deaths > 0 ? kills / deaths : kills) * 100) / 100;
}

export function accuracy(shots: number, hits: number) {
  return shots > 0 ? Math.round((hits / shots) * 1000) / 1000 : 0;
}

export function favoriteWeapon(weapons: Record<string, number>): string {
  let best = "", n = 0;
  for (const [w, c] of Object.entries(weapons)) if (c > n || (c === n && w < best)) { best = w; n = c; }
  return best;
}

export interface SessionMeta {
  id: string;
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
  joinedAt: number;
}

export function finalizeSession(meta: SessionMeta, s: SessionStats, leftAt: number): SessionDoc {
  return {
    _id: meta.id, pid: meta.pid, name: meta.name, char: meta.char, sessionId: meta.sessionId,
    ip: meta.ip, ua: meta.ua, client: meta.client, geo: meta.geo,
    roomId: meta.roomId, roomName: meta.roomName, map: meta.map, mode: meta.mode, queue: meta.queue, team: meta.team,
    joinedAt: new Date(meta.joinedAt), leftAt: new Date(leftAt), durationMs: Math.max(0, leftAt - meta.joinedAt),
    ping: s.pingStats(),
    kills: s.kills, deaths: s.deaths, assists: s.assists, score: s.score, headshots: s.headshots,
    shots: s.shots, hits: s.hits, damageDealt: Math.round(s.damageDealt), damageTaken: Math.round(s.damageTaken),
    grenadeKills: s.grenadeKills, matches: s.matches, wins: s.wins,
    weapons: { ...s.weapons }, favoriteWeapon: favoriteWeapon(s.weapons), bestStreak: s.bestStreak,
    accuracy: accuracy(s.shots, s.hits), kd: kdRatio(s.kills, s.deaths),
  };
}

const TOTAL_KEYS = Object.keys(emptyTotals()) as (keyof CombatTotals)[];

/** Folds a finished session into its player's lifetime record (the in-memory twin of the Mongo upsert). */
export function applySessionToPlayer(prev: PlayerDoc | undefined, s: SessionDoc): PlayerDoc {
  const p: PlayerDoc = prev ? structuredClone(prev) : {
    _id: s.pid, firstSeen: s.joinedAt, lastSeen: s.leftAt, lastName: s.name, names: [], sessions: 0, playTimeMs: 0,
    ...emptyTotals(), weapons: {}, bestStreak: 0, lastIp: s.ip, ips: [], lastGeo: s.geo, countries: [], locations: [],
    lastClient: s.client, devices: [], lastMap: s.map, lastMode: s.mode,
  };
  if (s.joinedAt < p.firstSeen) p.firstSeen = s.joinedAt;
  if (s.leftAt >= p.lastSeen) {
    p.lastSeen = s.leftAt;
    Object.assign(p, { lastName: s.name, lastIp: s.ip, lastGeo: s.geo, lastClient: s.client, lastMap: s.map, lastMode: s.mode });
  }
  p.sessions++;
  p.playTimeMs += s.durationMs;
  for (const k of TOTAL_KEYS) p[k] += s[k];
  for (const [w, n] of Object.entries(s.weapons)) p.weapons[w] = (p.weapons[w] ?? 0) + n;
  p.bestStreak = Math.max(p.bestStreak, s.bestStreak);
  const add = (list: string[], v: string) => { if (v && !list.includes(v)) list.push(v); };
  add(p.names, s.name);
  add(p.ips, s.ip);
  add(p.countries, s.geo.country);
  add(p.locations, geoLabel(s.geo));
  add(p.devices, deviceLabel(s.client));
  return p;
}

export function deviceLabel(c: ClientInfo): string {
  return `${c.device} · ${c.os} · ${c.browser}`;
}

// ----- time zones -----

export function safeTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();
function parts(t: number, tz: string) {
  let f = partFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    partFormatters.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(t))) o[p.type] = p.value;
  return o;
}

/** "YYYY-MM-DD" of `t` in `tz`. */
export function dayKey(t: number | Date, tz: string): string {
  const o = parts(+t, tz);
  return `${o.year}-${o.month}-${o.day}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Day of week (0 = Sunday) and hour of `t` in `tz`. */
export function weekHour(t: number | Date, tz: string): [number, number] {
  const o = parts(+t, tz);
  return [WEEKDAYS.indexOf(o.weekday), Number(o.hour) % 24];
}

/** UTC instant of local midnight for the day containing `t` in `tz` (exact except across a DST jump at midnight). */
export function startOfDay(t: number, tz: string): number {
  const o = parts(t, tz);
  const asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second);
  const offset = asUtc - Math.floor(t / 1000) * 1000;
  return Date.UTC(+o.year, +o.month - 1, +o.day) - offset;
}

/** The last `days` day keys ending today in `tz`, oldest first. */
export function dayKeys(now: number, days: number, tz: string): string[] {
  const keys: string[] = [];
  const today = startOfDay(now, tz);
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(today - i * 86_400_000 + 12 * 3_600_000, tz));
  return [...new Set(keys)];
}
