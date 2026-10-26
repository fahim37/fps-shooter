/** A pong handled this long (or three usual frames) after the last frame began waited behind a blocked main thread. */
const STALL_MS = 100;

/**
 * Estimates the server clock from ping/pong round trips. Keeps the offset from the
 * lowest-latency recent samples, which are the least distorted by queuing.
 */
export class ServerClock {
  private samples: { rtt: number; offset: number }[] = [];
  private rtts: number[] = [];
  private frameAt = -Infinity;
  private frameGap = 1000 / 60;
  offset = 0;
  rtt = 0;
  synced = false;

  now() {
    return performance.now() + this.offset;
  }

  /** Called at the start of every frame, so pongs delayed by a long frame can be told apart. */
  frame(t: number) {
    const gap = t - this.frameAt;
    if (gap < 1000) this.frameGap += (gap - this.frameGap) * 0.1;
    this.frameAt = t;
  }

  onPong(clientSent: number, serverTime: number) {
    const t = performance.now();
    const rtt = t - clientSent;
    const offset = serverTime + rtt / 2 - t;
    this.samples.push({ rtt, offset });
    if (this.samples.length > 12) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 4);
    const target = best.reduce((s, x) => s + x.offset, 0) / best.length;
    // Snap on first sync, then slew gently so interpolation doesn't jump.
    this.offset = this.synced ? this.offset + (target - this.offset) * 0.3 : target;
    this.synced = true;
    // A frame hitch is not network latency; the median shrugs off a single resent packet
    // but still follows lag that lasts a few samples.
    if (t - this.frameAt > Math.max(STALL_MS, this.frameGap * 3)) return;
    this.rtts.push(rtt);
    if (this.rtts.length > 5) this.rtts.shift();
    const sorted = [...this.rtts].sort((a, b) => a - b);
    this.rtt = sorted[Math.floor(sorted.length / 2)];
  }
}
