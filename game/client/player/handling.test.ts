import { describe, expect, it } from "vitest";
import { sampleHandling } from "./handling";
import { PRIMARIES, WEAPONS, type WeaponId } from "../../shared/weapons";

const ALL: WeaponId[] = [...PRIMARIES, "pistol"];

describe("weapon handling", () => {
  it("rests on the firing grip with everything seated when idle", () => {
    for (const w of ALL) {
      const h = sampleHandling(w, -1, Infinity, Infinity);
      expect(h.gun.every((v) => v === 0)).toBe(true);
      expect([h.left.a.pose, h.left.b.pose, h.right.a.pose, h.right.b.pose]).toEqual(["support", "support", "grip", "grip"]);
      expect({ mag: h.mag, pump: h.pump, lift: h.boltLift, pull: h.boltPull, held: h.magHeld, shell: h.shellHeld, visible: h.magVisible })
        .toEqual({ mag: 0, pump: 0, lift: 0, pull: 0, held: false, shell: false, visible: true });
    }
  });

  it("ends every reload back where it started, with the magazine seated", () => {
    for (const w of ALL) {
      const end = sampleHandling(w, 1, Infinity, Infinity);
      expect(end.gun.every((v) => Math.abs(v) < 1e-9)).toBe(true);
      expect(end.left.b.pose).toBe("support");
      expect(end.right.b.pose).toBe("grip");
      expect(end.mag).toBe(0);
      expect(end.magHeld).toBe(false);
      expect(end.magVisible).toBe(true);
    }
  });

  it("takes the magazine out mid reload and carries it in the support hand", () => {
    for (const w of ["ar", "smg", "sniper", "pistol"] as WeaponId[]) {
      const samples = Array.from({ length: 101 }, (_, i) => sampleHandling(w, i / 100, Infinity, Infinity));
      expect(Math.max(...samples.map((h) => h.mag))).toBeGreaterThan(0.08);
      expect(samples.some((h) => h.magHeld)).toBe(true);
      expect(samples.some((h) => h.left.a.pose === "mag" && (h.left.a.pouch ?? 0) > 0)).toBe(true);
    }
  });

  it("loads the shotgun shell by shell and works the pump", () => {
    const samples = Array.from({ length: 201 }, (_, i) => sampleHandling("shotgun", i / 200, Infinity, Infinity));
    let loads = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i - 1].shellHeld && !samples[i].shellHeld) loads++;
    expect(loads).toBe(4);
    expect(Math.max(...samples.map((h) => h.pump))).toBeGreaterThan(0.07);
  });

  it("cycles the pump and bolt after a shot, but only on those guns", () => {
    expect(sampleHandling("shotgun", -1, 0.31, Infinity).pump).toBeGreaterThan(0.07);
    const bolt = sampleHandling("sniper", -1, 0.62, Infinity);
    expect(bolt.boltPull).toBeGreaterThan(0.9);
    expect(bolt.right.a.pose).toBe("bolt");
    for (const w of ["ar", "smg", "pistol"] as WeaponId[]) expect(sampleHandling(w, -1, 0.3, Infinity).gun.every((v) => v === 0)).toBe(true);
    // Reloading overrides a cycle that is still playing.
    expect(sampleHandling("sniper", 0, 0.62, Infinity).boltPull).toBe(0);
  });

  it("raises the gun from below while drawing it", () => {
    for (const w of ALL) {
      const start = sampleHandling(w, -1, Infinity, 0);
      expect(start.gun[1]).toBeLessThan(-0.1);
      expect(sampleHandling(w, -1, Infinity, WEAPONS[w].equipMs / 1000).gun.every((v) => v === 0)).toBe(true);
    }
  });
});
