import * as THREE from "three";
import { Mover, newMoveState, type MoveState } from "../../shared/movement";
import { raycastWorld, type Rapier, type World } from "../../shared/physics";
import { aimDir, spreadDir, zoomSensitivity } from "../../shared/aim";
import { WEAPONS, GRENADE, currentSpread, fireIntervalMs, type WeaponId } from "../../shared/weapons";
import { EYE_HEIGHT, CROUCH_EYE_HEIGHT, GRENADES_PER_LIFE, INTERP_DELAY_MS } from "../../shared/constants";
import { F_ADS, F_CROUCH, F_GROUNDED, F_RELOADING, F_SPRINT, type AmmoEvent, type PoseMsg, type SpawnEvent } from "../../shared/messages";
import type { Input } from "./input";
import type { Game } from "./game";
import { useSettings } from "../settings";
import { audio } from "./audio";
import { ShotCadence } from "./cadence";

type V3 = [number, number, number];

const SEND_INTERVAL = 1000 / 30;
const STEP = 1 / 120;

/** Paved surfaces (roads, plaza) for footstep sounds. */
function onStone(x: number, z: number, y: number) {
  return y > 0.05 || Math.abs(x) < 12 && Math.abs(z) < 12 || Math.abs(z) < 3 || Math.abs(x) < 3;
}

export class LocalPlayer {
  readonly ms: MoveState;
  private mover: Mover;
  yaw = 0;
  pitch = 0;
  /** Recoverable view kick (radians) layered on top of yaw/pitch. */
  private kickPitch = 0;
  private kickYaw = 0;
  /** Viewmodel kick 0..1. */
  recoil = 0;
  weapon: WeaponId = "ar";
  primary: WeaponId = "ar";
  ammo = {} as Record<WeaponId, { mag: number; reserve: number }>;
  reloadStart = 0;
  reloadEnd = 0;
  switchEnd = 0;
  private cadence = new ShotCadence();
  private shotSeq = 0;
  private pendingShots: { shot: number; weapon: WeaponId }[] = [];
  private triggerReleased = true;
  private sprintBlockUntil = 0;
  private burst = 0;
  ads = 0;
  private adsProgress = 0;
  crouchT = 0;
  grenades = GRENADES_PER_LIFE;
  private cookStart = 0;
  throwAnim = 0;
  alive = false;
  thirdPerson = false;
  private sendAt = 0;
  private pendingLand = 0;
  private landDip = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private stepDist = 0;
  private swayX = 0;
  private swayY = 0;
  tuck = 0;
  private acc = 0;
  readonly eye = new THREE.Vector3();
  readonly viewQuat = new THREE.Quaternion();
  readonly bob = new THREE.Vector2();
  readonly sway = new THREE.Vector2();
  private tppDist = 2.6;

  constructor(private game: Game, private R: Rapier, private world: World) {
    this.ms = newMoveState(0, 0, 0);
    this.mover = new Mover(R, world);
    this.resetAmmo();
  }

  dispose() {
    this.mover.dispose();
  }

  private resetAmmo() {
    for (const w of Object.values(WEAPONS)) this.ammo[w.id] = { mag: w.mag, reserve: w.reserve };
  }

  get def() {
    return WEAPONS[this.weapon];
  }

  get reloading() {
    return this.reloadEnd > 0;
  }

  get reloadProgress() {
    if (!this.reloadEnd) return -1;
    return Math.min(1, (performance.now() - this.reloadStart) / (this.reloadEnd - this.reloadStart));
  }

  spawn(ev: SpawnEvent) {
    this.mover.teleport(this.ms, ev.x, ev.y, ev.z);
    this.yaw = ev.yaw;
    this.pitch = 0;
    this.kickPitch = this.kickYaw = 0;
    this.primary = ev.primary;
    this.weapon = ev.primary;
    this.resetAmmo();
    this.grenades = GRENADES_PER_LIFE;
    this.pendingShots = [];
    this.reloadEnd = 0;
    this.switchEnd = performance.now() + 300;
    this.cookStart = 0;
    this.alive = true;
    this.ads = this.adsProgress = 0;
    this.sendAt = 0;
    this.acc = this.pendingLand = this.landDip = this.crouchT = this.recoil = this.burst = 0;
    this.cadence.reset();
    this.sprintBlockUntil = this.stepDist = 0;
    this.triggerReleased = true;
    this.updateView();
  }

  /** Server rejected our position (moved too fast): snap back. */
  correct(x: number, y: number, z: number) {
    this.mover.teleport(this.ms, x, y, z);
  }

  die() {
    this.alive = false;
    this.reloadEnd = 0;
    this.cookStart = 0;
  }

  cancelActions() {
    // Opening a menu or editing the HUD must not turn a held grenade into a throw.
    this.cookStart = 0;
    this.triggerReleased = true;
  }

