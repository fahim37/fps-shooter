import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { LocalPlayer } from "./local";
import { ShotCadence } from "./cadence";
import { useLoadout } from "../loadout";
import { DEFAULT_OPTICS } from "../../shared/optics";
import { useSettings } from "../settings";

vi.mock("./audio", () => ({ audio: { switchWeapon: vi.fn() } }));

beforeEach(() => {
  useLoadout.setState({ optics: { ...DEFAULT_OPTICS } });
  useSettings.setState({ fov: 78 });
});

function player(): LocalPlayer {
  return Object.assign(Object.create(LocalPlayer.prototype), {
    alive: true, primary: "ar", weapon: "ar", ads: 1, adsProgress: 1, thirdPerson: true,
    kickPitch: 0.2, kickYaw: 0.1, burst: 5, reloadEnd: 1000, pendingShots: [{ shot: 14, weapon: "smg" }],
    ammo: { ar: { mag: 11, reserve: 50 }, smg: { mag: 31, reserve: 100 } }, cadence: new ShotCadence(),
    game: { send: vi.fn() }, ms: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
  }) as LocalPlayer;
}

describe("local loadout", () => {
  it("reconciles authoritative swaps with unacknowledged shots and clears old recoil", () => {
    const local = player();
    local.applyLoadout({ primary: "smg", weapon: "smg", mag: 9, reserve: 62, shot: 12 });
    expect(local.weapon).toBe("smg");
    expect(local.primary).toBe("smg");
    expect(local.ammo.smg).toEqual({ mag: 8, reserve: 62 });
    expect(local.reloadEnd).toBe(0);
    expect(local.ads).toBe(0);
    expect(local).toMatchObject({ kickPitch: 0, kickYaw: 0, burst: 0 });
  });
  it("only switches between carried guns and does not refill them", () => {
    const local = player();
    local.switchTo("sniper", 100);
    expect(local.weapon).toBe("ar");
    local.switchTo("pistol", 100);
    expect(local.weapon).toBe("pistol");
    local.switchTo("ar", 400);
    expect(local.ammo.ar.mag).toBe(11);
  });
  it("applies scope zoom and uses the eye camera while aiming from TPP", () => {
    const local = player();
    useLoadout.getState().equipOptic("ar", "4x");
    expect(local.scoped).toBe(true);
    const zoom = Math.tan(78 * Math.PI / 360) / Math.tan(local.currentFov() * Math.PI / 360);
    expect(zoom).toBeCloseTo(4, 8);
    Object.assign(local, { eye: new THREE.Vector3(5.05, 2, 8), viewEye: new THREE.Vector3(5, 2, 8), viewQuat: new THREE.Quaternion() });
    const camera = new THREE.PerspectiveCamera();
    local.camera(camera, 0.016);
    expect(camera.position.toArray()).toEqual([5, 2, 8]);
    local.camera(camera, 0, local.eye);
    expect(camera.position.toArray()).toEqual([5.05, 2, 8]);
    useLoadout.getState().equipOptic("ar", "red-dot");
    expect(local.scoped).toBe(false);
    expect(local.currentFov()).toBe(55);
  });
});
