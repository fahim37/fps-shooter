import { MongoClient, MongoServerError, type Collection, type Db, type Document } from "mongodb";
import {
  emptyTotals, type AnalyticsSeries, type ConcurrencySample, type CountRow, type KillDoc, type MapRow, type MatchDetail, type MatchDoc,
  type OverviewStats, type Page, type PeakStat, type PlayerDetail, type PlayerDoc, type SessionDoc, type WeaponRow, type WindowStats,
} from "../../game/shared/adminApi";
import type { AnalyticsStore } from "./store";
import { deviceLabel, startOfDay, dayKeys } from "./stats";
import { geoLabel } from "./geo";
import {
  DAY, PLAYER_SORTS, clampPage, emptyHeatmap, escapeRegex, playerMatchRow, rivals, weaponBreakdown, windowStarts,
  type MatchQuery, type PlayerQuery,
} from "./queries";

const TOTAL_KEYS = Object.keys(emptyTotals());

/** Player documents written by older code may miss list fields; reads always see complete shapes. */
function normalizePlayer(p: PlayerDoc): PlayerDoc {
  return Object.assign(
    { ...emptyTotals(), weapons: {}, names: [], ips: [], countries: [], locations: [], devices: [], bestStreak: 0, sessions: 0, playTimeMs: 0 },
    p,
  );
}

export class MongoStore implements AnalyticsStore {
  readonly kind = "mongo" as const;
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(private uri: string, private retentionDays: number) {}

  private col<T extends Document>(name: string): Collection<T> {
    if (!this.db) throw new Error("not connected");
    return this.db.collection<T>(name);
  }
  private get sessionCol() { return this.col<SessionDoc>("sessions"); }
  private get playerCol() { return this.col<PlayerDoc>("players"); }
  private get matchCol() { return this.col<MatchDoc>("matches"); }
  private get killCol() { return this.col<KillDoc>("kills"); }
  private get sampleCol() { return this.col<ConcurrencySample>("concurrency"); }