  onKillScavenge() {
    const a = this.ammo[this.weapon];
    a.reserve = Math.min(this.def.reserve * 2, a.reserve + this.def.mag);
  }

  reconcileAmmo(ev: AmmoEvent) {
    this.pendingShots = this.pendingShots.filter((p) => p.shot > ev.shot);
    const pending = this.pendingShots.filter((p) => p.weapon === ev.weapon).length;
    this.ammo[ev.weapon] = { mag: Math.max(0, ev.mag - pending), reserve: ev.reserve };
  }

  update(dt: number, input: Input, now: number) {
    const s = useSettings.getState();

    // ---- look
    const [lx, ly] = input.consumeLook();
    const sens = 0.0022 * s.sensitivity * zoomSensitivity(s.fov, this.currentFov(), this.ads, s.adsSensitivity);
    const touchScale = input.touch ? 2.2 : 1;
    this.yaw -= lx * sens * touchScale;
    this.pitch -= ly * sens * touchScale * (s.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
    // Weapon sway lags behind fast mouse movement.
    this.swayX += (THREE.MathUtils.clamp(-lx * 0.0004, -0.03, 0.03) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (THREE.MathUtils.clamp(ly * 0.0004, -0.03, 0.03) - this.swayY) * Math.min(1, dt * 10);

    if (!this.alive) {
      input.endFrame();
      return;
    }

    // ---- actions
    if (input.consume("KeyV")) {
      this.thirdPerson = !this.thirdPerson;
      useSettings.getState().set({ thirdPerson: this.thirdPerson });
    }
    if (input.consume("Digit1") && this.weapon !== this.primary) this.switchTo(this.primary, now);
    if (input.consume("Digit2") && this.weapon !== "pistol") this.switchTo("pistol", now);
    if (input.consume("KeyQ") || input.consume("WheelUp") || input.consume("WheelDown")) {
      this.switchTo(this.weapon === "pistol" ? this.primary : "pistol", now);
    }
    const def = this.def;
    if (input.consume("KeyR")) this.startReload(now);

    // Grenade: hold G to cook, release to throw.
    if (input.consume("KeyG") && this.grenades > 0 && !this.cookStart) this.cookStart = now;
    if (this.cookStart && (!input.held("KeyG") && !input.held("TouchGrenade") || now - this.cookStart > GRENADE.fuseMs - 300)) {
      this.throwGrenade(now);
    }
    this.throwAnim = Math.max(0, this.throwAnim - dt * 3);

    // Reload completion.
    if (this.reloadEnd && now >= this.reloadEnd) {
      const a = this.ammo[this.weapon];
      const take = Math.min(def.mag - a.mag, a.reserve);
      a.mag += take;
      a.reserve -= take;
      this.reloadEnd = 0;
    }

    // ---- movement (fixed substeps for stable collision)
    const [fwd, right] = input.axes();
    const wasSprinting = this.ms.sprinting;
    const wantsSprint = input.sprint && now > this.sprintBlockUntil && !input.fire && !input.ads;
    const adsHeld = input.ads;
    this.acc += Math.min(dt, 0.1);
    const wasGrounded = this.ms.grounded;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.mover.step(this.ms, {
        forward: fwd, right, yaw: this.yaw, jump: input.jump, crouch: input.crouch, sprint: wantsSprint,
        ads: this.ads, speedMult: def.moveMult,
      }, STEP);
    }
    if (wasSprinting && input.fire) this.switchEnd = Math.max(this.switchEnd, now + 150);
    if (this.ms.landSpeed > 0) {
      if (!wasGrounded || this.ms.landSpeed > 4) {
        this.landDip = Math.min(0.16, this.ms.landSpeed * 0.012);
        audio.land(Math.min(1, this.ms.landSpeed / 10));
      }
      this.pendingLand = Math.max(this.pendingLand, this.ms.landSpeed);
      this.ms.landSpeed = 0;
    }
    this.landDip = Math.max(0, this.landDip - dt * 0.6);
    this.crouchT += ((input.crouch ? 1 : 0) - this.crouchT) * Math.min(1, dt * 12);

    // ---- ADS
    const adsTarget = adsHeld && !this.reloading && now > this.switchEnd ? 1 : 0;
    const adsRate = 1000 / def.adsMs;
    this.adsProgress = THREE.MathUtils.clamp(this.adsProgress + Math.sign(adsTarget - this.adsProgress) * adsRate * dt, 0, 1);
    this.ads = THREE.MathUtils.smoothstep(this.adsProgress, 0, 1);

    // ---- fire
    if (!input.fire) {
      this.triggerReleased = true;
      this.burst = Math.max(0, this.burst - dt * 8);
    }
    this.updateView();
    if (input.fire) this.tryFire(now);

    // ---- recoil recovery
    const rec = Math.exp(-dt * 7);
    this.kickPitch *= rec;
    this.kickYaw *= rec;
    this.recoil = Math.max(0, this.recoil - dt * 9);

    // ---- bob / footsteps
    const speed = Math.hypot(this.ms.vx, this.ms.vz);
    const moving = this.ms.grounded && speed > 0.5;
    this.bobAmount += ((moving ? Math.min(1, speed / 6) : 0) - this.bobAmount) * Math.min(1, dt * 8);
    this.bobPhase += dt * (moving ? 5 + speed * 1.2 : 2);
    const bobScale = (1 - this.ads * 0.85) * this.bobAmount;
    this.bob.set(Math.cos(this.bobPhase) * 0.012 * bobScale, -Math.abs(Math.sin(this.bobPhase)) * 0.014 * bobScale);
    this.sway.set(this.swayX * (1 - this.ads * 0.7), this.swayY * (1 - this.ads * 0.7));
    if (moving) {
      this.stepDist += speed * dt;
      const stride = this.ms.sprinting ? 2.6 : input.crouch ? 1.4 : 2.1;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        audio.footstep(onStone(this.ms.x, this.ms.z, this.ms.y), undefined, input.crouch ? 0.07 : this.ms.sprinting ? 0.22 : 0.15);
      }
    }

    this.updateView();

    // Pull the gun back when facing a wall closely (FPP).
    const hit = raycastWorld(this.R, this.world, [this.eye.x, this.eye.y, this.eye.z], this.forwardArr(), 1);
    this.tuck += ((hit && hit.distance < 0.75 ? 1 - hit.distance / 0.75 : 0) - this.tuck) * Math.min(1, dt * 10);

    // ---- network
    if (now >= this.sendAt) {
      this.sendAt = now + SEND_INTERVAL;
      this.sendPose();
    }
    input.endFrame();
  }

