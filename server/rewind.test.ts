import { afterEach, describe, expect, it, vi } from "vitest";
import { MatchRoom, type ServerPlayer } from "./MatchRoom";
import { MatchState, PlayerState } from "../game/shared/schema";
import { PoseHistory } from "../game/shared/lagcomp";

vi.mock("./world", () => ({ map: {}, RAPIER: {} }));
vi.mock("./bot", () => ({ Bot: class {}, BOT_NAMES: [] }));
afterEach(() => vi.useRealTimers());

describe("lag compensation", () => {
  it("rewinds to exactly the pose each patch carried, at the time it was stamped with", () => {
    vi.useFakeTimers(); vi.setSystemTime(10_000);
    const st = new PlayerState(); st.alive = true;
    const player = { st, history: new PoseHistory(), vel: [8.4, 0, 0], pose: [0, 0, 0] } as unknown as ServerPlayer;
    const room = Object.assign(Object.create(MatchRoom.prototype), { state: new MatchState(), players: new Map([["p", player]]) });
    room.state.phase = "live";

    // A sprinting player whose poses arrive between ticks and patches: each patch sends wherever
    // they are at that moment, stamped with that moment.
    const sent: { t: number; x: number }[] = [];
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(10_000 + i * 33 + 17);
      st.x = (i * 33 + 17) * 0.0084;
      room.onBeforePatch();
      sent.push({ t: room.state.serverTime, x: st.x });
    }
    // Clients blend between the patches they got; the server's rewind gives the same answer.
    for (let i = 1; i < sent.length; i++) {
      const a = sent[i - 1], b = sent[i], mid = (a.t + b.t) / 2;
      expect(player.history.sample(mid)!.x).toBeCloseTo((a.x + b.x) / 2, 6);
    }
  });
});
