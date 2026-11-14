import { describe, expect, it } from "vitest";
import { BOT_DASH_DISTANCE, chooseCombatMove, type CombatSituation, type ProbeMove } from "./botTactics";

const situation = (changes: Partial<CombatSituation> = {}): CombatSituation => ({
  position: [0, 0, 0], target: [0, 0, -18], preferredRange: 18,
  defensive: false, underFire: false, canDash: true, side: 1, ...changes,
});
const open: ProbeMove = ([x, z], d) => ({ point: [x * d, 0, z * d], covered: false });

describe("bot combat decisions", () => {
  it("saves dashes at effective weapon range when there is no threat", () => {
    const move = chooseCombatMove(situation(), open)!;
    expect(move.dash).toBe(false);
    expect(Math.abs(move.direction[0])).toBe(1);
  });

  it("closes a long gap, but does not overshoot effective range", () => {
    const move = chooseCombatMove(situation({ target: [0, 0, -40] }), open)!;
    expect(move).toEqual({ direction: [0, -1], dash: true });
    expect(40 - BOT_DASH_DISTANCE).toBeGreaterThan(18);
    expect(chooseCombatMove(situation({ target: [0, 0, -26] }), open)).toBeNull();
  });

  it("dodges laterally under aimed fire, instead of rushing the attacker", () => {
    const move = chooseCombatMove(situation({ underFire: true }), open)!;
    expect(move.dash).toBe(true);
    expect(Math.abs(move.direction[0])).toBe(1);
  });

  it("prioritizes reachable cover while hurt or reloading", () => {
    const probe: ProbeMove = (dir, d) => ({ ...open(dir, d)!, covered: d > 3 && dir[0] < -0.9 });
    const move = chooseCombatMove(situation({ defensive: true }), probe)!;
    expect(move.dash).toBe(true);
    expect(move.direction[0]).toBe(-1);
  });

  it("walks to nearby cover while reloading, but dashes there when under fire", () => {
    const probe: ProbeMove = (dir, d) => ({ ...open(dir, d)!, covered: dir[0] < -0.9 });
    expect(chooseCombatMove(situation({ defensive: true }), probe)).toEqual({ direction: [-1, -0], dash: false });
    expect(chooseCombatMove(situation({ defensive: true, underFire: true }), probe)?.dash).toBe(true);
  });

  it("backs out of a close fight without spending a dash for no reason", () => {
    const move = chooseCombatMove(situation({ target: [0, 0, -5] }), open)!;
    expect(move.dash).toBe(false);
    expect(move.direction[1]).toBeGreaterThan(0);
  });

  it("rejects unsafe bursts and falls back to walking", () => {
    const move = chooseCombatMove(situation({ underFire: true }), (dir, d) => d > 3 ? null : open(dir, d))!;
    expect(move.dash).toBe(false);
    expect(chooseCombatMove(situation({ underFire: true }), () => null)).toEqual({ direction: [0, 0], dash: false });
  });

  it("uses ordinary movement when charges or the ability cooldown are unavailable", () => {
    expect(chooseCombatMove(situation({ underFire: true, canDash: false }), open)?.dash).toBe(false);
    expect(chooseCombatMove(situation({ target: [0, 0, -40], canDash: false }), open)).toBeNull();
  });

  it("keeps tactical choices deterministic and preserves a useful strafe", () => {
    const left = situation({ side: 1 }), right = situation({ side: -1 });
    expect(chooseCombatMove(left, open)?.direction[0]).toBe(1);
    expect(chooseCombatMove(right, open)?.direction[0]).toBe(-1);
    for (let i = 0; i < 10; i++) expect(chooseCombatMove(left, open)).toEqual(chooseCombatMove(left, open));
  });
});
