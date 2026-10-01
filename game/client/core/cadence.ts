/** Preserve automatic weapon cadence across render rates without burst catch-up shots. */
export class ShotCadence {
  private next = 0;
  private lastActual = -Infinity;

  reset() { this.next = 0; this.lastActual = -Infinity; }

  ready(now: number, interval: number) {
    // Match the server's minimum accepted spacing even when a frame overshoots the schedule.
    return now >= this.next && now - this.lastActual >= interval * 0.75;
  }

  record(now: number, interval: number, automatic: boolean) {
    const continuous = automatic && now - this.lastActual < interval * 2;
    this.next = continuous ? Math.max(this.next + interval, now + interval * 0.75) : now + interval;
    this.lastActual = now;
  }
}
