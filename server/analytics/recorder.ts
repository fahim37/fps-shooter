import { createHash, randomUUID } from "node:crypto";
import {
  LOCAL_GEO, UNKNOWN_GEO, type ClientInfo, type GeoInfo, type LivePlayer, type LiveRoom, type LiveSnapshot, type MatchDoc, type MatchParticipant,
} from "../../game/shared/adminApi";
import { clientIp, header, isPrivateIp, type HeaderSource } from "./ip";
import { parseUserAgent } from "./ua";
import { lookupGeo } from "./geo";
import { Counter, SessionStats, finalizeSession, type SessionMeta } from "./stats";
import { WriteQueue } from "./writer";
import type { AnalyticsStore } from "./store";

/** What the recorder reads from a match room: a structural subset of MatchRoom. */
export interface RecordablePlayer {
  id: string;
  bot?: unknown;
  st: {
    name: string; char: number; team: number; kills: number; deaths: number; assists: number; score: number;
    streak: number; ping: number; connected: boolean; alive: boolean;
  };
}
export interface RecordableRoom {
  roomId: string;
  map: { id: string };
  players: Map<string, RecordablePlayer>;
  state: {
    roomName: string; mode: string; phase: string; queue: string; format: string; privateRoom: boolean; maxPlayers: number;
    team1: number; team2: number; scoreLimit: number; phaseEndsAt: number; winner: string;
  };
}

/** Request details captured in onAuth (the only hook that sees the HTTP upgrade). */
export interface ConnectionInfo { ip: string; ua: string }

export function connectionInfo(context: { ip?: string; headers?: HeaderSource } | undefined): ConnectionInfo {
  return { ip: clientIp(context?.headers, context?.ip), ua: header(context?.headers, "user-agent").slice(0, 512) };
}

const PID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** The client's persistent id, or a stable stand-in derived from its address and browser. */
export function sanitizePlayerId(raw: unknown, conn: ConnectionInfo): string {
  if (typeof raw === "string" && PID_RE.test(raw)) return raw;
  return `anon-${createHash("sha256").update(`${conn.ip}|${conn.ua}`).digest("hex").slice(0, 20)}`;
}

interface LiveSession {
  meta: SessionMeta;
  stats: SessionStats;
  score: Counter;
  assists: Counter;
  /** Resolves once the location lookup has filled in `meta.geo`. */
  geo: Promise<unknown>;
}

interface MatchRun { id: string; startedAt: number; liveEndsAt: number; left: MatchParticipant[] }

const now = () => Date.now();

/** Records one room: sessions of its humans, its matches and eliminations. All methods are cheap and synchronous. */
export class RoomRecorder {
  readonly sessions = new Map<string, LiveSession>();
  readonly createdAt = now();
  private match: MatchRun | null = null;

  constructor(private analytics: Analytics, readonly room: RecordableRoom) {}

  private human(p: RecordablePlayer | null | undefined) {
    return p && !p.bot ? this.sessions.get(p.id) : undefined;
  }

  join(p: RecordablePlayer, pid: unknown, conn: ConnectionInfo | undefined) {
    const c = conn ?? { ip: "", ua: "" };
    const client: ClientInfo = parseUserAgent(c.ua);
    const meta: SessionMeta = {
      id: randomUUID(), pid: sanitizePlayerId(pid, c), name: p.st.name, char: p.st.char, sessionId: p.id,
      ip: c.ip, ua: c.ua, client, geo: isPrivateIp(c.ip) ? LOCAL_GEO : UNKNOWN_GEO,
      roomId: this.room.roomId, roomName: this.room.state.roomName, map: this.room.map.id, mode: this.room.state.mode,
      queue: this.room.state.queue, team: p.st.team, joinedAt: now(),
    };
    const geo = isPrivateIp(c.ip) ? Promise.resolve() : lookupGeo(c.ip).then((g: GeoInfo) => { meta.geo = g; }, () => {});
    const live: LiveSession = { meta, stats: new SessionStats(), score: new Counter(), assists: new Counter(), geo };
    live.score.delta(p.st.score); live.assists.delta(p.st.assists);
    this.sessions.set(p.id, live);
    this.analytics.noteOnline();
  }

  leave(id: string) {
    const live = this.sessions.get(id);
    const p = this.room.players.get(id);
    if (!live) return;
    if (p) {
      this.observe(p, live);
      live.meta.team = p.st.team;
      live.meta.name = p.st.name;
      if (this.match && this.room.state.phase === "live") this.match.left.push(this.participant(p, true));
    }
    live.meta.map = this.room.map.id;
    this.sessions.delete(id);
    // The last human leaving ends the match: record it now, while its bots are still in the room.
    if (this.match && this.sessions.size === 0 && this.room.state.phase === "live") this.finishMatch("abandoned");
    const doc = finalizeSession(live.meta, live.stats, now());
    // A very short visit can end before the first (lazy) geo database load finishes.
    this.analytics.track(live.geo.then(() => {
      doc.geo = live.meta.geo;
      this.analytics.queue.push({ kind: "session", doc });
    }));
  }

