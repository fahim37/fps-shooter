import * as THREE from "three";
import { CharacterRig } from "../player/CharacterRig";
import type { CharacterTemplate } from "../assets/characters";
import type { WeaponId } from "../../shared/weapons";
import { WEAPONS } from "../../shared/weapons";
import { F_ADS, F_CROUCH, F_GROUNDED, F_RELOADING, F_SPRINT } from "../../shared/messages";
import type { PlayerState } from "../../shared/schema";
import type { Pose } from "../../shared/hitboxes";
import { audio } from "./audio";
import { setEnemyReadability } from "../assets/readability";
import { isEmote } from "../../shared/showcase";

interface Snap {
  t: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  lean: number;
  flags: number;
  alive: boolean;
  emote: string;
}

/** One remote player: snapshot buffer, interpolation and its animated character. */
export class RemotePlayer {
  rig: CharacterRig | null = null;
  private snaps: Snap[] = [];
  team = -1;
  char = -1;
  /** Outfit tint as the local player sees this one: 1 ally (blue), 2 enemy (red). */
  private tint = -1;
  weapon: WeaponId = "ar";
  name = "";
  alive = false;
  protectedUntil = 0;
  /** Interpolated render pose (feet). */
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  lean = 0;
  flags = 0;
  emote = "idle";
  private vel = new THREE.Vector3();
  private reloadT = -1;
  private stepDist = 0;
  private speed = 0;
  recoil = 0;
  /** Seconds since this player last fired / drew the current gun, for the rig's handling. */
  private sinceShot = Infinity;
  private sinceDraw = Infinity;
  readonly head = new THREE.Vector3();
  /** Whether the character was posed this frame; off-screen ones skip animation and drawing. */
  posed = false;
  /** A footstep landed this frame (heard or not), and on which foot. */
  stepped = false;
  footLeft = false;
  private readable = false;
  /** Name over the head (teammates only), redrawn when the name changes. */
  private tag: THREE.Sprite | null = null;
  private tagName = "";
  private tagPx = 0;

  constructor(readonly id: string) {}

