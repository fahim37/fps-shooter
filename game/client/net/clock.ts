/**
 * Estimates the server clock from ping/pong round trips. Keeps the offset from the
 * lowest-latency recent samples, which are the least distorted by queuing.
 */
export class ServerClock {
  private samples: { rtt: number; offset: number }[] = [];
  offset = 0;
  rtt = 0;
  synced = false;

  now() {
    return performance.now() + this.offset;
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
    this.rtt = this.synced ? this.rtt * 0.7 + rtt * 0.3 : rtt;
    this.synced = true;
  }
}