  private forwardArr(): V3 {
    return aimDir(this.yaw + this.kickYaw, this.pitch + this.kickPitch);
  }

  updateView() {
    const eyeH = EYE_HEIGHT + (CROUCH_EYE_HEIGHT - EYE_HEIGHT) * this.crouchT;
    this.eye.set(this.ms.x, this.ms.y + eyeH - this.landDip + this.bob.y * 0.4, this.ms.z);
    this.viewQuat.setFromEuler(new THREE.Euler(this.pitch + this.kickPitch, this.yaw + this.kickYaw, 0, "YXZ"));
  }

  currentFov() {
    const base = useSettings.getState().fov;
    const def = this.def;
    const target = def.scope ? def.adsFov : Math.min(base, def.adsFov + (base - 78));
    return base + (target - base) * this.ads;
  }

  get scoped() {
    return this.def.scope === true && this.ads > 0.7 && this.alive && !this.thirdPerson;
  }

  /** Where the camera sits and looks (FPP eye, or over-the-shoulder in TPP). */
  camera(cam: THREE.PerspectiveCamera, dt: number) {
    if (!this.thirdPerson) {
      cam.position.copy(this.eye);
      cam.quaternion.copy(this.viewQuat);
      return;
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.viewQuat);
    const rightV = new THREE.Vector3(1, 0, 0).applyQuaternion(this.viewQuat);
    const pivot = this.eye.clone().addScaledVector(rightV, 0.55 - this.ads * 0.1);
    pivot.y += 0.12;
    const shoulder = pivot.clone().sub(this.eye);
    const shoulderLength = shoulder.length();
    shoulder.normalize();
    const shoulderHit = raycastWorld(this.R, this.world, this.eye.toArray() as V3, shoulder.toArray() as V3, shoulderLength + 0.15);
    if (shoulderHit) pivot.copy(this.eye).addScaledVector(shoulder, Math.max(0, shoulderHit.distance - 0.15));
    const want = 2.6 - this.ads * 1.2;
    const back = fwd.clone().negate();
    const hit = raycastWorld(this.R, this.world, [pivot.x, pivot.y, pivot.z], [back.x, back.y, back.z], want + 0.3);
    const allowed = hit ? Math.max(0, hit.distance - 0.3) : want;
    // Snap in when blocked, ease out when clear.
    this.tppDist = allowed < this.tppDist ? allowed : this.tppDist + (allowed - this.tppDist) * Math.min(1, dt * 4);
    cam.position.copy(pivot).addScaledVector(back, this.tppDist);
    cam.quaternion.copy(this.viewQuat);
  }

  private switchTo(w: WeaponId, now: number) {
    if (w === this.weapon) return;
    this.weapon = w;
    this.reloadEnd = 0;
    this.switchEnd = now + WEAPONS[w].equipMs;
    this.adsProgress = this.ads = 0;
    this.cadence.reset();
    this.sendPose();
    audio.switchWeapon();
  }

