import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerClock } from "./clock";

/** Runs frames at 60 fps until `at`, then delivers a pong for a ping sent `rtt` ms earlier. */
function pongAt(clock: ServerClock, at: number, rtt: number, lastFrame = at - 5) {
  vi.spyOn(performance, "now").mockReturnValue(at);
  clock.frame(lastFrame - 16);
  clock.frame(lastFrame);
  clock.onPong(at - rtt, 1000);
}

describe("ServerClock ping", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ignores a single spike, as from one resent packet", () => {
    const clock = new ServerClock();
    [40, 42, 500, 41, 39].forEach((rtt, i) => pongAt(clock, 1000 + i * 1500, rtt));
    expect(clock.rtt).toBe(41);
  });

  it("follows lag that lasts several samples", () => {
    const clock = new ServerClock();
    [40, 42, 200, 210, 205].forEach((rtt, i) => pongAt(clock, 1000 + i * 1500, rtt));
    expect(clock.rtt).toBe(200);
  });

  it("does not count a pong held up by a long frame as latency", () => {
    const clock = new ServerClock();
    pongAt(clock, 1000, 40);
    pongAt(clock, 2500, 400, 2500 - 380);
    expect(clock.rtt).toBe(40);
    expect(clock.synced).toBe(true);
  });

  it("still measures on a device whose every frame is slow", () => {
    const clock = new ServerClock();
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    for (let t = 0; t <= 9_880; t += 120) clock.frame(t);
    clock.onPong(10_000 - 60, 1000);
    expect(clock.rtt).toBe(60);
  });
});
