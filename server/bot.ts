import { Mover, newMoveState, type MoveState } from "../game/shared/movement";
import { lineOfSight } from "../game/shared/physics";
import { aimDir, lookAt, spreadDir, angleBetween } from "../game/shared/aim";
import { WEAPONS, currentSpread, fireIntervalMs, type WeaponId } from "../game/shared/weapons";
import { F_CROUCH, F_ADS, F_SPRINT, F_GROUNDED, F_RELOADING } from "../game/shared/messages";
import type { SpawnPoint } from "../game/shared/map/types";
import { RAPIER, getNav } from "./world";
import type { MatchRoom, ServerPlayer } from "./MatchRoom";

type V3 = [number, number, number];

export const BOT_NAMES = [
  "Aldric", "Brenna", "Cedric", "Dagny", "Edric", "Fenna", "Garrick", "Hilda", "Isolde", "Jorah",
  "Kestrel", "Leoric", "Maren", "Nolan", "Osric", "Perrin", "Quill", "Rowena", "Sigrid", "Tobin",
  "Ulric", "Vesna", "Wystan", "Yara", "Zorin",
];

/** Per-skill tuning: easy / normal / hard. */
const SKILL = [
  { reactionMs: 750, aimErrorDeg: 5.5, turnRate: 3.2, fireAngleDeg: 9, burstMs: 500, viewDist: 45 },
  { reactionMs: 420, aimErrorDeg: 2.6, turnRate: 5.5, fireAngleDeg: 5, burstMs: 800, viewDist: 60 },
  { reactionMs: 230, aimErrorDeg: 1.2, turnRate: 9, fireAngleDeg: 3, burstMs: 1200, viewDist: 80 },
];

const PREFERRED_RANGE: Record<WeaponId, number> = { shotgun: 5, smg: 11, ar: 18, sniper: 32, pistol: 12 };

/**
 * Server-side bot: perceives enemies with line-of-sight checks, navigates the navmesh, and
 * shoots through the same `room.fire` path as human players (no special hit rules).
 */
export class Bot {
  private mover: Mover;
  private ms: MoveState;
  private path: V3[] = [];
  private pathIdx = 0;
  private repathAt = 0;
  private goal: V3 | null = null;
  private target: ServerPlayer | null = null;
  private targetVisible = false;
  private firstSeenAt = 0;
  private lastSeenAt = 0;
  private lastKnown: V3 | null = null;
  private yaw = 0;
  private pitch = 0;
  private errYaw = 0;
  private errPitch = 0;
  private errAt = 0;
  private strafe = 1;
  private strafeUntil = 0;
  private crouchUntil = 0;
  private burstUntil = 0;
  private pauseUntil = 0;
  private thinkAt = 0;
  private stuckT = 0;
  private lastPos: V3 = [0, 0, 0];
  private jump = false;
  private nextGrenadeAt = 0;

  constructor(private room: MatchRoom, private p: ServerPlayer) {
    this.mover = new Mover(RAPIER, room.world);
    this.ms = newMoveState(0, 0, 0);
  }

  dispose() {
    this.mover.dispose();
  }

  onSpawn(sp: SpawnPoint) {
    this.mover.teleport(this.ms, sp.x, sp.y, sp.z);
    this.yaw = sp.yaw;
    this.pitch = 0;
    this.target = null;
    this.lastKnown = null;
    this.path = [];
    this.goal = null;
    this.nextGrenadeAt = Date.now() + 8000 + Math.random() * 10000;
  }

  onDamaged(attacker: ServerPlayer | null) {
    if (!attacker || attacker === this.p) return;
    if (!this.target || !this.targetVisible) {
      this.target = attacker;
      this.lastKnown = [attacker.st.x, attacker.st.y, attacker.st.z];
      this.lastSeenAt = Date.now();
      this.repathAt = 0;
    }
  }

  private get skill() {
    return SKILL[this.room.botSkill];
  }