  startReload(now: number) {
    const a = this.ammo[this.weapon];
    if (this.reloading || a.mag >= this.def.mag || a.reserve <= 0 || now < this.switchEnd) return;
    this.reloadStart = now;
    this.reloadEnd = now + this.def.reloadMs;
    this.sendPose();
    this.game.send("reload", {});
    audio.reload(this.def.reloadMs / 1000);
  }

  private tryFire(now: number) {
    const def = this.def;
    if (now < this.switchEnd || this.reloading || this.cookStart) return;
    if (!def.auto && !this.triggerReleased) return;
    const interval = fireIntervalMs(def);
    if (!this.cadence.ready(now, interval)) return;
    if (this.game.matchEnded) return;
    const a = this.ammo[this.weapon];
    if (a.mag <= 0) {
      if (this.triggerReleased) audio.dryFire();
      this.triggerReleased = false;
      this.startReload(now);
      return;
    }
    this.triggerReleased = false;
    this.cadence.record(now, interval, def.auto);
    this.sprintBlockUntil = now + 250;
    a.mag--;

    const eye: V3 = [this.eye.x, this.eye.y, this.eye.z];
    let aim = aimDir(this.yaw + this.kickYaw, this.pitch + this.kickPitch);
    if (this.thirdPerson) {
      this.camera(this.game.camera, 0);
      // Aim where the crosshair points from the camera, but fire from the character's eye.
      const cam = this.game.camera.position;
      const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.game.camera.quaternion);
      const target = this.game.traceFrom([cam.x, cam.y, cam.z], [camDir.x, camDir.y, camDir.z], def.range, true).point;
      const d = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      aim = [d[0] / l, d[1] / l, d[2] / l];
    }
    const cone = this.spread;
    const dirs = Array.from({ length: def.pellets }, () => spreadDir(aim, cone));
    this.sendPose();
    const shot = ++this.shotSeq;
    this.pendingShots.push({ shot, weapon: this.weapon });
    this.game.send("fire", { weapon: this.weapon, shot, viewTime: this.game.clock.now() - INTERP_DELAY_MS, origin: eye, dirs });
    this.game.onLocalShot(this.weapon, eye, dirs);

    // Recoil: part of the kick stays (the gun climbs), the rest recovers.
    const damp = (1 - this.ads * 0.45) * (this.crouchT > 0.5 ? 0.85 : 1);
    const up = ((def.recoilUp * Math.PI) / 180) * damp * (0.9 + Math.random() * 0.2);
    const side = ((def.recoilSide * Math.PI) / 180) * damp * (Math.random() * 2 - 1) * 0.7;
    this.pitch = THREE.MathUtils.clamp(this.pitch + up * 0.25, -1.5, 1.5);
    this.yaw += side * 0.25;
    this.kickPitch += up * 0.75;
    this.kickYaw += side * 0.75;
    this.recoil = 1;
    this.burst++;
  }

  private throwGrenade(now: number) {
    const cooked = now - this.cookStart;
    this.cookStart = 0;
    if (this.grenades <= 0) return;
    this.grenades--;
    this.throwAnim = 1;
    const dir = aimDir(this.yaw, this.pitch + 0.12);
    this.game.send("grenade", { origin: [this.eye.x, this.eye.y - 0.1, this.eye.z], dir, cooked });
    audio.grenadeThrow();
  }

  get cooking() {
    return this.cookStart > 0;
  }

  /** Shared by firing and the HUD so the displayed cone includes burst bloom. */
  get spread() {
    const moving = Math.min(1, Math.hypot(this.ms.vx, this.ms.vz) / 5);
    return currentSpread(this.def, this.ads, moving, !this.ms.grounded, this.crouchT > 0.5)
      * (1 + Math.min(this.burst, 6) * 0.06);
  }

  private sendPose() {
    const flags = (this.crouchT > 0.5 ? F_CROUCH : 0) | (this.ads > 0.5 ? F_ADS : 0) | (this.ms.sprinting ? F_SPRINT : 0)
      | (this.ms.grounded ? F_GROUNDED : 0) | (this.reloading ? F_RELOADING : 0);
    const msg: PoseMsg = {
      x: round(this.ms.x), y: round(this.ms.y), z: round(this.ms.z),
      yaw: round(this.yaw), pitch: round(this.pitch),
      vx: round(this.ms.vx), vy: round(this.ms.vy), vz: round(this.ms.vz),
      flags, weapon: this.weapon,
    };
    if (this.pendingLand > 0) {
      msg.land = round(this.pendingLand);
      this.pendingLand = 0;
    }
    this.game.send("pose", msg);
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
