import { monitorEventLoopDelay } from "node:perf_hooks";

/**
 * Watches the event loop: while it is blocked, every room's ticks and pong replies wait,
 * so players see a ping spike. Stalls are logged with their time to line up with reports,
 * and the last minute's delay percentiles are served on /health.
 */
const STALL_MS = 100;
const CHECK_MS = 50;
const WINDOW_MS = 60_000;

export type LoopStats = { p50: number; p99: number; max: number; stalls: { at: string; ms: number }[] };

export function startLoopMonitor() {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const stalls: LoopStats["stalls"] = [];
  let last = { p50: 0, p99: 0, max: 0 };
  let expected = performance.now() + CHECK_MS;

  const check = setInterval(() => {
    const t = performance.now();
    const late = t - expected;
    expected = t + CHECK_MS;
    if (late < STALL_MS) return;
    const stall = { at: new Date().toISOString(), ms: Math.round(late) };
    stalls.push(stall);
    if (stalls.length > 20) stalls.shift();
    console.warn(`[loop] event loop stalled ${stall.ms} ms`);
  }, CHECK_MS);
  const roll = setInterval(() => {
    last = { p50: ms(histogram.percentile(50)), p99: ms(histogram.percentile(99)), max: ms(histogram.max) };
    histogram.reset();
  }, WINDOW_MS);
  check.unref();
  roll.unref();

  return { stats: (): LoopStats => ({ ...last, stalls: [...stalls] }) };
}

const ms = (ns: number) => Math.round(ns / 1e5) / 10;
