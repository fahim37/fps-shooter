import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics, type RecordablePlayer, type RecordableRoom } from "./recorder";
import { MemoryStore } from "./store";
import { WriteQueue } from "./writer";
import { applySessionToPlayer, finalizeSession, SessionStats } from "./stats";
import { computeAnalytics, computeOverview, queryPlayers } from "./queries";
import type { SessionDoc } from "../../game/shared/adminApi";

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function player(id: string, team: number, bot = false): RecordablePlayer {
  return {
    id, bot: bot ? {} : undefined,
    st: { name: id, char: 0, team, kills: 0, deaths: 0, assists: 0, score: 0, streak: 0, ping: 40, connected: true, alive: true },
  };
}

function room(): RecordableRoom {
  return {
    roomId: "ABCDE", map: { id: "village" }, players: new Map(),
    state: { roomName: "Test room", mode: "tdm", phase: "warmup", queue: "quick", format: "custom", privateRoom: false, maxPlayers: 8,
      team1: 0, team2: 0, scoreLimit: 30, phaseEndsAt: 0, winner: "" },
  };
}

/** What MatchRoom.damage does to the replicated state, plus the recorder hook. */
function eliminate(r: RecordableRoom, rec: ReturnType<Analytics["room"]>, killer: RecordablePlayer, victim: RecordablePlayer, weapon: string, head: boolean, helpers: RecordablePlayer[] = []) {
  rec.damage(killer, victim, 100);
  victim.st.deaths++;
  killer.st.kills++; killer.st.streak++; killer.st.score += head ? 150 : 100;
  for (const h of helpers) { h.st.assists++; h.st.score += 50; }
  if (r.state.mode === "tdm") { if (killer.st.team === 1) r.state.team1++; else r.state.team2++; }
  rec.kill(killer, victim, weapon, head, 25);
}

afterEach(() => vi.useRealTimers());

describe("session recording", () => {
  it("records a human's session, match and eliminations; bots appear only as opponents", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 23, 12) });
    const store = new MemoryStore();
    const a = new Analytics();
    a.queue = new WriteQueue(store);
    const r = room();
    const rec = a.room(r);
    const ann = player("Ann", 1), ben = player("Ben", 2), bot = player("Bot Hal", 2, true);
    for (const p of [ann, ben, bot]) r.players.set(p.id, p);
    rec.join(ann, "pid-ann-0001", { ip: "192.168.1.10", ua: PHONE });
    rec.join(ben, "pid-ben-0001", { ip: "10.0.0.7", ua: DESKTOP });

    // Warmup: counts for the session, not for the match.
    eliminate(r, rec, ann, bot, "ar", false);
    // Live: the room resets the scoreboard, then play.
    r.state.phase = "live"; r.state.phaseEndsAt = Date.now() + 600_000;
    for (const p of r.players.values()) Object.assign(p.st, { kills: 0, deaths: 0, assists: 0, score: 0, streak: 0 });
    r.state.team1 = r.state.team2 = 0;
    rec.phase("live");
    for (let i = 0; i < 4; i++) rec.shot(ann, i < 3);
    rec.ping(ann, 30); rec.ping(ann, 50);
    eliminate(r, rec, ann, ben, "sniper", true);
    eliminate(r, rec, ann, bot, "grenade", false);
    eliminate(r, rec, bot, ann, "smg", false, [ben]);
    vi.advanceTimersByTime(60_000);
    r.state.phase = "ended"; r.state.winner = "1";
    rec.phase("ended");
    rec.leave("Ann"); r.players.delete("Ann");
    rec.leave("Ben"); r.players.delete("Ben");
    await a.settled();
    await a.queue.tick();

    expect(store.sessions).toHaveLength(2);
    const s = store.sessions.find((x) => x.pid === "pid-ann-0001")!;
    expect(s).toMatchObject({
      name: "Ann", ip: "192.168.1.10", map: "village", mode: "tdm", roomId: "ABCDE", team: 1,
      kills: 3, deaths: 1, headshots: 1, grenadeKills: 1, shots: 4, hits: 3, accuracy: 0.75, kd: 3, damageDealt: 300, damageTaken: 100,
      score: 100 + 150 + 100, matches: 1, wins: 1, bestStreak: 2, weapons: { ar: 1, sniper: 1, grenade: 1 }, durationMs: 60_000,
      ping: { avg: 40, min: 30, max: 50, samples: 2 },
      client: { device: "mobile", os: "iOS", browser: "Safari" },
      geo: { country: "LAN", countryName: "Local network" },
    });
    expect(store.sessions.find((x) => x.pid === "pid-ben-0001")).toMatchObject({ kills: 0, deaths: 1, assists: 1, score: 50, wins: 0, matches: 1 });

    expect(store.matchDocs).toHaveLength(1);
    const m = store.matchDocs[0];
    expect(m).toMatchObject({ map: "village", mode: "tdm", winner: "1", endReason: "score", humans: 2, bots: 1, team1: 2, team2: 1, durationMs: 60_000 });
    expect(m.participants.map((p) => [p.name, p.bot, p.kills, p.won])).toEqual([["Ann", false, 2, true], ["Bot Hal", true, 1, false], ["Ben", false, 0, false]]);
    expect(m.participants[0].pid).toBe("pid-ann-0001");

    // Every elimination with a human in it; warmup kills carry no match id.
    expect(store.kills.map((k) => [k.weapon, k.killerName, k.victimName, !!k.matchId])).toEqual([
      ["ar", "Ann", "Bot Hal", false], ["sniper", "Ann", "Ben", true], ["grenade", "Ann", "Bot Hal", true], ["smg", "Bot Hal", "Ann", true],
    ]);
    expect(store.kills[3]).toMatchObject({ killerBot: true, killerPid: null, victimPid: "pid-ann-0001", distance: 25 });

    const p = store.playerDocs.get("pid-ann-0001")!;
    expect(p).toMatchObject({ sessions: 1, kills: 3, lastName: "Ann", names: ["Ann"], ips: ["192.168.1.10"], locations: ["Local network"], countries: ["LAN"] });
  });

  it("shows humans online right now with live details", () => {
    const a = new Analytics();
    const r = room();
    const rec = a.room(r);
    const ann = player("Ann", 1);
    r.players.set("Ann", ann);
    r.players.set("bot-1", player("Bot", 2, true));
    rec.join(ann, "pid-ann-0001", { ip: "127.0.0.1", ua: DESKTOP });
    ann.st.kills = 4;
    const live = a.live();
    expect(live.players).toHaveLength(1);
    expect(live.players[0]).toMatchObject({ name: "Ann", pid: "pid-ann-0001", ip: "127.0.0.1", kills: 4, roomId: "ABCDE", map: "village", ping: 40 });
    expect(live.rooms[0]).toMatchObject({ roomId: "ABCDE", humans: 1, bots: 1 });
    expect(live.storage).toBe("disabled");
    expect(live.peakSinceStart.players).toBe(1);
    rec.dispose();
    expect(a.live().rooms).toHaveLength(0);
  });

  it("records a match abandoned by everyone leaving, but not a short-lived one", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const store = new MemoryStore();
    const a = new Analytics();
    a.queue = new WriteQueue(store);
    for (const minutes of [5, 0.2]) {
      const r = room();
      r.state.mode = "ffa";
      const rec = a.room(r);
      const ann = player("Ann", 0);
      r.players.set("Ann", ann);
      r.players.set("bot-1", player("Bot", 0, true));
      rec.join(ann, "pid-ann-0001", { ip: "10.0.0.1", ua: DESKTOP });
      r.state.phase = "live";
      rec.phase("live");
      ann.st.kills = 2;
      vi.advanceTimersByTime(minutes * 60_000);
      rec.leave("Ann"); r.players.delete("Ann");
      rec.dispose();
    }
    await a.settled();
    await a.queue.tick();
    expect(store.matchDocs).toHaveLength(1);
    expect(store.matchDocs[0]).toMatchObject({ endReason: "abandoned", winner: "", humans: 1, bots: 1 });
    expect(store.matchDocs[0].participants[0]).toMatchObject({ name: "Ann", left: true, won: false, kills: 2 });
  });
});

