import type { Pose } from "./hitboxes";

interface Sample extends Pose {
  t: number;
}

/**
 * Ring buffer of recent poses for one player. The server rewinds targets to the moment the
 * shooter saw them (`sample(viewTime)`), so hits register on what was on screen.
 */
export class PoseHistory {
  private buf: Sample[] = [];
  private head = 0;

  constructor(private capacity = 48) {}

  push(t: number, p: Pose) {
    const s = { t, x: p.x, y: p.y, z: p.z, crouch: p.crouch };
    if (this.buf.length < this.capacity) this.buf.push(s);
    else this.buf[this.head] = s;
    this.head = (this.head + 1) % this.capacity;
  }

  clear() {
    this.buf = [];
    this.head = 0;
  }

  /** Pose at time `t`, linearly interpolated; clamped to the recorded range. */
  sample(t: number): Pose | null {
    const n = this.buf.length;
    if (n === 0) return null;
    const oldest = n < this.capacity ? 0 : this.head;
    const at = (i: number) => this.buf[(oldest + i) % n];
    if (t <= at(0).t) return at(0);
    const last = at(n - 1);
    if (t >= last.t) return last;
    for (let i = 1; i < n; i++) {
      const b = at(i);
      if (b.t >= t) {
        const a = at(i - 1);
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
        // A big jump between samples is a respawn/teleport: don't blend across it.
        if (Math.hypot(b.x - a.x, b.z - a.z) > 4) return k < 0.5 ? a : b;
        return {
          x: a.x + (b.x - a.x) * k,
          y: a.y + (b.y - a.y) * k,
          z: a.z + (b.z - a.z) * k,
          crouch: k < 0.5 ? a.crouch : b.crouch,
        };
      }
    }
    return last;
  }
}
