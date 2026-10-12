import { afterEach, describe, expect, it, vi } from "vitest";
import { MatchRoom, type ServerPlayer } from "./MatchRoom";
import { MatchState, PlayerState } from "../game/shared/schema";
import { MAX_HEALTH, REGEN_DELAY_MS, REGEN_PER_SEC, TICK_MS } from "../game/shared/constants";

vi.mock("./world", () => ({ map: {}, RAPIER: {} }));
vi.mock("./bot", () => ({ Bot: class {}, BOT_NAMES: [] }));
afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const st = new PlayerState(); st.hp = 40; st.alive = true;
  const player = { st, lastDamageAt: Date.now(), history: { push: vi.fn() }, client: { send: vi.fn() } } as unknown as ServerPlayer;
  const room = Object.assign(Object.create(MatchRoom.prototype), { state: new MatchState(), players: new Map([["p", player]]), stepGrenades: vi.fn() });
  room.state.phase = "live"; room.state.phaseEndsAt = 1_000_000;
  return { room, player, st };
}

describe("authoritative health regeneration", () => {
  it("waits five seconds, then heals at 20 HP/sec and caps at 100", () => {
    const { room, st } = fixture();
    vi.setSystemTime(10_000 + REGEN_DELAY_MS); room.tick(); expect(st.hp).toBe(40);
    for (let tick = 1; tick <= 30; tick++) { vi.setSystemTime(15_000 + tick * TICK_MS); room.tick(); }
    expect(st.hp).toBeCloseTo(40 + REGEN_PER_SEC);
    for (let tick = 31; tick <= 180; tick++) { vi.setSystemTime(15_000 + tick * TICK_MS); room.tick(); }
    expect(st.hp).toBe(MAX_HEALTH);
  });
  it("a new hit restarts the delay and dead players do not regenerate", () => {
    const { room, player, st } = fixture();
    vi.setSystemTime(16_000); room.tick(); expect(st.hp).toBeGreaterThan(40);
    room.damage(player, 10, null, "fall", "body", [0, 0, 0]);
    const damaged = st.hp;
    vi.setSystemTime(20_999); room.tick(); expect(st.hp).toBe(damaged);
    vi.setSystemTime(21_001); room.tick(); expect(st.hp).toBeGreaterThan(damaged);
    st.alive = false; const deadHp = st.hp;
    vi.setSystemTime(30_000); room.tick(); expect(st.hp).toBe(deadHp);
  });
});