  update(dt: number, t: number) {
    const st = this.p.st;
    if (!st.alive) return;
    const eye = this.room.eyePos(this.p);
    const weapon = st.weapon as WeaponId;
    const def = WEAPONS[weapon];

    if (t >= this.thinkAt) {
      this.thinkAt = t + 120;
      this.perceive(t, eye);
    }

    // ---- movement goal
    let moveTo: V3 | null = null;
    let wantStrafe = false;
    if (this.target && this.targetVisible) {
      const d = dist2d(this.target.st, st);
      const pref = PREFERRED_RANGE[weapon];
      if (d > pref + 6) moveTo = [this.target.st.x, this.target.st.y, this.target.st.z];
      else wantStrafe = true;
    } else if (this.lastKnown && t - this.lastSeenAt < 7000) {
      moveTo = this.lastKnown;
    }
    if (!moveTo) {
      if (!this.goal || dist2d(pointObj(this.goal), st) < 2 || t > this.repathAt + 20000) this.goal = this.pickRoamGoal();
      moveTo = this.goal;
    }
    if (moveTo && (t >= this.repathAt || this.pathIdx >= this.path.length)) {
      this.path = this.computePath([st.x, st.y, st.z], moveTo);
      this.pathIdx = 0;
      this.repathAt = t + (this.targetVisible ? 900 : 2500);
    }

    // Follow the path.
    let mx = 0, mz = 0;
    if (!wantStrafe && this.pathIdx < this.path.length) {
      let wp = this.path[this.pathIdx];
      while (Math.hypot(wp[0] - st.x, wp[2] - st.z) < 0.7 && this.pathIdx < this.path.length - 1) wp = this.path[++this.pathIdx];
      const dx = wp[0] - st.x, dz = wp[2] - st.z, l = Math.hypot(dx, dz);
      if (l > 0.3) { mx = dx / l; mz = dz / l; } else this.pathIdx++;
    }
    if (wantStrafe || (this.targetVisible && Math.random() < 0.02)) {
      if (t > this.strafeUntil) {
        this.strafe = Math.random() < 0.5 ? -1 : 1;
        this.strafeUntil = t + 500 + Math.random() * 1200;
        if (Math.random() < 0.25) this.crouchUntil = t + 800 + Math.random() * 1200;
      }
      const f = aimDir(this.yaw, 0);
      mx += -f[2] * this.strafe * 0.9;
      mz += f[0] * this.strafe * 0.9;
    }

    // Unstick: no progress while trying to move → jump and repath.
    const moved = Math.hypot(st.x - this.lastPos[0], st.z - this.lastPos[2]);
    this.lastPos = [st.x, st.y, st.z];
    if ((mx || mz) && moved < 0.02) {
      this.stuckT += dt;
      if (this.stuckT > 0.7) { this.jump = true; this.repathAt = 0; this.stuckT = 0; this.goal = null; }
    } else this.stuckT = 0;

    // ---- aiming
    let desiredYaw = this.yaw, desiredPitch = 0;
    if (this.target && this.targetVisible) {
      if (t > this.errAt) {
        this.errAt = t + 350;
        const e = (this.skill.aimErrorDeg * Math.PI) / 180;
        this.errYaw = (Math.random() * 2 - 1) * e;
        this.errPitch = (Math.random() * 2 - 1) * e * 0.6;
      }
      const tgt = this.target.st;
      const aimY = tgt.y + ((tgt.flags & F_CROUCH) ? 0.95 : 1.3) + (Math.random() < 0.15 ? 0.3 : 0);
      const la = lookAt(eye, [tgt.x, aimY, tgt.z]);
      desiredYaw = la.yaw + this.errYaw;
      desiredPitch = la.pitch + this.errPitch;
    } else if (mx || mz) {
      desiredYaw = Math.atan2(-mx, -mz);
    } else if (this.lastKnown) {
      desiredYaw = lookAt(eye, this.lastKnown).yaw;
    }
    const turn = this.skill.turnRate * dt;
    this.yaw += clampAngle(wrap(desiredYaw - this.yaw), turn);
    this.pitch += Math.max(-turn, Math.min(turn, desiredPitch - this.pitch));

    // ---- shooting
    const ammo = this.p.ammo[weapon];
    const reloading = this.p.reloadingUntil > 0;
    if (ammo.mag === 0 && !reloading) this.room.reload(this.p);
    const ads = this.targetVisible && weapon !== "shotgun" ? 1 : 0;
    if (this.target && this.targetVisible && !reloading && ammo.mag > 0 && t - this.firstSeenAt > this.skill.reactionMs) {
      const want = lookAt(eye, [this.target.st.x, this.target.st.y + 1.2, this.target.st.z]);
      const off = angleBetween(aimDir(this.yaw, this.pitch), aimDir(want.yaw, want.pitch));
      if (t > this.burstUntil && t > this.pauseUntil) {
        this.burstUntil = t + this.skill.burstMs * (0.6 + Math.random() * 0.8);
        this.pauseUntil = this.burstUntil + 250 + Math.random() * 500;
      }
      const inBurst = t < this.burstUntil;
      if (inBurst && off < (this.skill.fireAngleDeg * Math.PI) / 180 && t - this.p.lastFireAt >= fireIntervalMs(def) * (def.auto ? 1 : 1.6)) {
        const moving = Math.hypot(this.ms.vx, this.ms.vz) / 5;
        const cone = currentSpread(def, ads, Math.min(1, moving), !this.ms.grounded, t < this.crouchUntil);
        const dir = aimDir(this.yaw, this.pitch);
        const dirs = Array.from({ length: def.pellets }, () => spreadDir(dir, cone));
        this.room.fire(this.p, { weapon, viewTime: t, origin: eye, dirs });
      }
    }

    // Grenade at a target hiding behind cover.
    if (!this.targetVisible && this.lastKnown && t - this.lastSeenAt < 2500 && t > this.nextGrenadeAt && this.p.grenades > 0) {
      const d = Math.hypot(this.lastKnown[0] - st.x, this.lastKnown[2] - st.z);
      if (d > 8 && d < 24) {
        const la = lookAt(eye, this.lastKnown);
        const dir = aimDir(la.yaw, Math.min(0.9, la.pitch + 0.25 + d * 0.012));
        this.room.throwGrenade(this.p, { origin: eye, dir, cooked: 600 });
        this.nextGrenadeAt = t + 12000 + Math.random() * 12000;
      }
    }

    // ---- move
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const forward = -sin * mx - cos * mz;
    const right = cos * mx - sin * mz;
    const crouch = t < this.crouchUntil;
    this.mover.step(this.ms, {
      forward, right, yaw: this.yaw, jump: this.jump, crouch,
      sprint: !this.targetVisible && forward > 0.7 && !!this.path.length,
      ads, speedMult: def.moveMult,
    }, dt);
    this.jump = false;

    st.x = this.ms.x; st.y = this.ms.y; st.z = this.ms.z;
    st.yaw = this.yaw; st.pitch = this.pitch;
    st.flags = (crouch ? F_CROUCH : 0) | (ads ? F_ADS : 0) | (this.ms.sprinting ? F_SPRINT : 0)
      | (this.ms.grounded ? F_GROUNDED : 0) | (reloading ? F_RELOADING : 0);
    this.p.vel = [this.ms.vx, this.ms.vy, this.ms.vz];
  }

