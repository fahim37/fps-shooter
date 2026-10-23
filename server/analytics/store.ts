import type {
  AnalyticsSeries, ConcurrencySample, KillDoc, MatchDetail, MatchDoc, OverviewStats, Page, PlayerDetail, PlayerDoc, SessionDoc,
} from "../../game/shared/adminApi";
import { applySessionToPlayer } from "./stats";
import { computeAnalytics, computeOverview, playerDetail, queryMatches, queryPlayers, type MatchQuery, type PlayerQuery } from "./queries";

export type { MatchQuery, PlayerQuery } from "./queries";

/** Where analytics live. The game server only writes; the admin API only reads. */
export interface AnalyticsStore {
  readonly kind: "mongo" | "memory";
  connect(): Promise<void>;
  close(): Promise<void>;
  /** Stores sessions and folds each into its player's lifetime record. */
  writeSessions(docs: SessionDoc[]): Promise<void>;
  writeMatches(docs: MatchDoc[]): Promise<void>;
  writeKills(docs: KillDoc[]): Promise<void>;
  writeSamples(docs: ConcurrencySample[]): Promise<void>;

  overview(now: number, tz: string): Promise<OverviewStats>;
  players(q: PlayerQuery): Promise<Page<PlayerDoc>>;
  player(pid: string): Promise<PlayerDetail | null>;
  matches(q: MatchQuery): Promise<Page<MatchDoc>>;
  match(id: string): Promise<MatchDetail | null>;
  analytics(now: number, days: number, tz: string): Promise<AnalyticsSeries>;
}

/** Keeps everything in arrays: used by tests and as a reference for the Mongo queries. */
export class MemoryStore implements AnalyticsStore {
  readonly kind = "memory" as const;
  sessions: SessionDoc[] = [];
  playerDocs = new Map<string, PlayerDoc>();
  matchDocs: MatchDoc[] = [];
  kills: KillDoc[] = [];
  samples: ConcurrencySample[] = [];
  /** Set to make every call reject, like an unreachable database. */
  failing = false;

  private check() { if (this.failing) throw new Error("store unavailable"); }

  async connect() { this.check(); }
  async close() {}

  async writeSessions(docs: SessionDoc[]) {
    this.check();
    for (const s of docs) {
      this.sessions.push(s);
      this.playerDocs.set(s.pid, applySessionToPlayer(this.playerDocs.get(s.pid), s));
    }
  }
  async writeMatches(docs: MatchDoc[]) { this.check(); this.matchDocs.push(...docs); }
  async writeKills(docs: KillDoc[]) { this.check(); this.kills.push(...docs); }
  async writeSamples(docs: ConcurrencySample[]) { this.check(); this.samples.push(...docs); }

  async overview(now: number, tz: string) {
    this.check();
    return computeOverview(this.sessions, [...this.playerDocs.values()], this.matchDocs, this.samples, now, tz);
  }
  async players(q: PlayerQuery) { this.check(); return queryPlayers([...this.playerDocs.values()], q); }
  async player(pid: string) {
    this.check();
    const p = this.playerDocs.get(pid);
    return p ? playerDetail(p, this.sessions, this.matchDocs, this.kills) : null;
  }
  async matches(q: MatchQuery) { this.check(); return queryMatches(this.matchDocs, q); }
  async match(id: string) {
    this.check();
    const match = this.matchDocs.find((m) => m._id === id);
    return match ? { match, kills: this.kills.filter((k) => k.matchId === id).sort((a, b) => +a.at - +b.at) } : null;
  }
  async analytics(now: number, days: number, tz: string) {
    this.check();
    return computeAnalytics(this.sessions, [...this.playerDocs.values()], this.matchDocs, this.kills, now, days, tz);
  }
}
