import * as THREE from "three";
import { CharacterRig } from "../player/CharacterRig";
import type { CharacterTemplate } from "../assets/characters";
import type { WeaponId } from "../../shared/weapons";
import { WEAPONS } from "../../shared/weapons";
import { F_ADS, F_CROUCH, F_GROUNDED, F_RELOADING, F_SPRINT } from "../../shared/messages";
import type { PlayerState } from "../../shared/schema";
import type { Pose } from "../../shared/hitboxes";
import { audio } from "./audio";

interface Snap {
  t: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  flags: number;
  alive: boolean;
}

/** One remote player: snapshot buffer, interpolation and its animated character. */
export class RemotePlayer {
  rig: CharacterRig | null = null;
  private snaps: Snap[] = [];
  team = -1;
  char = -1;
  weapon: WeaponId = "ar";
  name = "";
  alive = false;
  protectedUntil = 0;
  /** Interpolated render pose (feet). */
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  flags = 0;
  private vel = new THREE.Vector3();
  private reloadT = -1;
  private stepDist = 0;
  recoil = 0;
  readonly head = new THREE.Vector3();

  constructor(readonly id: string) {}

  /** Records a snapshot from the latest state patch. */
  push(t: number, p: PlayerState) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && last.t > t) return;
    if (last && last.t === t) {
      // Same tick, newer data: overwrite.
      Object.assign(last, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, flags: p.flags, alive: p.alive });
      return;
    }
    this.snaps.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, flags: p.flags, alive: p.alive });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  ensureRig(templates: [CharacterTemplate, CharacterTemplate], weapons: Map<WeaponId, THREE.Object3D>, team: number, char: number, scene: THREE.Object3D) {
    if (this.rig && this.team === team && this.char === char) return;
    this.rig?.dispose();
    this.team = team;
    this.char = char;
    this.rig = new CharacterRig(templates[char === 1 ? 1 : 0], weapons, team, char === 0 && hash(this.id) % 2 === 0, "tpp");
    this.rig.setWeapon(this.weapon);
    scene.add(this.rig.object);
  }

  setWeapon(w: WeaponId) {
    if (w === this.weapon || !WEAPONS[w]) return;
    this.weapon = w;
    this.rig?.setWeapon(w);
  }

  onShot() {
    this.recoil = 1;
  }

  /** Pose used for local hit prediction (what we see on screen). */
  pose(): Pose {
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, crouch: (this.flags & F_CROUCH) !== 0 };
  }

  update(dt: number, renderTime: number, listener: THREE.Vector3) {
    const s = this.snaps;
    if (s.length === 0 || !this.rig) return;
    let a = s[0], b = s[s.length - 1];
    if (renderTime <= a.t) {
      b = a;
    } else {
      for (let i = s.length - 1; i >= 1; i--) {
        if (s[i - 1].t <= renderTime) { a = s[i - 1]; b = s[i]; break; }
      }
    }
    const prev = this.pos.clone();
    if (renderTime <= s[0].t) {
      const first = s[0];
      this.pos.set(first.x, first.y, first.z);
      this.yaw = first.yaw;
      this.pitch = first.pitch;
      this.flags = first.flags;
      this.alive = first.alive;
    } else if (renderTime >= b.t) {
      // Past the newest snapshot: extrapolate briefly, then hold.
      const last = s[s.length - 1];
      const before = s[s.length - 2];
      const ahead = Math.min(renderTime - last.t, 120) / 1000;
      if (before && ahead > 0 && last.alive && before.alive && Math.hypot(last.x - before.x, last.y - before.y, last.z - before.z) < 4) {
        const dtS = (last.t - before.t) / 1000 || 1;
        this.pos.set(
          last.x + ((last.x - before.x) / dtS) * ahead,
          last.y,
          last.z + ((last.z - before.z) / dtS) * ahead,
        );
      } else this.pos.set(last.x, last.y, last.z);
      this.yaw = last.yaw;
      this.pitch = last.pitch;
      this.flags = last.flags;
      this.alive = last.alive;
    } else {
      const k = (renderTime - a.t) / (b.t - a.t);
      const teleport = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 4 || a.alive !== b.alive;
      const src = teleport ? a : null;
      this.pos.set(
        src ? src.x : a.x + (b.x - a.x) * k,
        src ? src.y : a.y + (b.y - a.y) * k,
        src ? src.z : a.z + (b.z - a.z) * k,
      );
      this.yaw = src ? src.yaw : a.yaw + wrap(b.yaw - a.yaw) * k;
      this.pitch = src ? src.pitch : a.pitch + (b.pitch - a.pitch) * k;
      this.flags = a.flags;
      this.alive = a.alive;
    }

    if (dt > 0) {
      const v = this.pos.clone().sub(prev).divideScalar(dt);
      if (v.lengthSq() < 400) this.vel.lerp(v, Math.min(1, dt * 10));
      else this.vel.set(0, 0, 0);
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const reloading = (this.flags & F_RELOADING) !== 0;
    if (reloading) this.reloadT = this.reloadT < 0 ? 0 : this.reloadT + dt / (WEAPONS[this.weapon].reloadMs / 1000);
    else this.reloadT = -1;
    this.recoil = Math.max(0, this.recoil - dt * 8);

    this.rig.update(Math.min(dt, 0.05), {
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      yaw: this.yaw, pitch: this.pitch,
      speed, moveYaw: Math.atan2(-this.vel.x, -this.vel.z),
      crouch: (this.flags & F_CROUCH) !== 0,
      grounded: (this.flags & F_GROUNDED) !== 0 || speed < 0.1,
      alive: this.alive,
      sprint: (this.flags & F_SPRINT) ? 1 : 0,
      ads: (this.flags & F_ADS) ? 1 : 0,
      reload: this.reloadT >= 0 ? Math.min(this.reloadT, 1) : -1,
      recoil: this.recoil,
    });
    const headBone = this.rig.inst?.bones.get("Head");
    if (headBone) headBone.getWorldPosition(this.head).y += 0.1;
    else this.head.set(this.pos.x, this.pos.y + ((this.flags & F_CROUCH) ? 1.15 : 1.64), this.pos.z);

    // Footsteps for nearby players.
    if (this.alive && speed > 0.6 && (this.flags & F_GROUNDED)) {
      this.stepDist += speed * dt;
      if (this.stepDist > (speed > 6 ? 2.6 : 2.1)) {
        this.stepDist = 0;
        if (this.pos.distanceTo(listener) < 30 && !(this.flags & F_CROUCH)) {
          audio.footstep(Math.abs(this.pos.z) < 3 || Math.abs(this.pos.x) < 3 || this.pos.y > 0.05, this.pos, 0.3);
        }
      }
    }
  }

  dispose() {
    this.rig?.dispose();
    this.rig = null;
  }
}

function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
