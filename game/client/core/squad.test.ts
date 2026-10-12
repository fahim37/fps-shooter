import { describe, expect, it } from "vitest";
import { buildSquad } from "./squad";
import { addThreat, bearingYaw, relativeBearing, threatStrength, THREAT_MS, type Threat } from "./minimap";

const player = (name: string, team: number, hp = 100, alive = true) => ({ name, team, hp, alive, connected: true, bot: false });

describe("squad panel", () => {
  it("lists you first, then teammates in join order, and never enemies", () => {
    const squad = buildSquad([["a", player("Ann", 1, 40)], ["e", player("Eve", 2)], ["me", player("Me", 1)], ["b", player("Bo", 1, 0, false)]], "me", 1, "tdm");
    expect(squad.map((m) => [m.name, m.slot])).toEqual([["Me", 0], ["Ann", 1], ["Bo", 2]]);
    expect(squad[1].hp).toBe(40);
    expect(squad[2]).toMatchObject({ alive: false, hp: 0 });
  });
  it("is empty in free-for-all", () => {
    expect(buildSquad([["me", player("Me", 0)], ["x", player("X", 0)]], "me", 0, "ffa")).toEqual([]);
  });
});

describe("hit direction", () => {
  it("points the indicator at the shooter relative to where you look", () => {
    // Looking north (-Z); shot from the east (+X) is 90° clockwise.
    expect(relativeBearing(0, bearingYaw(10, 0)) * 180 / Math.PI).toBeCloseTo(90);
    expect(relativeBearing(0, bearingYaw(0, -10))).toBeCloseTo(0);
    // After turning to face east, the same shooter is dead ahead.
    expect(relativeBearing(-Math.PI / 2, bearingYaw(10, 0))).toBeCloseTo(0);
  });
  it("merges repeated hits from one attacker and expires old ones", () => {
    const hit = (key: string, at: number, damage = 20): Threat => ({ key, from: [0, 0, 0], at, damage, kind: "bullet" });
    let threats = addThreat([], hit("a", 0));
    threats = addThreat(threats, hit("b", 100));
    threats = addThreat(threats, hit("a", 200));
    expect(threats.map((t) => t.key)).toEqual(["b", "a"]);
    expect(threats[1].damage).toBeGreaterThan(20);
    expect(addThreat(threats, hit("c", THREAT_MS + 500)).map((t) => t.key)).toEqual(["c"]);
    expect(threatStrength(hit("a", 0), 0)).toBeGreaterThan(threatStrength(hit("a", 0), THREAT_MS / 2));
    expect(threatStrength(hit("a", 0), THREAT_MS)).toBe(0);
  });
});
