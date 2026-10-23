import type {
  AnalyticsSeries, ConcurrencySample, CountRow, DailyRow, KillDoc, MapRow, MatchDoc, OverviewStats, Page, PeakStat,
  PlayerDetail, PlayerDoc, PlayerMatchRow, PlayerSort, PlayerWeaponRow, RivalRow, SessionDoc, WeaponRow, WindowStats,
} from "../../game/shared/adminApi";
import { dayKey, dayKeys, startOfDay, weekHour } from "./stats";

/** Plain-JS implementations of every admin query: the in-memory store's engine and the Mongo store's reference. */

export interface PlayerQuery { q?: string; sort?: PlayerSort; dir?: 1 | -1; page?: number; size?: number }
export interface MatchQuery { page?: number; size?: number; map?: string; mode?: string; pid?: string }

export const DAY = 86_400_000;

export function windowStarts(now: number, tz: string) {
  return { today: startOfDay(now, tz), d7: now - 7 * DAY, d30: now - 30 * DAY };
}

export function windowStats(sessions: SessionDoc[], players: PlayerDoc[], matches: MatchDoc[], since: number): WindowStats {
  const s = sessions.filter((x) => +x.joinedAt >= since);
  const play = s.reduce((a, x) => a + x.durationMs, 0);
  return {
    sessions: s.length,
    players: new Set(s.map((x) => x.pid)).size,
    newPlayers: players.filter((p) => +p.firstSeen >= since).length,
    playTimeMs: play,
    avgSessionMs: s.length ? Math.round(play / s.length) : 0,
    matches: matches.filter((m) => +m.endedAt >= since).length,
    kills: s.reduce((a, x) => a + x.kills, 0),
  };
}

export function peak(samples: ConcurrencySample[], since: number): PeakStat {
  let best: ConcurrencySample | null = null;
  for (const x of samples) if (+x.at >= since && (!best || x.players > best.players)) best = x;
  return { players: best?.players ?? 0, at: best ? best.at.toISOString() : null };
}

