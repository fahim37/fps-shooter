import { Mover, newMoveState, type MoveState } from "../game/shared/movement";
import { lineOfSight, raycastWorld, QUERY_MOVE } from "../game/shared/physics";
import { PLAYER_HEIGHT, REGEN_DELAY_MS } from "../game/shared/constants";
import { leanOffset } from "../game/shared/lean";
import { aimDir, lookAt, spreadDir, angleBetween } from "../game/shared/aim";
import { WEAPONS, currentSpread, fireIntervalMs, type WeaponId } from "../game/shared/weapons";
import { F_CROUCH, F_ADS, F_SPRINT, F_GROUNDED, F_RELOADING, F_SLIDE, F_DASH } from "../game/shared/messages";
import { offAim, SPOT_CONE } from "../game/shared/spot";
import type { SpawnPoint } from "../game/shared/map/types";
import { RAPIER, getNav } from "./world";
import type { MatchRoom, ServerPlayer } from "./MatchRoom";
import { chooseCombatMove, type CombatMove } from "./botTactics";

type V3 = [number, number, number];

export const BOT_NAMES = [
  "Aldric", "Brenna", "Cedric", "Dagny", "Edric", "Fenna", "Garrick", "Hilda", "Isolde", "Jorah",
  "Kestrel", "Leoric", "Maren", "Nolan", "Osric", "Perrin", "Quill", "Rowena", "Sigrid", "Tobin",
  "Ulric", "Vesna", "Wystan", "Yara", "Zorin",
];

