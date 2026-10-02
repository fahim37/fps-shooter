import { describe, expect, it, vi } from "vitest";
import { MatchRoom, type ServerPlayer } from "./MatchRoom";
import type { LoadoutMsg } from "../game/shared/messages";

vi.mock("./world", () => ({ map: {}, RAPIER: {} }));
vi.mock("./bot", () => ({ Bot: class {}, BOT_NAMES: [] }));

function fixture(alive = true, phase = "live") {
  const send = vi.fn();
  const p = {
    st: { primary: "ar", weapon: "ar", alive }, reloadingUntil: 999, shotSeq: 12,
    ammo: { ar: { mag: 7, reserve: 35 }, smg: { mag: 9, reserve: 62 } }, client: { send },
  } as unknown as ServerPlayer;
  const room = { state: { phase } } as MatchRoom;
  const change = (m: unknown) => MatchRoom.prototype.changeLoadout.call(room, p, m as LoadoutMsg);
  return { p, send, change };
}

describe("authoritative gun swaps", () => {
  it("equips immediately, cancels reload and preserves ammo across repeated swaps", () => {
    const { p, send, change } = fixture();
    change({ primary: "smg" });
    expect(p.st).toMatchObject({ primary: "smg", weapon: "smg" });
    expect(p.reloadingUntil).toBe(0);
    expect(send).toHaveBeenLastCalledWith("loadout", { primary: "smg", weapon: "smg", mag: 9, reserve: 62, shot: 12 });
    change({ primary: "ar" });
    expect(p.ammo.ar).toEqual({ mag: 7, reserve: 35 });
    change({ primary: "smg" });
    expect(p.ammo.smg).toEqual({ mag: 9, reserve: 62 });
  });
  it("queues a dead player's selection without equipping a gun or changing ammo", () => {
    const { p, change } = fixture(false);
    change({ primary: "smg" });
    expect(p.st).toMatchObject({ primary: "smg", weapon: "ar", alive: false });
    expect(p.ammo.smg.mag).toBe(9);
  });
  it("ignores malformed, sidearm and ended-match selections", () => {
    const { p, send, change } = fixture();
    for (const message of [null, {}, { primary: "pistol" }, { primary: "invalid" }]) change(message);
    expect(p.st.primary).toBe("ar");
    expect(send).not.toHaveBeenCalled();
    const ended = fixture(true, "ended");
    ended.change({ primary: "smg" });
    expect(ended.p.st.primary).toBe("ar");
    expect(ended.send).not.toHaveBeenCalled();
  });
});