  private perceive(t: number, eye: V3) {
    const st = this.p.st;
    const facing = aimDir(this.yaw, 0);
    let best: ServerPlayer | null = null, bestScore = Infinity;
    for (const o of this.room.players.values()) {
      if (o === this.p || !o.st.alive || !this.room.canDamage(this.p, o)) continue;
      const dx = o.st.x - st.x, dz = o.st.z - st.z;
      const d = Math.hypot(dx, dz);
      if (d > this.skill.viewDist) continue;
      // Field of view ~150°, unless it's the current target or very close.
      const dot = (dx * facing[0] + dz * facing[2]) / (d || 1);
      if (dot < -0.25 && o !== this.target && d > 6) continue;
      const seen = lineOfSight(RAPIER, this.room.world, eye, [o.st.x, o.st.y + 1.45, o.st.z])
        || lineOfSight(RAPIER, this.room.world, eye, [o.st.x, o.st.y + 0.9, o.st.z]);
      if (!seen) continue;
      const score = d * (o === this.target ? 0.6 : 1);
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (best) {
      if (best !== this.target || !this.targetVisible) this.firstSeenAt = t;
      this.target = best;
      this.targetVisible = true;
      this.lastSeenAt = t;
      this.lastKnown = [best.st.x, best.st.y, best.st.z];
    } else {
      this.targetVisible = false;
      if (this.target && !this.target.st.alive) { this.target = null; this.lastKnown = null; }
    }
  }

  private computePath(from: V3, to: V3): V3[] {
    const nav = getNav();
    const res = nav.computePath({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] }, { halfExtents: { x: 3, y: 4, z: 3 } });
    if (!res.success || !res.path.length) return [to];
    return res.path.map((p) => [p.x, p.y, p.z] as V3);
  }

  private pickRoamGoal(): V3 {
    const nav = getNav();
    const r = nav.findRandomPoint();
    if (r.success) return [r.randomPoint.x, r.randomPoint.y, r.randomPoint.z];
    return [(Math.random() - 0.5) * 60, 0, (Math.random() - 0.5) * 60];
  }
}

const pointObj = (v: V3) => ({ x: v[0], z: v[2] });
const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clampAngle = (a: number, m: number) => Math.max(-m, Math.min(m, a));