  shot(p: RecordablePlayer, hit: boolean) { this.human(p)?.stats.shot(hit); }

  ping(p: RecordablePlayer, rtt: number) { this.human(p)?.stats.ping(rtt); }

  damage(attacker: RecordablePlayer | null, target: RecordablePlayer, amount: number) {
    if (!(amount > 0)) return;
    if (attacker && attacker !== target) { const a = this.human(attacker); if (a) a.stats.damageDealt += amount; }
    const t = this.human(target);
    if (t) t.stats.damageTaken += amount;
  }

  kill(killer: RecordablePlayer | null, victim: RecordablePlayer, weapon: string, headshot: boolean, distance: number | undefined) {
    const v = this.human(victim);
    if (v) v.stats.deaths++;
    const k = killer && killer !== victim ? this.human(killer) : undefined;
    if (k) k.stats.kill(weapon, headshot, killer!.st.streak);
    this.observeAll();
    if (!v && !(killer && this.human(killer))) return;
    const self = !killer || killer === victim;
    this.analytics.queue.push({ kind: "kill", doc: {
      at: new Date(), matchId: this.room.state.phase === "live" ? this.match?.id ?? null : null,
      roomId: this.room.roomId, map: this.room.map.id, mode: this.room.state.mode, weapon, headshot,
      distance: distance != null && Number.isFinite(distance) ? Math.round(distance * 10) / 10 : null,
      killerPid: self ? v?.meta.pid ?? null : k?.meta.pid ?? null,
      killerName: self ? victim.st.name : killer!.st.name,
      killerBot: self ? !!victim.bot : !!killer!.bot,
      victimPid: v?.meta.pid ?? null, victimName: victim.st.name, victimBot: !!victim.bot,
    } });
  }

  phase(phase: string) {
    this.observeAll();
    const t = now();
    if (phase === "live") {
      this.match = { id: `${this.room.roomId}-${t.toString(36)}`, startedAt: t, liveEndsAt: this.room.state.phaseEndsAt, left: [] };
    } else if (phase === "ended" && this.match) {
      this.finishMatch(t < this.match.liveEndsAt - 1500 ? "score" : "time");
    } else if (this.match) {
      this.finishMatch("abandoned");
    }
  }

  dispose() {
    for (const id of [...this.sessions.keys()]) this.leave(id);
    if (this.match) this.finishMatch("abandoned");
    this.analytics.rooms.delete(this);
  }

  /** Score and assists change only at eliminations; read them as growth of the replicated values. */
  private observe(p: RecordablePlayer, live: LiveSession) {
    live.stats.score += live.score.delta(p.st.score);
    live.stats.assists += live.assists.delta(p.st.assists);
  }

  private observeAll() {
    for (const [id, live] of this.sessions) {
      const p = this.room.players.get(id);
      if (p) this.observe(p, live);
    }
  }

  private participant(p: RecordablePlayer, left: boolean): MatchParticipant {
    return {
      pid: this.human(p)?.meta.pid ?? null, sessionId: p.id, name: p.st.name, bot: !!p.bot, team: p.st.team,
      kills: p.st.kills, deaths: p.st.deaths, assists: p.st.assists, score: p.st.score, left, won: false,
    };
  }

  private finishMatch(endReason: MatchDoc["endReason"]) {
    const m = this.match!;
    this.match = null;
    const t = now();
    const st = this.room.state;
    const leftIds = new Set(m.left.map((p) => p.sessionId));
    const present = [...this.room.players.values()].filter((p) => !leftIds.has(p.id));
    const participants = [...present.map((p) => this.participant(p, false)), ...m.left];
    const humans = participants.filter((p) => !p.bot).length;
    if (!humans || (endReason === "abandoned" && t - m.startedAt < 30_000)) return;

    // Nobody wins a match everyone walked out of.
    let winner = endReason === "abandoned" ? "" : st.winner, winnerTeam = 0, winnerId = "";
    if (st.mode === "tdm") {
      winnerTeam = winner === "1" ? 1 : winner === "2" ? 2 : 0;
    } else {
      winnerId = winner;
      winner = participants.find((p) => p.sessionId === winnerId)?.name ?? "";
    }
    for (const p of participants) {
      p.won = st.mode === "tdm" ? winnerTeam !== 0 && p.team === winnerTeam : p.sessionId === winnerId;
      if (p.left) continue;
      const live = this.sessions.get(p.sessionId);
      if (live) { live.stats.matches++; if (p.won) live.stats.wins++; }
    }
    this.analytics.queue.push({ kind: "match", doc: {
      _id: m.id, roomId: this.room.roomId, roomName: st.roomName, map: this.room.map.id, mode: st.mode, queue: st.queue,
      format: st.format, scoreLimit: st.scoreLimit, startedAt: new Date(m.startedAt), endedAt: new Date(t),
      durationMs: t - m.startedAt, endReason, winner, team1: st.team1, team2: st.team2,
      humans, bots: participants.length - humans,
      participants: participants.sort((a, b) => b.score - a.score || b.kills - a.kills),
    } });
  }

