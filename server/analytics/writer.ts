import type { ConcurrencySample, KillDoc, MatchDoc, SessionDoc, StorageStatus } from "../../game/shared/adminApi";
import type { AnalyticsStore } from "./store";

export type WriteItem =
  | { kind: "session"; doc: SessionDoc }
  | { kind: "match"; doc: MatchDoc }
  | { kind: "kill"; doc: KillDoc }
  | { kind: "sample"; doc: ConcurrencySample };

export interface WriterOptions {
  /** Most items held while the database is unreachable; the oldest are dropped beyond this. */
  maxQueue?: number;
  batch?: number;
  flushMs?: number;
  retryMs?: number;
  log?: Pick<Console, "warn" | "info">;
}

/**
 * Fire-and-forget persistence. `push` never blocks or throws: items wait in a bounded queue and
 * are written in batches off the game tick. When the database is down the queue keeps the newest
 * items, connection attempts back off, and the outage is logged once.
 */
export class WriteQueue {
  status: StorageStatus;
  dropped = 0;
  private queue: WriteItem[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private nextAttemptAt = 0;
  private warned = false;
  private readonly maxQueue: number;
  private readonly batch: number;
  private readonly flushMs: number;
  private readonly retryMs: number;
  private readonly log: Pick<Console, "warn" | "info">;

  constructor(readonly store: AnalyticsStore | null, opts: WriterOptions = {}) {
    this.status = store ? "connecting" : "disabled";
    this.maxQueue = opts.maxQueue ?? 5000;
    this.batch = opts.batch ?? 500;
    this.flushMs = opts.flushMs ?? 2000;
    this.retryMs = opts.retryMs ?? 15_000;
    this.log = opts.log ?? console;
  }

  get pending() { return this.queue.length; }

  push(item: WriteItem) {
    if (!this.store) return;
    if (this.queue.length >= this.maxQueue) { this.queue.shift(); this.dropped++; }
    this.queue.push(item);
  }

  start() {
    if (!this.store || this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.flushMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.status === "connected") {
      this.nextAttemptAt = 0;
      await this.tick();
    }
    await this.store?.close();
  }

  /** One connect-or-flush step; safe to call any time (never overlaps, never throws). */
  async tick(now = Date.now()) {
    if (!this.store || this.busy || now < this.nextAttemptAt) return;
    this.busy = true;
    try {
      if (this.status !== "connected") {
        await this.store.connect();
        this.status = "connected";
        if (this.warned) this.log.info("[analytics] database reachable again; recording resumed");
        this.warned = false;
      }
      while (this.queue.length) await this.flushBatch();
    } catch (e) {
      this.status = "unavailable";
      this.nextAttemptAt = now + this.retryMs;
      if (!this.warned) {
        this.warned = true;
        this.log.warn(`[analytics] database unavailable (${(e as Error).message}); the game keeps running, analytics are buffered (max ${this.maxQueue}) and retried`);
      }
    } finally {
      this.busy = false;
    }
  }

  private async flushBatch() {
    const items = this.queue.splice(0, this.batch);
    try {
      const of = <K extends WriteItem["kind"]>(kind: K) =>
        items.filter((i): i is Extract<WriteItem, { kind: K }> => i.kind === kind).map((i) => i.doc);
      const sessions = of("session"), matches = of("match"), kills = of("kill"), samples = of("sample");
      if (sessions.length) await this.store!.writeSessions(sessions as SessionDoc[]);
      if (matches.length) await this.store!.writeMatches(matches as MatchDoc[]);
      if (kills.length) await this.store!.writeKills(kills as KillDoc[]);
      if (samples.length) await this.store!.writeSamples(samples as ConcurrencySample[]);
    } catch (e) {
      // Put the batch back (newest items win if the queue overflowed meanwhile) and let tick() back off.
      const room = Math.max(0, this.maxQueue - this.queue.length);
      this.dropped += Math.max(0, items.length - room);
      this.queue.unshift(...items.slice(Math.max(0, items.length - room)));
      throw e;
    }
  }
}