export function computeOverview(sessions: SessionDoc[], players: PlayerDoc[], matches: MatchDoc[], samples: ConcurrencySample[], now: number, tz: string): OverviewStats {
  const w = windowStarts(now, tz);
  const keys = dayKeys(now, 14, tz);
  const since = startOfDay(now - 13 * DAY, tz);
  const perDay = new Map<string, Set<string>>();
  for (const s of sessions) {
    if (+s.joinedAt < since) continue;
    const k = dayKey(s.joinedAt, tz);
    if (!perDay.has(k)) perDay.set(k, new Set());
    perDay.get(k)!.add(s.pid);
  }
  return {
    totalPlayers: players.length,
    totalSessions: sessions.length,
    totalMatches: matches.length,
    today: windowStats(sessions, players, matches, w.today),
    d7: windowStats(sessions, players, matches, w.d7),
    d30: windowStats(sessions, players, matches, w.d30),
    peak: { today: peak(samples, w.today), d7: peak(samples, w.d7), d30: peak(samples, w.d30) },
    dau: keys.map((day) => ({ day, players: perDay.get(day)?.size ?? 0 })),
  };
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function clampPage(page: unknown, size: unknown, maxSize = 100) {
  const sz = Math.max(1, Math.min(maxSize, Math.floor(Number(size)) || 25));
  const pg = Math.max(1, Math.min(10_000, Math.floor(Number(page)) || 1));
  return { page: pg, size: sz, skip: (pg - 1) * sz };
}

export const PLAYER_SORTS: PlayerSort[] = ["lastSeen", "firstSeen", "sessions", "playTimeMs", "kills", "kd", "score"];

export function playerSortValue(p: PlayerDoc, sort: PlayerSort): number {
  if (sort === "kd") return p.deaths > 0 ? p.kills / p.deaths : p.kills;
  if (sort === "lastSeen" || sort === "firstSeen") return +p[sort];
  return p[sort];
}

export function matchesPlayerSearch(p: PlayerDoc, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return p._id.toLowerCase().startsWith(needle) || p.names.some((n) => n.toLowerCase().includes(needle)) ||
    p.ips.some((ip) => ip.startsWith(needle)) || p.locations.some((l) => l.toLowerCase().includes(needle));
}

export function queryPlayers(players: PlayerDoc[], q: PlayerQuery): Page<PlayerDoc> {
  const { page, size, skip } = clampPage(q.page, q.size);
  const sort = q.sort && PLAYER_SORTS.includes(q.sort) ? q.sort : "lastSeen";
  const dir = q.dir === 1 ? 1 : -1;
  const hits = players.filter((p) => matchesPlayerSearch(p, q.q ?? ""))
    .sort((a, b) => (playerSortValue(a, sort) - playerSortValue(b, sort)) * dir || a._id.localeCompare(b._id));
  return { items: hits.slice(skip, skip + size), total: hits.length, page, size };
}

export function queryMatches(matches: MatchDoc[], q: MatchQuery): Page<MatchDoc> {
  const { page, size, skip } = clampPage(q.page, q.size);
  const hits = matches.filter((m) => (!q.map || m.map === q.map) && (!q.mode || m.mode === q.mode) &&
    (!q.pid || m.participants.some((p) => p.pid === q.pid)))
    .sort((a, b) => +b.endedAt - +a.endedAt);
  return { items: hits.slice(skip, skip + size), total: hits.length, page, size };
}

export function playerMatchRow(m: MatchDoc, pid: string): PlayerMatchRow | null {
  const me = m.participants.find((p) => p.pid === pid);
  if (!me) return null;
  const ranked = [...m.participants].sort((a, b) => b.score - a.score || b.kills - a.kills);
  return {
    matchId: m._id, map: m.map, mode: m.mode, endedAt: m.endedAt, durationMs: m.durationMs, endReason: m.endReason,
    team: me.team, kills: me.kills, deaths: me.deaths, assists: me.assists, score: me.score, won: me.won, left: me.left,
    place: ranked.indexOf(me) + 1, players: m.participants.length,
  };
}

export function weaponBreakdown(kills: KillDoc[], pid: string): PlayerWeaponRow[] {
  const rows = new Map<string, PlayerWeaponRow & { dist: number; distN: number }>();
  const row = (w: string) => {
    if (!rows.has(w)) rows.set(w, { weapon: w, kills: 0, headshots: 0, deaths: 0, avgDistance: null, dist: 0, distN: 0 });
    return rows.get(w)!;
  };
  for (const k of kills) {
    if (k.killerPid === pid && k.victimPid !== pid) {
      const r = row(k.weapon);
      r.kills++;
      if (k.headshot) r.headshots++;
      if (k.distance != null) { r.dist += k.distance; r.distN++; }
    }
    if (k.victimPid === pid) row(k.weapon).deaths++;
  }
  return [...rows.values()]
    .map(({ dist, distN, ...r }) => ({ ...r, avgDistance: distN ? Math.round((dist / distN) * 10) / 10 : null }))
    .sort((a, b) => b.kills - a.kills || b.deaths - a.deaths || a.weapon.localeCompare(b.weapon));
}

export function rivals(kills: KillDoc[], pid: string, side: "victims" | "nemeses", limit = 5): RivalRow[] {
  const rows = new Map<string, RivalRow>();
  for (const k of kills) {
    const mine = side === "victims" ? k.killerPid === pid && k.victimPid !== pid : k.victimPid === pid && k.killerPid !== pid;
    if (!mine) continue;
    const other = side === "victims"
      ? { name: k.victimName, pid: k.victimPid, bot: k.victimBot }
      : { name: k.killerName, pid: k.killerPid, bot: k.killerBot };
    if (!other.name) continue;
    const key = other.pid ?? `name:${other.name}`;
    const r = rows.get(key) ?? { ...other, count: 0 };
    r.count++;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit);
}

export function playerDetail(player: PlayerDoc, sessions: SessionDoc[], matches: MatchDoc[], kills: KillDoc[]): PlayerDetail {
  const pid = player._id;
  return {
    player,
    sessions: sessions.filter((s) => s.pid === pid).sort((a, b) => +b.joinedAt - +a.joinedAt).slice(0, 200),
    matches: matches.filter((m) => m.participants.some((p) => p.pid === pid)).sort((a, b) => +b.endedAt - +a.endedAt)
      .slice(0, 50).map((m) => playerMatchRow(m, pid)!),
    weapons: weaponBreakdown(kills, pid),
    victims: rivals(kills, pid, "victims"),
    nemeses: rivals(kills, pid, "nemeses"),
  };
}

function countRows(sessions: SessionDoc[], key: (s: SessionDoc) => [string, string]): CountRow[] {
  const rows = new Map<string, { label: string; pids: Set<string>; sessions: number }>();
  for (const s of sessions) {
    const [k, label] = key(s);
    const r = rows.get(k) ?? { label, pids: new Set<string>(), sessions: 0 };
    r.pids.add(s.pid); r.sessions++;
    rows.set(k, r);
  }
  return [...rows].map(([k, r]) => ({ key: k, label: r.label, players: r.pids.size, sessions: r.sessions }))
    .sort((a, b) => b.players - a.players || b.sessions - a.sessions);
}

function mapRows(sessions: SessionDoc[], matches: MatchDoc[], key: "map" | "mode"): MapRow[] {
  const rows = new Map<string, MapRow>();
  const row = (k: string) => rows.get(k) ?? rows.set(k, { key: k, sessions: 0, playTimeMs: 0, matches: 0 }).get(k)!;
  for (const s of sessions) { const r = row(s[key]); r.sessions++; r.playTimeMs += s.durationMs; }
  for (const m of matches) row(m[key]).matches++;
  return [...rows.values()].sort((a, b) => b.playTimeMs - a.playTimeMs || b.matches - a.matches);
}

export function weaponRows(kills: KillDoc[]): WeaponRow[] {
  const rows = new Map<string, WeaponRow & { dist: number; distN: number }>();
  for (const k of kills) {
    const r = rows.get(k.weapon) ?? { weapon: k.weapon, kills: 0, headshots: 0, deaths: 0, avgDistance: null, dist: 0, distN: 0 };
    if (!k.killerBot && k.killerPid !== k.victimPid) {
      r.kills++;
      if (k.headshot) r.headshots++;
      if (k.distance != null) { r.dist += k.distance; r.distN++; }
    }
    if (!k.victimBot) r.deaths++;
    rows.set(k.weapon, r);
  }
  return [...rows.values()]
    .map(({ dist, distN, ...r }) => ({ ...r, avgDistance: distN ? Math.round((dist / distN) * 10) / 10 : null }))
    .sort((a, b) => b.kills - a.kills || b.deaths - a.deaths || a.weapon.localeCompare(b.weapon));
}

export function emptyHeatmap(): number[][] {
  return Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
}

export function computeAnalytics(sessions: SessionDoc[], players: PlayerDoc[], matches: MatchDoc[], kills: KillDoc[], now: number, days: number, tz: string): AnalyticsSeries {
  const since = startOfDay(now - (days - 1) * DAY, tz);
  const s = sessions.filter((x) => +x.joinedAt >= since);
  const m = matches.filter((x) => +x.endedAt >= since);
  const k = kills.filter((x) => +x.at >= since);
  const daily = new Map<string, DailyRow & { pids: Set<string> }>(
    dayKeys(now, days, tz).map((day) => [day, { day, players: 0, sessions: 0, playTimeMs: 0, newPlayers: 0, matches: 0, pids: new Set<string>() }]),
  );
  for (const x of s) {
    const r = daily.get(dayKey(x.joinedAt, tz));
    if (r) { r.sessions++; r.playTimeMs += x.durationMs; r.pids.add(x.pid); }
  }
  for (const p of players) if (+p.firstSeen >= since) { const r = daily.get(dayKey(p.firstSeen, tz)); if (r) r.newPlayers++; }
  for (const x of m) { const r = daily.get(dayKey(x.endedAt, tz)); if (r) r.matches++; }
  const heatmap = emptyHeatmap();
  for (const x of s) { const [d, h] = weekHour(x.joinedAt, tz); if (d >= 0) heatmap[d][h]++; }
  return {
    days, tz,
    daily: [...daily.values()].map(({ pids, ...r }) => ({ ...r, players: pids.size })),
    countries: countRows(s, (x) => [x.geo.country || "??", x.geo.countryName || "Unknown"]),
    devices: countRows(s, (x) => [x.client.device, x.client.device]),
    browsers: countRows(s, (x) => [x.client.browser, x.client.browser]),
    os: countRows(s, (x) => [x.client.os, x.client.os]),
    maps: mapRows(s, m, "map"),
    modes: mapRows(s, m, "mode"),
    weapons: weaponRows(k),
    heatmap,
  };
}