/** Per-skill tuning: easy / normal / hard. */
const SKILL = [
  { reactionMs: 750, aimErrorDeg: 5.5, turnRate: 3.2, fireAngleDeg: 9, burstMs: 500, viewDist: 45, dashGapMs: 5500 },
  { reactionMs: 420, aimErrorDeg: 2.6, turnRate: 5.5, fireAngleDeg: 5, burstMs: 800, viewDist: 60, dashGapMs: 4000 },
  { reactionMs: 230, aimErrorDeg: 1.2, turnRate: 9, fireAngleDeg: 3, burstMs: 1200, viewDist: 80, dashGapMs: 2800 },
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
  private crouchUntil = 0;
  private combatMove: CombatMove | null = null;
  private maneuverAt = 0;
  private nextDashAt = 0;
  private nextSpotAt = 0;
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
    this.targetVisible = false;
    this.firstSeenAt = this.lastSeenAt = 0;
    this.lastKnown = null;
    this.path = [];
    this.goal = null;
    this.pathIdx = this.repathAt = this.thinkAt = 0;
    this.combatMove = null;
    this.maneuverAt = this.nextDashAt = this.nextSpotAt = 0;
    this.crouchUntil = this.burstUntil = this.pauseUntil = this.errAt = 0;
    this.stuckT = 0;
    this.jump = false;
    this.lastPos = [sp.x, sp.y, sp.z];
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
    if (!st.alive || this.room.state.phase === "waiting" || this.room.state.phase === "ended") return;
    const eye = this.room.eyePos(this.p);
    const weapon = st.weapon as WeaponId;
    const def = WEAPONS[weapon];

    if (t >= this.thinkAt) {
      this.thinkAt = t + 120;
      this.perceive(t, eye);
    }

    // ---- movement goal
    let moveTo: V3 | null = null;
    const vulnerable = this.p.reloadingUntil > 0 || st.hp <= 40;
    const holdCover = vulnerable && !this.targetVisible && this.lastKnown && t - this.lastSeenAt < REGEN_DELAY_MS + 1500
      && this.coveredFrom([this.lastKnown[0], this.lastKnown[1] + 1.45, this.lastKnown[2]], [st.x, st.y, st.z]);
    if (this.target && this.targetVisible) {
      const d = dist2d(this.target.st, st);
      const pref = PREFERRED_RANGE[weapon];
      if (d > pref + 6) moveTo = [this.target.st.x, this.target.st.y, this.target.st.z];
      if (t >= this.maneuverAt) this.planCombat(t, weapon);
    } else {
      this.combatMove = null;
      this.maneuverAt = 0;
    }
    if (!this.targetVisible && !holdCover && this.lastKnown && t - this.lastSeenAt < 7000) {
      moveTo = this.lastKnown;
    }
    if (!moveTo && !holdCover && !this.combatMove && !this.targetVisible) {
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
    if (moveTo && !this.combatMove && this.pathIdx < this.path.length) {
      let wp = this.path[this.pathIdx];
      while (Math.hypot(wp[0] - st.x, wp[2] - st.z) < 0.7 && this.pathIdx < this.path.length - 1) wp = this.path[++this.pathIdx];
      const dx = wp[0] - st.x, dz = wp[2] - st.z, l = Math.hypot(dx, dz);
      if (l > 0.3) { mx = dx / l; mz = dz / l; } else this.pathIdx++;
    }
    if (this.combatMove) [mx, mz] = this.combatMove.direction;

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
      const crouched = (tgt.flags & F_CROUCH) !== 0;
      // A slider is flat along the ground: aim for the chest laid back over the hips.
      const aimHeight = (tgt.flags & F_SLIDE) ? 0.42 : (crouched ? 0.95 : 1.3) + (Math.random() < 0.15 ? 0.3 : 0);
      // Track a peeking target's exposed upper body rather than the hidden hips.
      const lean = leanOffset(tgt.lean, tgt.yaw, crouched ? 1 : 0, aimHeight);
      const la = lookAt(eye, [tgt.x + lean[0], tgt.y + aimHeight + lean[1], tgt.z + lean[2]]);
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
        this.p.cookingSince = t - 600;
        this.room.throwGrenade(this.p, { origin: eye, dir });
        this.nextGrenadeAt = t + 12000 + Math.random() * 12000;
      }
    }

    // ---- move
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const forward = -sin * mx - cos * mz;
    const right = cos * mx - sin * mz;
    const dash = !!this.combatMove?.dash && this.room.dash(this.p);
    if (this.combatMove) this.combatMove.dash = false;
    if (dash) this.nextDashAt = t + this.skill.dashGapMs;
    const crouch = !dash && this.ms.dashTime <= 0 && t < this.crouchUntil;
    this.mover.step(this.ms, {
      forward, right, yaw: this.yaw, jump: this.jump, crouch,
      sprint: !this.targetVisible && forward > 0.7 && !!this.path.length,
      ads, speedMult: def.moveMult, dash,
    }, dt);
    this.jump = false;

    st.x = this.ms.x; st.y = this.ms.y; st.z = this.ms.z;
    st.yaw = this.yaw; st.pitch = this.pitch;
    st.flags = (crouch ? F_CROUCH : 0) | (ads ? F_ADS : 0) | (this.ms.sprinting ? F_SPRINT : 0)
      | (this.ms.grounded ? F_GROUNDED : 0) | (reloading ? F_RELOADING : 0) | (this.ms.sliding ? F_SLIDE : 0)
      | (this.ms.dashTime > 0 ? F_DASH : 0);
    this.p.vel = [this.ms.vx, this.ms.vy, this.ms.vz];

    if (this.target && this.targetVisible && this.target.st.alive && t - this.firstSeenAt >= this.skill.reactionMs
      && t >= this.nextSpotAt && !this.room.isSpotted(this.p, this.target, t)) {
      // Use the bot's current aim, not the server's wider allowance for delayed human poses.
      const aimed = offAim(this.room.eyePos(this.p), aimDir(this.yaw, this.pitch), this.room.eyePos(this.target));
      if (aimed.angle <= SPOT_CONE) {
        this.room.spot(this.p, this.target);
        this.nextSpotAt = t + 800;
      }
    }
  }

  private planCombat(t: number, weapon: WeaponId) {
    this.maneuverAt = t + 250;
    const target = this.target!;
    const st = this.p.st;
    if (t - this.firstSeenAt < this.skill.reactionMs) { this.combatMove = null; return; }
    const enemyEye = this.room.eyePos(target);
    const recentlyHit = this.p.lastDamageAt > 0 && t - this.p.lastDamageAt < 1400;
    const aimedAtUs = t - target.lastFireAt < 1200
      && offAim(enemyEye, aimDir(target.st.yaw, target.st.pitch), [st.x, st.y + 1.1, st.z]).angle < 0.18;
    this.combatMove = chooseCombatMove({
      position: [st.x, st.y, st.z], target: [target.st.x, target.st.y, target.st.z],
      preferredRange: PREFERRED_RANGE[weapon], defensive: st.hp <= 40 || this.p.reloadingUntil > 0,
      underFire: recentlyHit || aimedAtUs, side: this.strafe,
      canDash: st.dash > 0 && this.ms.grounded && this.ms.dashTime <= 0 && t >= this.nextDashAt,
    }, (direction, distance) => {
      const point = this.travelPoint(direction, distance);
      if (!point) return null;
      const covered = this.coveredFrom(enemyEye, point);
      return { point, covered };
    });
    if (this.combatMove) {
      const dx = target.st.x - st.x, dz = target.st.z - st.z;
      const lateral = -dz * this.combatMove.direction[0] + dx * this.combatMove.direction[1];
      if (Math.abs(lateral) > 0.1) this.strafe = Math.sign(lateral);
    }
    // Crouch only when it actually hides the bot behind low cover.
    const hiddenLow = !lineOfSight(RAPIER, this.room.world, enemyEye, [st.x, st.y + 1, st.z]);
    this.crouchUntil = hiddenLow ? t + 300 : 0;
  }

  private coveredFrom(enemyEye: V3, point: V3): boolean {
    return !lineOfSight(RAPIER, this.room.world, enemyEye, [point[0], point[1] + 1.45, point[2]])
      && !lineOfSight(RAPIER, this.room.world, enemyEye, [point[0], point[1] + 0.9, point[2]]);
  }

  /** Walk along connected navmesh terrain; dash only through a clear, nearly level corridor. */
  private travelPoint([dx, dz]: [number, number], distance: number): V3 | null {
    const st = this.p.st, nav = getNav(this.room.map.id);
    const start = nav.findClosestPoint({ x: st.x, y: st.y, z: st.z }, { halfExtents: { x: 0.6, y: 0.8, z: 0.6 } });
    if (!start.success || !start.isPointOverPoly || Math.abs(start.point.y - st.y) > 0.5) return null;
    const end = { x: st.x + dx * distance, y: st.y, z: st.z + dz * distance };
    const corridor = nav.raycast(start.polyRef, start.point, end);
    if (!corridor.success || corridor.t < 1) return null;
    if (distance <= 2.5) {
      // The character controller can climb stairs and slopes. A level capsule sweep would reject them.
      const lastPoly = corridor.path[corridor.path.length - 1];
      if (!lastPoly) return null;
      const landing = nav.closestPointOnPoly(lastPoly, end);
      if (!landing.success || !landing.isPointOverPoly) return null;
      return [landing.closestPoint.x, landing.closestPoint.y, landing.closestPoint.z];
    }
    const hit = this.room.world.castShape(
      { x: st.x, y: st.y + PLAYER_HEIGHT / 2 + 0.08, z: st.z }, { x: 0, y: 0, z: 0, w: 1 },
      { x: dx, y: 0, z: dz }, this.mover.collider.shape, 0.02, distance, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, QUERY_MOVE, this.mover.collider,
    );
    if (hit) return null;
    // Navmesh rays are 2D: ground samples also rule out drops, roofs and crossing floors.
    let ground = st.y;
    for (let step = 1; step <= Math.ceil(distance / 2); step++) {
      const d = distance * step / Math.ceil(distance / 2);
      const floor = raycastWorld(RAPIER, this.room.world, [st.x + dx * d, st.y + 0.5, st.z + dz * d], [0, -1, 0], 1);
      if (!floor || floor.normal[1] < 0.65 || Math.abs(floor.point[1] - st.y) > 0.45) return null;
      ground = floor.point[1];
    }
    return [end.x, ground, end.z];
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
        || (o.st.lean !== 0 && lineOfSight(RAPIER, this.room.world, eye, this.room.eyePos(o)))
        || lineOfSight(RAPIER, this.room.world, eye, [o.st.x, o.st.y + 0.9, o.st.z]);
      if (!seen) continue;
      const score = d * (o === this.target ? 0.6 : 1);
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (best) {
      if (best !== this.target || !this.targetVisible) {
        this.firstSeenAt = t;
        this.combatMove = null;
        this.maneuverAt = 0;
      }
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
    const nav = getNav(this.room.map.id);
    const res = nav.computePath({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] }, { halfExtents: { x: 3, y: 4, z: 3 } });
    if (!res.success || !res.path.length) return [to];
    return res.path.map((p) => [p.x, p.y, p.z] as V3);
  }

  private pickRoamGoal(): V3 {
    const nav = getNav(this.room.map.id);
    // Search outward through connected polygons only: solid buildings and their roofs are
    // separate navmesh islands that a random point anywhere could land on.
    const { st } = this.p;
    const r = nav.findRandomPointAroundCircle({ x: st.x, y: st.y, z: st.z }, 70, { halfExtents: { x: 3, y: 4, z: 3 } });
    if (r.success) return [r.randomPoint.x, r.randomPoint.y, r.randomPoint.z];
    return [(Math.random() - 0.5) * 60, 0, (Math.random() - 0.5) * 60];
  }
}

const pointObj = (v: V3) => ({ x: v[0], z: v[2] });
const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clampAngle = (a: number, m: number) => Math.max(-m, Math.min(m, a));