  async connect() {
    await this.close();
    const client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000, appName: "hollowmere-game", maxPoolSize: 8 });
    try {
      await client.connect();
      const named = client.options.dbName;
      this.client = client;
      this.db = client.db(named && named !== "test" ? named : "hollowmere");
      await this.ensureIndexes();
    } catch (e) {
      this.client = null; this.db = null;
      await client.close().catch(() => {});
      throw e;
    }
  }

  async close() {
    const c = this.client;
    this.client = null; this.db = null;
    if (c) await c.close().catch(() => {});
  }

  /** A `{ field: 1 }` index that doubles as the retention TTL (or plain when retention is off). */
  private async timeIndex(col: Collection<Document>, field: string) {
    const ttl = this.retentionDays > 0 ? Math.round(this.retentionDays * 86_400) : null;
    const name = `${field}_1`;
    const existing = (await col.listIndexes().toArray().catch(() => [] as Document[])).find((i) => i.name === name);
    if (existing) {
      const current = existing.expireAfterSeconds as number | undefined;
      if ((current ?? null) === ttl) return;
      if (current != null && ttl != null) {
        await this.db!.command({ collMod: col.collectionName, index: { name, expireAfterSeconds: ttl } });
        return;
      }
      await col.dropIndex(name);
    }
    await col.createIndex({ [field]: 1 }, ttl != null ? { name, expireAfterSeconds: ttl } : { name });
  }

  private async ensureIndexes() {
    const db = this.db!;
    await this.timeIndex(db.collection("sessions"), "leftAt");
    await this.timeIndex(db.collection("players"), "lastSeen");
    await this.timeIndex(db.collection("matches"), "endedAt");
    await this.timeIndex(db.collection("kills"), "at");
    await this.timeIndex(db.collection("concurrency"), "at");
    await Promise.all([
      this.sessionCol.createIndex({ joinedAt: -1 }),
      this.sessionCol.createIndex({ pid: 1, joinedAt: -1 }),
      this.sessionCol.createIndex({ ip: 1 }),
      this.sessionCol.createIndex({ "geo.country": 1 }),
      this.sessionCol.createIndex({ roomId: 1 }),
      this.playerCol.createIndex({ firstSeen: -1 }),
      this.playerCol.createIndex({ names: 1 }),
      this.playerCol.createIndex({ ips: 1 }),
      this.playerCol.createIndex({ kills: -1 }),
      this.playerCol.createIndex({ playTimeMs: -1 }),
      this.playerCol.createIndex({ sessions: -1 }),
      this.playerCol.createIndex({ score: -1 }),
      this.matchCol.createIndex({ "participants.pid": 1, endedAt: -1 }),
      this.matchCol.createIndex({ map: 1, endedAt: -1 }),
      this.matchCol.createIndex({ mode: 1, endedAt: -1 }),
      this.killCol.createIndex({ matchId: 1, at: 1 }),
      this.killCol.createIndex({ killerPid: 1, at: -1 }),
      this.killCol.createIndex({ victimPid: 1, at: -1 }),
      this.killCol.createIndex({ weapon: 1, at: -1 }),
    ]);
  }

  // ---------------------------------------------------------------- writes

  async writeSessions(docs: SessionDoc[]) {
    for (const s of docs) {
      try {
        await this.sessionCol.insertOne(s);
      } catch (e) {
        // Already stored by an earlier attempt that failed later: do not count it twice.
        if (e instanceof MongoServerError && e.code === 11000) continue;
        throw e;
      }
      const inc: Record<string, number> = { sessions: 1, playTimeMs: s.durationMs };
      for (const k of TOTAL_KEYS) inc[k] = s[k as keyof SessionDoc] as number;
      for (const [w, n] of Object.entries(s.weapons)) if (/^[a-z0-9_]{1,16}$/.test(w)) inc[`weapons.${w}`] = n;
      const addToSet: Record<string, string> = {};
      const add = (k: string, v: string) => { if (v) addToSet[k] = v; };
      add("names", s.name); add("ips", s.ip); add("countries", s.geo.country); add("locations", geoLabel(s.geo)); add("devices", deviceLabel(s.client));
      await this.playerCol.updateOne({ _id: s.pid }, {
        $min: { firstSeen: s.joinedAt },
        $max: { lastSeen: s.leftAt, bestStreak: s.bestStreak },
        $inc: inc,
        $addToSet: addToSet,
      }, { upsert: true });
      // The latest identity only comes from the newest session (sessions can arrive out of order).
      await this.playerCol.updateOne({ _id: s.pid, lastSeen: s.leftAt }, {
        $set: { lastName: s.name, lastIp: s.ip, lastGeo: s.geo, lastClient: s.client, lastMap: s.map, lastMode: s.mode },
      });
    }
  }

  private async insertAll<T extends Document>(col: Collection<T>, docs: T[]) {
    if (!docs.length) return;
    try {
      await col.insertMany(docs as never[], { ordered: false });
    } catch (e) {
      // Retried batches may hit documents that already made it in.
      if (e instanceof MongoServerError && e.code === 11000) return;
      if ((e as { writeErrors?: { code: number }[] }).writeErrors?.every((w) => w.code === 11000)) return;
      throw e;
    }
  }

  async writeMatches(docs: MatchDoc[]) { await this.insertAll(this.matchCol, docs); }
  async writeKills(docs: KillDoc[]) { await this.insertAll(this.killCol, docs); }
  async writeSamples(docs: ConcurrencySample[]) { await this.insertAll(this.sampleCol, docs); }

  // ---------------------------------------------------------------- reads

  private async windowStats(since: number): Promise<WindowStats> {
    const from = new Date(since);
    const [agg, newPlayers, matches] = await Promise.all([
      this.sessionCol.aggregate<{ players: number; sessions: number; play: number; kills: number }>([
        { $match: { joinedAt: { $gte: from } } },
        { $group: { _id: "$pid", n: { $sum: 1 }, play: { $sum: "$durationMs" }, kills: { $sum: "$kills" } } },
        { $group: { _id: null, players: { $sum: 1 }, sessions: { $sum: "$n" }, play: { $sum: "$play" }, kills: { $sum: "$kills" } } },
      ]).toArray(),
      this.playerCol.countDocuments({ firstSeen: { $gte: from } }),
      this.matchCol.countDocuments({ endedAt: { $gte: from } }),
    ]);
    const a = agg[0] ?? { players: 0, sessions: 0, play: 0, kills: 0 };
    return { sessions: a.sessions, players: a.players, newPlayers, playTimeMs: a.play, avgSessionMs: a.sessions ? Math.round(a.play / a.sessions) : 0, matches, kills: a.kills };
  }

  private async peak(since: number): Promise<PeakStat> {
    const best = await this.sampleCol.find({ at: { $gte: new Date(since) } }).sort({ players: -1, at: -1 }).limit(1).next();
    return { players: best?.players ?? 0, at: best ? best.at.toISOString() : null };
  }

  async overview(now: number, tz: string): Promise<OverviewStats> {
    const w = windowStarts(now, tz);
    const since14 = new Date(startOfDay(now - 13 * DAY, tz));
    const [today, d7, d30, pToday, p7, p30, dauRows, totalPlayers, totalSessions, totalMatches] = await Promise.all([
      this.windowStats(w.today), this.windowStats(w.d7), this.windowStats(w.d30),
      this.peak(w.today), this.peak(w.d7), this.peak(w.d30),
      this.sessionCol.aggregate<{ _id: string; players: number }>([
        { $match: { joinedAt: { $gte: since14 } } },
        { $group: { _id: { d: { $dateToString: { format: "%Y-%m-%d", date: "$joinedAt", timezone: tz } }, p: "$pid" } } },
        { $group: { _id: "$_id.d", players: { $sum: 1 } } },
      ]).toArray(),
      this.playerCol.estimatedDocumentCount(), this.sessionCol.estimatedDocumentCount(), this.matchCol.estimatedDocumentCount(),
    ]);
    const dau = new Map(dauRows.map((r) => [r._id, r.players]));
    return {
      totalPlayers, totalSessions, totalMatches, today, d7, d30,
      peak: { today: pToday, d7: p7, d30: p30 },
      dau: dayKeys(now, 14, tz).map((day) => ({ day, players: dau.get(day) ?? 0 })),
    };
  }

  async players(q: PlayerQuery): Promise<Page<PlayerDoc>> {
    const { page, size, skip } = clampPage(q.page, q.size);
    const sort = q.sort && PLAYER_SORTS.includes(q.sort) ? q.sort : "lastSeen";
    const dir = q.dir === 1 ? 1 : -1;
    const text = (q.q ?? "").trim().slice(0, 64);
    const match: Document = {};
    if (text) {
      const contains = new RegExp(escapeRegex(text), "i");
      const prefix = new RegExp(`^${escapeRegex(text)}`, "i");
      match.$or = [{ _id: prefix }, { names: contains }, { ips: prefix }, { locations: contains }];
    }
    const pipeline: Document[] = [{ $match: match }];
    if (sort === "kd") pipeline.push({ $addFields: { kd: { $cond: [{ $gt: ["$deaths", 0] }, { $divide: ["$kills", "$deaths"] }, "$kills"] } } });
    pipeline.push(
      { $sort: { [sort]: dir, _id: 1 } },
      { $facet: { items: [{ $skip: skip }, { $limit: size }, { $project: { kd: 0 } }], total: [{ $count: "n" }] } },
    );
    const [r] = await this.playerCol.aggregate<{ items: PlayerDoc[]; total: { n: number }[] }>(pipeline, { allowDiskUse: true }).toArray();
    return { items: (r?.items ?? []).map(normalizePlayer), total: r?.total[0]?.n ?? 0, page, size };
  }

  async player(pid: string): Promise<PlayerDetail | null> {
    const found = await this.playerCol.findOne({ _id: pid });
    if (!found) return null;
    const player = normalizePlayer(found);
    const [sessions, matches, kills] = await Promise.all([
      this.sessionCol.find({ pid }).sort({ joinedAt: -1 }).limit(200).toArray(),
      this.matchCol.find({ "participants.pid": pid }).sort({ endedAt: -1 }).limit(50).toArray(),
      // Weapon and rival breakdowns come from this player's most recent eliminations.
      this.killCol.find({ $or: [{ killerPid: pid }, { victimPid: pid }] }, {
        projection: { _id: 0, weapon: 1, headshot: 1, distance: 1, killerPid: 1, killerName: 1, killerBot: 1, victimPid: 1, victimName: 1, victimBot: 1 },
      }).sort({ at: -1 }).limit(20_000).toArray() as Promise<KillDoc[]>,
    ]);
    return {
      player, sessions,
      matches: matches.map((m) => playerMatchRow(m, pid)).filter((r) => r !== null),
      weapons: weaponBreakdown(kills, pid),
      victims: rivals(kills, pid, "victims"),
      nemeses: rivals(kills, pid, "nemeses"),
    };
  }

  async matches(q: MatchQuery): Promise<Page<MatchDoc>> {
    const { page, size, skip } = clampPage(q.page, q.size);
    const filter: Document = {};
    if (q.map) filter.map = q.map;
    if (q.mode) filter.mode = q.mode;
    if (q.pid) filter["participants.pid"] = q.pid;
    const [items, total] = await Promise.all([
      this.matchCol.find(filter).sort({ endedAt: -1 }).skip(skip).limit(size).toArray(),
      this.matchCol.countDocuments(filter),
    ]);
    return { items, total, page, size };
  }

  async match(id: string): Promise<MatchDetail | null> {
    const match = await this.matchCol.findOne({ _id: id });
    if (!match) return null;
    const kills = await this.killCol.find({ matchId: id }, { projection: { _id: 0 } }).sort({ at: 1 }).limit(3000).toArray();
    return { match, kills };
  }

  async analytics(now: number, days: number, tz: string): Promise<AnalyticsSeries> {
    const since = new Date(startOfDay(now - (days - 1) * DAY, tz));
    const day = (field: string) => ({ $dateToString: { format: "%Y-%m-%d", date: field, timezone: tz } });
    const byPlayer = (key: string, label?: string): Document[] => [
      { $group: { _id: { k: key, p: "$pid" }, n: { $sum: 1 }, ...(label ? { label: { $first: label } } : {}) } },
      { $group: { _id: "$_id.k", players: { $sum: 1 }, sessions: { $sum: "$n" }, ...(label ? { label: { $first: "$label" } } : {}) } },
    ];
    type Facet = { _id: string; players: number; sessions: number; label?: string };
    type Usage = { _id: string; sessions: number; play: number };
    const human = { $and: [{ $eq: ["$killerBot", false] }, { $ne: ["$killerPid", "$victimPid"] }] };

    const [sessionFacets, newPlayerRows, matchFacets, weaponDocs] = await Promise.all([
      this.sessionCol.aggregate<{
        daily: { _id: string; players: number; sessions: number; play: number }[];
        countries: Facet[]; devices: Facet[]; browsers: Facet[]; os: Facet[];
        maps: Usage[]; modes: Usage[];
        heatmap: { _id: { d: number; h: number }; n: number }[];
      }>([
        { $match: { joinedAt: { $gte: since } } },
        { $facet: {
          daily: [
            { $group: { _id: { d: day("$joinedAt"), p: "$pid" }, n: { $sum: 1 }, play: { $sum: "$durationMs" } } },
            { $group: { _id: "$_id.d", players: { $sum: 1 }, sessions: { $sum: "$n" }, play: { $sum: "$play" } } },
          ],
          countries: byPlayer("$geo.country", "$geo.countryName"),
          devices: byPlayer("$client.device"),
          browsers: byPlayer("$client.browser"),
          os: byPlayer("$client.os"),
          maps: [{ $group: { _id: "$map", sessions: { $sum: 1 }, play: { $sum: "$durationMs" } } }],
          modes: [{ $group: { _id: "$mode", sessions: { $sum: 1 }, play: { $sum: "$durationMs" } } }],
          heatmap: [{ $group: { _id: { d: { $dayOfWeek: { date: "$joinedAt", timezone: tz } }, h: { $hour: { date: "$joinedAt", timezone: tz } } }, n: { $sum: 1 } } }],
        } },
      ], { allowDiskUse: true }).toArray(),
      this.playerCol.aggregate<{ _id: string; n: number }>([
        { $match: { firstSeen: { $gte: since } } },
        { $group: { _id: day("$firstSeen"), n: { $sum: 1 } } },
      ]).toArray(),
      this.matchCol.aggregate<{ daily: { _id: string; n: number }[]; maps: { _id: string; n: number }[]; modes: { _id: string; n: number }[] }>([
        { $match: { endedAt: { $gte: since } } },
        { $facet: {
          daily: [{ $group: { _id: day("$endedAt"), n: { $sum: 1 } } }],
          maps: [{ $group: { _id: "$map", n: { $sum: 1 } } }],
          modes: [{ $group: { _id: "$mode", n: { $sum: 1 } } }],
        } },
      ]).toArray(),
      this.killCol.aggregate<{ _id: string; kills: number; headshots: number; dist: number; distN: number; deaths: number }>([
        { $match: { at: { $gte: since } } },
        { $group: {
          _id: "$weapon",
          kills: { $sum: { $cond: [human, 1, 0] } },
          headshots: { $sum: { $cond: [{ $and: [human, "$headshot"] }, 1, 0] } },
          dist: { $sum: { $cond: [{ $and: [human, { $ne: [{ $ifNull: ["$distance", null] }, null] }] }, "$distance", 0] } },
          distN: { $sum: { $cond: [{ $and: [human, { $ne: [{ $ifNull: ["$distance", null] }, null] }] }, 1, 0] } },
          deaths: { $sum: { $cond: [{ $eq: ["$victimBot", false] }, 1, 0] } },
        } },
      ], { allowDiskUse: true }).toArray(),
    ]);

    const sf = sessionFacets[0];
    const mf = matchFacets[0] ?? { daily: [], maps: [], modes: [] };
    const sessionDays = new Map((sf?.daily ?? []).map((r) => [r._id, r]));
    const newDays = new Map(newPlayerRows.map((r) => [r._id, r.n]));
    const matchDays = new Map(mf.daily.map((r) => [r._id, r.n]));
    const rows = (list: Facet[] | undefined, unknown = "Unknown"): CountRow[] => (list ?? [])
      .map((r) => ({ key: r._id || "??", label: r.label || r._id || unknown, players: r.players, sessions: r.sessions }))
      .sort((a, b) => b.players - a.players || b.sessions - a.sessions);
    const usage = (list: Usage[] | undefined, counts: { _id: string; n: number }[]): MapRow[] => {
      const out = new Map<string, MapRow>();
      for (const u of list ?? []) out.set(u._id, { key: u._id, sessions: u.sessions, playTimeMs: u.play, matches: 0 });
      for (const c of counts) { const r = out.get(c._id) ?? { key: c._id, sessions: 0, playTimeMs: 0, matches: 0 }; r.matches = c.n; out.set(c._id, r); }
      return [...out.values()].sort((a, b) => b.playTimeMs - a.playTimeMs || b.matches - a.matches);
    };
    const heatmap = emptyHeatmap();
    for (const c of sf?.heatmap ?? []) if (c._id.d >= 1 && c._id.d <= 7) heatmap[c._id.d - 1][c._id.h] += c.n;
    const weapons: WeaponRow[] = weaponDocs
      .map((w) => ({ weapon: w._id, kills: w.kills, headshots: w.headshots, deaths: w.deaths, avgDistance: w.distN ? Math.round((w.dist / w.distN) * 10) / 10 : null }))
      .sort((a, b) => b.kills - a.kills || b.deaths - a.deaths || a.weapon.localeCompare(b.weapon));

    return {
      days, tz,
      daily: dayKeys(now, days, tz).map((d) => {
        const s = sessionDays.get(d);
        return { day: d, players: s?.players ?? 0, sessions: s?.sessions ?? 0, playTimeMs: s?.play ?? 0, newPlayers: newDays.get(d) ?? 0, matches: matchDays.get(d) ?? 0 };
      }),
      countries: rows(sf?.countries).map((r) => (r.key === "??" ? { ...r, label: "Unknown" } : r)),
      devices: rows(sf?.devices),
      browsers: rows(sf?.browsers),
      os: rows(sf?.os),
      maps: usage(sf?.maps, mf.maps),
      modes: usage(sf?.modes, mf.modes),
      weapons,
      heatmap,
    };
  }
}