describe("write queue", () => {
  const doc = (i: number) => ({ kind: "sample" as const, doc: { at: new Date(i), players: i, bots: 0, rooms: 0 } });

  it("keeps the game running when the database is down: bounded buffer, one warning, retries later", async () => {
    const store = new MemoryStore();
    store.failing = true;
    const log = { warn: vi.fn(), info: vi.fn() };
    const q = new WriteQueue(store, { maxQueue: 3, retryMs: 1000, log });
    for (let i = 0; i < 5; i++) q.push(doc(i));
    expect(q.pending).toBe(3);
    expect(q.dropped).toBe(2);
    await q.tick(0);
    await q.tick(500); // backing off: no attempt
    await q.tick(2000);
    expect(q.status).toBe("unavailable");
    expect(log.warn).toHaveBeenCalledTimes(1);

    store.failing = false;
    await q.tick(4000);
    expect(q.status).toBe("connected");
    expect(store.samples.map((s) => s.players)).toEqual([2, 3, 4]);
    expect(q.pending).toBe(0);
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it("puts a failed batch back in order", async () => {
    const store = new MemoryStore();
    const q = new WriteQueue(store, { retryMs: 0, log: { warn: vi.fn(), info: vi.fn() } });
    await q.tick(0);
    q.push(doc(1)); q.push(doc(2));
    store.failing = true;
    await q.tick(1);
    expect(q.pending).toBe(2);
    store.failing = false;
    await q.tick(2);
    expect(store.samples.map((s) => s.players)).toEqual([1, 2]);
  });

  it("does nothing without a store", () => {
    const q = new WriteQueue(null);
    q.push(doc(1));
    expect(q.pending).toBe(0);
    expect(q.status).toBe("disabled");
  });
});

describe("aggregation", () => {
  function session(pid: string, joinedAt: number, minutes: number, extra: Partial<SessionDoc> = {}): SessionDoc {
    const stats = new SessionStats();
    const s = finalizeSession({
      id: `${pid}-${joinedAt}`, pid, name: pid, char: 0, sessionId: "s", ip: "203.0.113.1", ua: "",
      client: { browser: "Chrome", browserVersion: "141.0", os: "Windows", device: "desktop" },
      geo: { country: "BD", countryName: "Bangladesh", region: "C", city: "Dhaka", lat: 23.7, lon: 90.4, timezone: "Asia/Dhaka" },
      roomId: "R", roomName: "R", map: "village", mode: "tdm", queue: "quick", team: 1, joinedAt,
    } as Parameters<typeof finalizeSession>[0], stats, joinedAt + minutes * 60_000);
    return { ...s, ...extra };
  }

  it("folds sessions into lifetime player records", () => {
    const a = session("p1", 1000, 10, { kills: 5, deaths: 2, weapons: { ar: 5 }, name: "First" });
    const b = session("p1", 5000, 20, { kills: 1, deaths: 1, weapons: { ar: 1, smg: 1 }, name: "Second", ip: "198.51.100.2" });
    const p = applySessionToPlayer(applySessionToPlayer(undefined, a), b);
    expect(p).toMatchObject({ sessions: 2, kills: 6, deaths: 3, playTimeMs: 30 * 60_000, weapons: { ar: 6, smg: 1 },
      names: ["First", "Second"], lastName: "Second", ips: ["203.0.113.1", "198.51.100.2"], lastIp: "198.51.100.2", locations: ["Dhaka, C, BD"] });
    expect(+p.firstSeen).toBe(1000);
    // Out-of-order writes keep the newest identity.
    const q = applySessionToPlayer(applySessionToPlayer(undefined, b), a);
    expect(q.lastName).toBe("Second");
    expect(+q.firstSeen).toBe(1000);
  });

  it("computes overview windows, daily series, breakdowns and the heatmap", () => {
    const now = Date.UTC(2026, 9, 23, 15);
    const H = 3_600_000, D = 24 * H;
    const sessions = [
      session("p1", now - 2 * H, 30),
      session("p1", now - 1 * H, 10),
      session("p2", now - 3 * D, 60, { client: { browser: "Safari", browserVersion: "18", os: "iOS", device: "mobile" } }),
      session("p3", now - 20 * D, 5, { geo: { country: "", countryName: "", region: "", city: "", lat: null, lon: null, timezone: "" } }),
    ];
    const players = [...sessions.reduce((m, s) => m.set(s.pid, applySessionToPlayer(m.get(s.pid), s)), new Map()).values()];
    const o = computeOverview(sessions, players, [], [{ at: new Date(now - H), players: 7, bots: 2, rooms: 1 }], now, "UTC");
    expect(o.today).toMatchObject({ sessions: 2, players: 1, newPlayers: 1, playTimeMs: 40 * 60_000, avgSessionMs: 20 * 60_000 });
    expect(o.d7).toMatchObject({ sessions: 3, players: 2 });
    expect(o.d30).toMatchObject({ sessions: 4, players: 3 });
    expect(o.peak.today.players).toBe(7);
    expect(o.dau.at(-1)).toEqual({ day: "2026-10-23", players: 1 });
    expect(o.dau).toHaveLength(14);

    const a = computeAnalytics(sessions, players, [], [], now, 7, "UTC");
    expect(a.daily).toHaveLength(7);
    expect(a.daily.at(-1)).toMatchObject({ day: "2026-10-23", players: 1, sessions: 2, newPlayers: 1 });
    expect(a.daily.find((d) => d.day === "2026-10-20")).toMatchObject({ players: 1, sessions: 1 });
    expect(a.devices.map((d) => [d.key, d.players])).toEqual([["desktop", 1], ["mobile", 1]]);
    expect(a.countries).toEqual([{ key: "BD", label: "Bangladesh", players: 2, sessions: 3 }]);
    expect(a.heatmap[5][13] + a.heatmap[5][14]).toBe(2); // Friday afternoon
  });

  it("searches, sorts and pages players", () => {
    const players = ["Alpha", "Bravo", "Charlie"].map((n, i) =>
      applySessionToPlayer(undefined, session(`pid-${n}`, 1000 * i, 1, { name: n, kills: i * 3, deaths: 3 - i, ip: `203.0.113.${i}` })));
    expect(queryPlayers(players, { q: "rav" }).items.map((p) => p.lastName)).toEqual(["Bravo"]);
    expect(queryPlayers(players, { q: "203.0.113.2" }).items.map((p) => p.lastName)).toEqual(["Charlie"]);
    expect(queryPlayers(players, { sort: "kd" }).items.map((p) => p.lastName)).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(queryPlayers(players, { sort: "lastSeen", dir: 1, size: 2, page: 2 })).toMatchObject({ total: 3, page: 2, size: 2 });
    expect(queryPlayers(players, { sort: "lastSeen", dir: 1, size: 2, page: 2 }).items.map((p) => p.lastName)).toEqual(["Charlie"]);
  });
});
