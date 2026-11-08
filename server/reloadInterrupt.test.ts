import { describe, expect, it, vi } from "vitest";
import { MatchRoom, type ServerPlayer } from "./MatchRoom";
import type { FireMsg } from "../game/shared/messages";
import { reloadMs, roundSeats, type WeaponId } from "../game/shared/weapons";

vi.mock("./world", () => ({ map: {}, RAPIER: {} }));
vi.mock("./bot", () => ({ Bot: class {}, BOT_NAMES: [] }));

/** A player `frac` of the way through a reload of `need` rounds into an empty `weapon`. */
function reloading(weapon: WeaponId, need: number, frac: number) {
  const ms = reloadMs(weapon, need), start = Date.now() - frac * ms;
  const p = {
    st: { primary: "ar", weapon, alive: true }, lastFireAt: 0, shotSeq: 0, client: { send: vi.fn() },
    reloadStartAt: start, reloadingUntil: start + ms, reloadNeed: need, reloadDone: 0,
    ammo: { ar: { mag: 0, reserve: 90 }, pistol: { mag: 0, reserve: 30 } },
  } as unknown as ServerPlayer;
  const room = Object.assign(Object.create(MatchRoom.prototype), { state: { phase: "live" } }) as MatchRoom;
  // No pellet directions: the shot is refused right after the reload is dealt with.
  const fire = () => MatchRoom.prototype.fire.call(room, p, { weapon } as FireMsg);
  return { p, fire };
}

describe("a shot during a reload", () => {
  it("stops the revolver's reload, keeping the rounds already seated", () => {
    const seats = roundSeats(6);
    // Halfway between the second and third rounds seating, and well clear of the grace window.
    const { p, fire } = reloading("pistol", 6, (seats[1] + seats[2]) / 2 - 0.2 * (seats[2] - seats[1]));
    fire();
    expect(p.reloadingUntil).toBe(0);
    expect(p.ammo.pistol).toEqual({ mag: 2, reserve: 28 });
  });
  it("is refused on a magazine gun, which keeps reloading", () => {
    const { p, fire } = reloading("ar", 35, 0.5);
    const until = p.reloadingUntil;
    fire();
    expect(p.reloadingUntil).toBe(until);
    expect(p.ammo.ar).toEqual({ mag: 0, reserve: 90 });
  });
});