  liveRoom(): LiveRoom {
    const st = this.room.state;
    let humans = 0, bots = 0;
    for (const p of this.room.players.values()) if (p.bot) bots++; else humans++;
    return {
      roomId: this.room.roomId, roomName: st.roomName, map: this.room.map.id, mode: st.mode, phase: st.phase, queue: st.queue,
      format: st.format, privateRoom: st.privateRoom, humans, bots, maxPlayers: st.maxPlayers, team1: st.team1, team2: st.team2,
      scoreLimit: st.scoreLimit, phaseEndsAt: st.phaseEndsAt, matchStartedAt: this.match?.startedAt ?? null, createdAt: this.createdAt,
    };
  }

  livePlayers(): LivePlayer[] {
    const out: LivePlayer[] = [];
    const st = this.room.state;
    for (const [id, live] of this.sessions) {
      const p = this.room.players.get(id);
      if (!p) continue;
      const s = live.stats;
      out.push({
        sessionId: id, pid: live.meta.pid, name: p.st.name, char: p.st.char, ip: live.meta.ip, geo: live.meta.geo, client: live.meta.client,
        roomId: this.room.roomId, roomName: st.roomName, map: this.room.map.id, mode: st.mode, phase: st.phase, team: p.st.team,
        kills: p.st.kills, deaths: p.st.deaths, assists: p.st.assists, score: p.st.score,
        session: { kills: s.kills, deaths: s.deaths, assists: s.assists, shots: s.shots, hits: s.hits, headshots: s.headshots },
        ping: p.st.ping, connected: p.st.connected, alive: p.st.alive, joinedAt: live.meta.joinedAt,
      });
    }
    return out;
  }
}

/** Process-wide recorder: owns the write queue and knows every live room. */
export class Analytics {
  queue = new WriteQueue(null);
  readonly rooms = new Set<RoomRecorder>();
  readonly startedAt = now();
  peak = { players: 0, at: now() };
  private sampler: ReturnType<typeof setInterval> | null = null;
  private inflight = new Set<Promise<unknown>>();

  /** Writes waiting on a location lookup; `settled()` waits for them. */
  track(p: Promise<unknown>) {
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  async settled() {
    await Promise.allSettled([...this.inflight]);
  }

  /** Starts persisting to `store`; without a call the recorder still tracks live data but writes nothing. */
  start(store: AnalyticsStore | null, opts?: ConstructorParameters<typeof WriteQueue>[1]) {
    this.queue = new WriteQueue(store, opts);
    this.queue.start();
    if (store && !this.sampler) {
      this.sampler = setInterval(() => this.sample(), 60_000);
      this.sampler.unref?.();
    }
  }

  async stop() {
    if (this.sampler) clearInterval(this.sampler);
    this.sampler = null;
    for (const r of [...this.rooms]) r.dispose();
    await this.settled();
    await this.queue.stop();
  }

  room(room: RecordableRoom): RoomRecorder {
    const r = new RoomRecorder(this, room);
    this.rooms.add(r);
    return r;
  }

  onlineCount() {
    let n = 0;
    for (const r of this.rooms) n += r.sessions.size;
    return n;
  }

  noteOnline() {
    const n = this.onlineCount();
    if (n > this.peak.players) this.peak = { players: n, at: now() };
  }

  sample() {
    let players = 0, bots = 0;
    for (const r of this.rooms) {
      players += r.sessions.size;
      for (const p of r.room.players.values()) if (p.bot) bots++;
    }
    this.queue.push({ kind: "sample", doc: { at: new Date(), players, bots, rooms: this.rooms.size } });
  }

  live(): LiveSnapshot {
    const rooms = [...this.rooms];
    return {
      now: now(),
      players: rooms.flatMap((r) => r.livePlayers()).sort((a, b) => a.joinedAt - b.joinedAt),
      rooms: rooms.map((r) => r.liveRoom()).sort((a, b) => b.humans - a.humans || a.createdAt - b.createdAt),
      storage: this.queue.status,
      peakSinceStart: this.peak,
      serverStartedAt: this.startedAt,
    };
  }
}

export const analytics = new Analytics();
