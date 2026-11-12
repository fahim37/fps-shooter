import { afterEach, describe, expect, it, vi } from "vitest";
import { MatchRoom, type ServerPlayer } from "./MatchRoom";
import { MatchState, PlayerState } from "../game/shared/schema";
import { MAX_HEALTH, MAX_SHIELD, REGEN_DELAY_MS, REGEN_PER_SEC, TICK_MS } from "../game/shared/constants";
import { WEAPONS, damageAt } from "../game/shared/weapons";

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

describe("shield", () => {
  function full() {
    const f = fixture();
    f.st.hp = MAX_HEALTH; f.st.shield = MAX_SHIELD;
    return f;
  }
  it("takes damage before health, and the rest carries through", () => {
    const { room, player, st } = full();
    room.damage(player, 12, null, "fall", "body", [0, 0, 0]);
    expect([st.shield, st.hp]).toEqual([MAX_SHIELD - 12, 100]);
    room.damage(player, MAX_SHIELD - 2, null, "fall", "body", [0, 0, 0]);
    expect([st.shield, st.hp]).toEqual([0, 90]);
  });
  it("still falls to all nine pellets of a close shotgun blast", () => {
    expect(damageAt(WEAPONS.shotgun, 5) * 9).toBeGreaterThanOrEqual(MAX_HEALTH + MAX_SHIELD);
  });
  it("never regenerates: health heals back to 100 and stops", () => {
    const { room, player, st } = full();
    room.damage(player, 50, null, "fall", "body", [0, 0, 0]);
    for (let tick = 1; tick <= 300; tick++) { vi.setSystemTime(16_000 + tick * TICK_MS); room.tick(); }
    expect([st.shield, st.hp]).toEqual([0, MAX_HEALTH]);
  });
  it("a sniper body shot does 100 (kills an unshielded player, a full-shield one survives on the shield), a headshot kills at any range", () => {
    const { sniper } = WEAPONS;
    expect(damageAt(sniper, 5)).toBe(100);
    expect(damageAt(sniper, 5)).toBeGreaterThanOrEqual(MAX_HEALTH);
    expect(damageAt(sniper, 5)).toBeLessThan(MAX_HEALTH + MAX_SHIELD);
    for (const range of [5, 120, 300]) expect(damageAt(sniper, range) * sniper.headMult).toBeGreaterThanOrEqual(MAX_HEALTH + MAX_SHIELD);
  });
  it("a pistol headshot goes through a full shield up close; far away it kills only an unshielded player", () => {
    const { pistol } = WEAPONS;
    for (const range of [2, 18, 35]) expect(damageAt(pistol, range) * pistol.headMult).toBeGreaterThanOrEqual(MAX_HEALTH + MAX_SHIELD);
    // Far away a headshot does about 120: lethal unshielded, a full shield survives on ~15.
    for (const range of [40, 120]) expect(Math.round(damageAt(pistol, range) * pistol.headMult)).toBe(120);
    expect(damageAt(pistol, 5)).toBeLessThan(MAX_HEALTH);
  });
});

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
