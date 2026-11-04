/** A slow resolution governor: sustained FPS samples, separate recover threshold and cooldown. */
export class ResolutionGovernor {
  dpr: number;
  private elapsed = 0;
  private frames = 0;
  private slow = 0;
  private fast = 0;
  private cooldown = 4;
  /** The last resolution that couldn't hold the frame rate, and how long until it may be tried again. */
  private failed = Infinity;
  private retryIn = 0;

  constructor(readonly maximum: number, readonly minimum: number) {
    this.dpr = maximum;
  }

  pause() {
    this.elapsed = this.frames = this.slow = this.fast = 0;
  }

  /** Returns a new DPR only after a stable sample. Loading hitches are ignored. */
  sample(dt: number): number | null {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.5) { this.pause(); return null; }
    this.retryIn = Math.max(0, this.retryIn - dt);
    if (this.cooldown > 0) { this.cooldown -= dt; return null; }
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < 2) return null;
    const fps = this.frames / this.elapsed;
    this.elapsed = this.frames = 0;
    // Below 56 a 60 Hz screen is visibly dropping frames; play should hold 60.
    this.slow = fps < 56 ? this.slow + 1 : 0;
    this.fast = fps > 58 ? this.fast + 1 : 0;
    let next = this.dpr;
    if (this.slow >= 2) next = Math.max(this.minimum, this.dpr - 0.1);
    // Recovering stops short of a resolution that just failed, so it doesn't swing back and forth.
    else if (this.fast >= 4 && !(this.retryIn > 0 && this.dpr + 0.05 >= this.failed - 1e-6)) next = Math.min(this.maximum, this.dpr + 0.05);
    if (next === this.dpr) return null;
    if (next < this.dpr) { this.failed = this.dpr; this.retryIn = 60; }
    this.dpr = Math.round(next * 100) / 100;
    this.slow = this.fast = 0;
    this.cooldown = 4;
    return this.dpr;
  }
}
