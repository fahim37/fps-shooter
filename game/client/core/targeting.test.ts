import { describe, expect, it } from "vitest";
import { enemyAlongRay } from "./targeting";

const enemy = (z = -8, team = 2) => ({
  alive: true, team, protectedUntil: 0,
  pose: () => ({ x: 0, y: 0, z, crouch: false }),
});
const origin: [number, number, number] = [0, 1.64, 0];
const direction: [number, number, number] = [0, 0, -1];
const trace = (targets: ReturnType<typeof enemy>[], maxDistance = 100, tdm = true) => enemyAlongRay(origin, direction, maxDistance, targets, tdm, 1, 1000);

describe("enemy crosshair targeting", () => {
  it("highlights the nearest enemy using the head hitbox", () => {
    const near = enemy(-5);
    const hit = trace([enemy(-8), near]);
    expect(hit.target).toBe(near);
    expect(hit.part).toBe("head");
  });
  it("does not highlight enemies behind map cover or outside weapon range", () => {
    expect(trace([enemy()], 4).target).toBeNull();
  });
  it("ignores teammates in team matches, but targets them in free for all", () => {
    const teammate = enemy(-5, 1);
    expect(trace([teammate]).target).toBeNull();
    expect(trace([teammate], 100, false).target).toBe(teammate);
  });
  it("ignores dead enemies and active spawn protection", () => {
    expect(trace([{ ...enemy(), alive: false }, { ...enemy(), protectedUntil: 1001 }]).target).toBeNull();
    expect(trace([{ ...enemy(), protectedUntil: 1000 }]).target).not.toBeNull();
  });
  it("clears the target as soon as the enemy moves away from the ray", () => {
    const offscreen = { ...enemy(), pose: () => ({ x: 1, y: 0, z: -5, crouch: false }) };
    expect(trace([offscreen]).target).toBeNull();
  });
});