  /** Records a snapshot from the latest state patch. */
  push(t: number, p: PlayerState) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && last.t > t) return;
    if (last && last.t === t) {
      // Same tick, newer data: overwrite.
      Object.assign(last, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, lean: p.lean, flags: p.flags, alive: p.alive, emote: p.emote });
      return;
    }
    this.snaps.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, lean: p.lean, flags: p.flags, alive: p.alive, emote: p.emote });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  ensureRig(templates: [CharacterTemplate, CharacterTemplate], weapons: Map<WeaponId, THREE.Object3D>, tint: number, char: number, scene: THREE.Object3D) {
    if (this.rig && this.tint === tint && this.char === char) return;
    this.rig?.dispose();
    this.tint = tint;
    this.char = char;
    this.rig = new CharacterRig(templates[char === 1 ? 1 : 0], weapons, tint, char === 0 && hash(this.id) % 2 === 0, "tpp");
    this.readable = false;
    this.rig.setWeapon(this.weapon);
    scene.add(this.rig.object);
  }

  setWeapon(w: WeaponId) {
    if (w === this.weapon || !WEAPONS[w]) return;
    this.weapon = w;
    this.sinceDraw = 0;
    this.sinceShot = Infinity;
    this.rig?.setWeapon(w);
  }

  setReadability(enabled: boolean) {
    if (!this.rig || enabled === this.readable) return;
    setEnemyReadability(this.rig.inst.meshes, enabled);
    this.readable = enabled;
  }

  onShot() {
    this.recoil = 1;
    this.sinceShot = 0;
  }

  /** Running flat out: the sprint flag, or moving faster than a walk. */
  get sprinting() { return (this.flags & F_SPRINT) !== 0 || this.speed > 6.5; }

  /** Direction of travel (player yaw convention). */
  get moveYaw() { return Math.atan2(-this.vel.x, -this.vel.z); }

  /** Pose used for local hit prediction (what we see on screen). */
  pose(): Pose {
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, crouch: (this.flags & F_CROUCH) !== 0, yaw: this.yaw, lean: this.lean };
  }

  /** Interpolates the network pose and plays footsteps; `animate` then poses the character. */
  update(dt: number, renderTime: number, listener: THREE.Vector3) {
    this.stepped = false;
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
    const prev = _prev.copy(this.pos);
    if (renderTime <= s[0].t) {
      const first = s[0];
      this.pos.set(first.x, first.y, first.z);
      this.yaw = first.yaw;
      this.pitch = first.pitch;
      this.lean = first.lean;
      this.flags = first.flags;
      this.alive = first.alive;
      this.emote = first.emote;
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
      this.lean = last.lean;
      this.flags = last.flags;
      this.alive = last.alive;
      this.emote = last.emote;
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
      this.lean = src ? src.lean : a.lean + (b.lean - a.lean) * k;
      this.flags = a.flags;
      this.alive = a.alive;
      this.emote = a.emote;
    }

    if (dt > 0) {
      const v = prev.subVectors(this.pos, prev).divideScalar(dt);
      if (v.lengthSq() < 400) this.vel.lerp(v, Math.min(1, dt * 10));
      else this.vel.set(0, 0, 0);
    }
    const speed = this.speed = Math.hypot(this.vel.x, this.vel.z);
    const reloading = (this.flags & F_RELOADING) !== 0;
    if (reloading) this.reloadT = this.reloadT < 0 ? 0 : this.reloadT + dt / (WEAPONS[this.weapon].reloadMs / 1000);
    else this.reloadT = -1;
    this.recoil = Math.max(0, this.recoil - dt * 8);
    this.sinceShot += dt;
    this.sinceDraw += dt;

    // Footsteps for nearby players.
    if (this.alive && speed > 0.6 && (this.flags & F_GROUNDED)) {
      this.stepDist += speed * dt;
      if (this.stepDist > (speed > 6 ? 2.6 : 2.1)) {
        this.stepDist = 0;
        this.stepped = true;
        this.footLeft = !this.footLeft;
        if (this.pos.distanceTo(listener) < 30 && !(this.flags & F_CROUCH)) {
          audio.footstep(Math.abs(this.pos.z) < 3 || Math.abs(this.pos.x) < 3 || this.pos.y > 0.05, this.pos, 0.3);
        }
      }
    }
  }

  /**
   * Poses and shows the character. `inView` false (off-screen, casting no visible shadow) skips
   * animating and drawing it; a dying body keeps animating so its fall is never caught mid-way.
   */
  animate(dt: number, inView: boolean) {
    if (!this.rig || this.snaps.length === 0) return;
    const speed = this.speed;
    this.posed = inView || !this.alive;
    this.rig.setVisible(this.posed);
    if (this.posed) this.rig.update(Math.min(dt, 0.05), {
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      yaw: this.yaw, pitch: this.pitch, lean: this.alive ? this.lean : 0,
      speed, moveYaw: Math.atan2(-this.vel.x, -this.vel.z),
      crouch: (this.flags & F_CROUCH) !== 0,
      grounded: (this.flags & F_GROUNDED) !== 0 || speed < 0.1,
      alive: this.alive,
      sprint: (this.flags & F_SPRINT) ? 1 : 0,
      ads: (this.flags & F_ADS) ? 1 : 0,
      reload: this.reloadT >= 0 ? Math.min(this.reloadT, 1) : -1,
      recoil: this.recoil, sinceShot: this.sinceShot, sinceDraw: this.sinceDraw,
      emote: this.alive && isEmote(this.emote) ? this.emote : null,
    });
    const headBone = this.posed ? this.rig.inst?.bones.get("Head") : undefined;
    if (headBone) headBone.getWorldPosition(this.head).y += 0.1;
    else this.head.set(this.pos.x, this.pos.y + ((this.flags & F_CROUCH) ? 1.15 : 1.64), this.pos.z);
  }

  /** Shows this player's name above their head while `show` (a living teammate), hides it otherwise. */
  updateTag(scene: THREE.Object3D, show: boolean) {
    if (!show || !this.alive || !this.rig) { if (this.tag) this.tag.visible = false; return; }
    const px = nameTagPixels();
    if (!this.tag || this.tagName !== this.name || this.tagPx !== px) {
      this.disposeTag();
      this.tag = createNameTag(this.name, px);
      this.tagName = this.name;
      this.tagPx = px;
      scene.add(this.tag);
    }
    this.tag.visible = true;
    this.tag.position.copy(this.head).y += NAME_TAG_LIFT;
  }

  dispose() {
    this.rig?.dispose();
    this.rig = null;
    this.disposeTag();
  }

  private disposeTag() {
    if (!this.tag) return;
    this.tag.removeFromParent();
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
    this.tag = null;
  }
}

/** Metres above the head for a name tag, and its height as a share of the view at distance 1. */
const NAME_TAG_LIFT = 0.32;
const NAME_TAG_SIZE = 0.03;

/** The tag's height in screen pixels, so its texture can be drawn 1:1 (a scaled-down one blurs). */
function nameTagPixels(): number {
  return Math.max(12, Math.round(NAME_TAG_SIZE * 0.5 * window.innerHeight * (window.devicePixelRatio || 1)));
}

/**
 * A teammate's name, ally blue with a dark outline: the same size on screen at any distance and
 * drawn over walls, so you can always find your squad. Drawn at its on-screen pixel size, with no
 * mipmaps, fog or tone mapping, all of which washed it out.
 */
function createNameTag(name: string, px: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = px * 6;
  canvas.height = px;
  const g = canvas.getContext("2d")!;
  g.font = `700 ${Math.round(px * 0.6)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = Math.max(2, px * 0.14);
  g.strokeStyle = "#08101a";
  const text = name.length > 18 ? `${name.slice(0, 17)}…` : name;
  g.strokeText(text, canvas.width / 2, px * 0.54);
  g.fillStyle = "#b9ddff";
  g.fillText(text, canvas.width / 2, px * 0.54);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false, toneMapped: false }));
  sprite.center.set(0.5, 0);
  sprite.scale.set(NAME_TAG_SIZE * (canvas.width / canvas.height), NAME_TAG_SIZE, 1);
  sprite.renderOrder = 8;
  return sprite;
}

const _prev = new THREE.Vector3();

function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
