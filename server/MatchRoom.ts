import { Room, ServerError, type Client } from "colyseus";
import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { MatchState, PlayerState, GrenadeState } from "../game/shared/schema";
import {
  TICK_MS, MAX_REWIND_MS, MAX_HEALTH, REGEN_DELAY_MS, REGEN_PER_SEC, RESPAWN_MS, SPAWN_PROTECTION_MS,
  GRENADES_PER_LIFE, FALL_DAMAGE_MIN_SPEED, MAX_PLAYERS, MODE_INFO, WARMUP_MS, END_SCREEN_MS, EYE_HEIGHT,
  CROUCH_EYE_HEIGHT, SPRINT_SPEED, type GameMode,
} from "../game/shared/constants";
import { WEAPONS, PRIMARIES, GRENADE, damageAt, fireIntervalMs, type WeaponId } from "../game/shared/weapons";
import { PoseHistory } from "../game/shared/lagcomp";
import { rayVsPose, type HitPart } from "../game/shared/hitboxes";
import { raycastWorld, lineOfSight, GROUP_GRENADE, type World } from "../game/shared/physics";
import {
  F_CROUCH, type JoinOptions, type PoseMsg, type FireMsg, type GrenadeMsg, type LoadoutMsg, type ShotEvent,
  type HitConfirm, type DamagedEvent, type KillEvent, type SpawnEvent, type RoomMeta, type AmmoEvent, type LoadoutEvent,
} from "../game/shared/messages";
import { createRoomWorld, RAPIER, map } from "./world";
import { Bot, BOT_NAMES } from "./bot";
import { startBlockReason } from "../game/shared/lobby";
import { canShowoff } from "../game/shared/showcase";

type V3 = [number, number, number];

export interface ServerPlayer {
  id: string;
  st: PlayerState;
  history: PoseHistory;
  ammo: Record<WeaponId, { mag: number; reserve: number }>;
  reloadingUntil: number;
  lastFireAt: number;
  shotSeq: number;
  grenades: number;
  lastDamageAt: number;
  lastAttacker: string;
  respawnAt: number;
  lastPoseAt: number;
  lastEmoteAt: number;
  /** After a server spawn, ignore client poses until one arrives near this point. */
  expectSpawn: { x: number; z: number; until: number } | null;
  vel: V3;
  bot?: Bot;
  client?: Client;
}

interface LiveGrenade {
  id: string;
  owner: string;
  body: RAPIER_NS.RigidBody;
  explodeAt: number;
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeCode() {
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

const now = () => Date.now();

export class MatchRoom extends Room<{ state: MatchState; metadata: RoomMeta }> {
  state = new MatchState();
  patchRate = 33;
  maxClients = MAX_PLAYERS;

  world!: World;
  players = new Map<string, ServerPlayer>();
  private grenades = new Map<string, LiveGrenade>();
  private grenadeSeq = 0;
  private botTarget = 0;
  botSkill: 0 | 1 | 2 = 1;
  private botSeq = 0;

  onCreate(options: JoinOptions) {
    const c = options.create ?? { mode: options.mode ?? "tdm", maxPlayers: MAX_PLAYERS, bots: 8, botSkill: 1 as const, private: false, roomName: "" };
    const format = c.format === "1v1" || c.format === "2v2" ? c.format : "custom";
    const mode: GameMode = format !== "custom" ? "tdm" : c.mode === "ffa" ? "ffa" : "tdm";
    this.roomId = makeCode();
    this.maxClients = Math.max(2, Math.min(MAX_PLAYERS, c.maxPlayers | 0 || MAX_PLAYERS));
    this.botTarget = Math.max(0, Math.min(this.maxClients, c.bots | 0));
    if (format !== "custom") { this.maxClients = format === "1v1" ? 2 : 4; this.botTarget = 0; }
    this.botSkill = ([0, 1, 2] as const).includes(c.botSkill) ? c.botSkill : 1;

    this.state.mode = mode;
    this.state.lobby = c.lobby === true || format !== "custom" || options.queue === "rooms";
    this.state.queue = this.state.lobby ? "rooms" : "quick";
    this.state.format = format;
    this.state.maxPlayers = this.maxClients;
    this.state.botFill = this.botTarget;
    this.state.privateRoom = c.private === true;
    this.state.code = this.roomId;
    this.state.roomName = (c.roomName || `${options.name || "Player"}'s game`).slice(0, 32);
    this.state.scoreLimit = MODE_INFO[mode].scoreLimit;
    if (c.private) this.setPrivate(true);
    this.updateMeta();

    this.world = createRoomWorld();
    this.world.timestep = TICK_MS / 1000;

    this.onMessage("pose", (client, m: PoseMsg) => this.onPose(client, m));
    this.onMessage("fire", (client, m: FireMsg) => {
      const p = this.players.get(client.sessionId);
      if (p && m && Object.hasOwn(WEAPONS, m.weapon)) {
        this.fire(p, m);
        if (Number.isSafeInteger(m.shot) && m.shot! > 0) p.shotSeq = m.shot!;
        this.sendAmmo(p, m.weapon);
      }
    });
    this.onMessage("reload", (client) => {
      const p = this.players.get(client.sessionId);
      if (p) this.reload(p);
    });
    this.onMessage("grenade", (client, m: GrenadeMsg) => {
      const p = this.players.get(client.sessionId);
      if (p) this.throwGrenade(p, m);
    });
    this.onMessage("loadout", (client, m: LoadoutMsg) => {
      const p = this.players.get(client.sessionId);
      if (p) this.changeLoadout(p, m);
    });
    this.onMessage("ping", (client, m: { c: number; rtt?: number }) => {
      client.send("pong", { c: m.c, s: now() });
      const p = this.players.get(client.sessionId);
      if (p && typeof m.rtt === "number") p.st.ping = Math.min(999, Math.round(m.rtt));
    });
    this.onMessage("ready", (client, value: unknown) => {
      const p = this.players.get(client.sessionId);
      if (this.state.phase === "waiting" && p && typeof value === "boolean") p.st.ready = value;
    });
    this.onMessage("emote", (client, value: unknown) => {
      const p = this.players.get(client.sessionId);
      const at = now();
      if (!p || !canShowoff(this.state.phase, p.st.connected, value, p.lastEmoteAt, at)) return;
      p.st.emote = value as string;
      p.lastEmoteAt = at;
    });
    this.onMessage("team", (client, team: unknown) => {
      const p = this.players.get(client.sessionId);
      if (!p || this.state.phase !== "waiting" || mode !== "tdm" || (team !== 1 && team !== 2) || p.st.team === team) return;
      const count = this.humans().filter((other) => other.st.team === team).length;
      if (count >= Math.ceil(this.maxClients / 2)) { client.send("lobbyError", "That team is full. Choose the other team."); return; }
      p.st.team = team;
      this.resetReady();
    });
    this.onMessage("start", (client) => {
      if (!this.state.lobby || this.state.phase !== "waiting" || client.sessionId !== this.state.hostId) return;
      const reason = startBlockReason(this.state, [...this.state.players.values()]);
      if (reason) { client.send("lobbyError", reason); return; }
      void this.lock();
      this.startPhase("warmup");
    });

    this.startPhase(this.state.lobby ? "waiting" : "warmup");
    this.setSimulationInterval(() => this.tick(), TICK_MS);
  }

  // ---------------------------------------------------------------- lifecycle

  onJoin(client: Client, options: JoinOptions) {
    if (this.state.lobby && this.state.phase !== "waiting") throw new ServerError(403, "This match has started. Join the room for the next round.");
    const st = new PlayerState();
    st.name = sanitizeName(options?.name);
    st.char = options?.char === 1 ? 1 : 0;
    st.team = this.pickTeam();
    st.primary = "ar";
    const p = this.newPlayer(client.sessionId, st);
    p.client = client;
    this.state.players.set(client.sessionId, st);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    if (this.state.phase === "waiting") this.resetReady();
    else { this.balanceBots(); this.spawn(p); }
    this.updateMeta();
  }

  async onDrop(client: Client) {
    const p = this.players.get(client.sessionId);
    if (p) { p.st.connected = false; p.st.ready = false; }
    if (this.state.lobby && this.state.phase === "warmup") this.startPhase("waiting");
    try {
      await this.allowReconnection(client, 20);
    } catch {
      /* timed out: onLeave removes the player */
    }
  }

  onReconnect(client: Client) {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    p.client = client;
    p.st.connected = true;
    // A fresh life resynchronizes health, ammunition and grenades on both sides.
    if (this.state.phase !== "waiting") this.spawn(p);
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (this.state.hostId === client.sessionId) this.state.hostId = this.humans()[0]?.id ?? "";
    if (this.state.lobby && this.state.phase === "warmup") this.startPhase("waiting");
    if (this.state.phase === "waiting") this.resetReady();
    this.balanceBots();
    this.updateMeta();
  }

  onDispose() {
    this.world.free();
  }

  private newPlayer(id: string, st: PlayerState): ServerPlayer {
    const p: ServerPlayer = {
      id, st,
      history: new PoseHistory(),
      ammo: fullAmmo(),
      reloadingUntil: 0,
      lastFireAt: 0,
      shotSeq: 0,
      grenades: GRENADES_PER_LIFE,
      lastDamageAt: 0,
      lastAttacker: "",
      respawnAt: 0,
      lastPoseAt: 0,
      lastEmoteAt: 0,
      expectSpawn: null,
      vel: [0, 0, 0],
    };
    this.players.set(id, p);
    return p;
  }

  private humans() {
    return [...this.players.values()].filter((p) => !p.bot);
  }

  private updateMeta() {
    const humans = this.humans().length;
    this.setMetadata({
      queue: this.state.lobby ? "rooms" : "quick",
      mode: this.state.mode as GameMode,
      roomName: this.state.roomName,
      code: this.roomId,
      humans,
      bots: this.players.size - humans,
      botFill: this.botTarget,
      format: this.state.format,
      phase: this.state.phase,
    });
  }

  private pickTeam(): number {
    if (this.state.mode !== "tdm") return 0;
    let a = 0, b = 0;
    for (const p of this.players.values()) {
      if (p.st.team === 1) a++;
      else if (p.st.team === 2) b++;
    }
    return a <= b ? 1 : 2;
  }

  /** Keep humans + bots at the configured fill count, bots never taking a human's seat. */
  private balanceBots() {
    const humans = this.humans().length;
    const want = humans === 0 || this.state.phase === "waiting" ? 0 : Math.max(0, Math.min(this.botTarget, this.maxClients) - humans);
    const bots = [...this.players.values()].filter((p) => p.bot);
    while (bots.length > want) {
      const b = bots.pop()!;
      b.bot!.dispose();
      this.players.delete(b.id);
      this.state.players.delete(b.id);
    }
    while (bots.length < want) {
      const id = `bot-${++this.botSeq}`;
      const st = new PlayerState();
      st.name = BOT_NAMES[(this.botSeq * 7) % BOT_NAMES.length];
      st.bot = true;
      st.char = this.botSeq % 2;
      st.team = this.pickTeam();
      st.primary = PRIMARIES[Math.floor(Math.random() * PRIMARIES.length)];
      const p = this.newPlayer(id, st);
      p.bot = new Bot(this, p);
      this.state.players.set(id, st);
      this.spawn(p);
      bots.push(p);
    }
  }

  // ---------------------------------------------------------------- phases

  private resetReady() { for (const p of this.humans()) p.st.ready = false; }

  private startPhase(phase: "waiting" | "warmup" | "live" | "ended") {
    const t = now();
    this.state.phase = phase;
    for (const p of this.players.values()) { p.st.emote = "idle"; p.lastEmoteAt = 0; }
    if (phase === "waiting") {
      this.state.phaseEndsAt = 0;
      this.resetReady();
      this.balanceBots();
      for (const p of this.players.values()) { p.st.alive = false; p.respawnAt = 0; }
      for (const g of this.grenades.values()) this.world.removeRigidBody(g.body);
      this.grenades.clear(); this.state.grenades.clear();
      void this.unlock();
    }
    if (phase === "warmup") {
      this.state.phaseEndsAt = t + WARMUP_MS;
      this.balanceBots();
      for (const p of this.players.values()) this.spawn(p);
    }
    if (phase === "live") {
      this.state.phaseEndsAt = t + MODE_INFO[this.state.mode as GameMode].minutes * 60_000;
      this.state.team1 = this.state.team2 = 0;
      this.state.winner = "";
      for (const p of this.players.values()) {
        p.st.kills = p.st.deaths = p.st.score = p.st.streak = 0;
        this.spawn(p);
      }
      this.broadcast("announce", { text: "Match started", sub: MODE_INFO[this.state.mode as GameMode].name });
    }
    if (phase === "ended") {
      this.state.phaseEndsAt = t + END_SCREEN_MS;
      this.state.winner = this.computeWinner();
    }
    this.updateMeta();
  }

  private computeWinner(): string {
    if (this.state.mode === "tdm") {
      if (this.state.team1 === this.state.team2) return "draw";
      return this.state.team1 > this.state.team2 ? "1" : "2";
    }
    let best: ServerPlayer | null = null;
    for (const p of this.players.values()) if (!best || p.st.kills > best.st.kills) best = p;
    return best?.id ?? "";
  }

  private checkScoreLimit() {
    if (this.state.phase !== "live") return;
    const limit = this.state.scoreLimit;
    const reached = this.state.mode === "tdm"
      ? this.state.team1 >= limit || this.state.team2 >= limit
      : [...this.players.values()].some((p) => p.st.kills >= limit);
    if (reached) this.startPhase("ended");
  }

  // ---------------------------------------------------------------- simulation

  private tick() {
    const t = now();
    this.state.serverTime = t;
    if (this.state.phase === "waiting") return;
    if (t >= this.state.phaseEndsAt) {
      if (this.state.phase === "warmup") this.startPhase("live");
      else if (this.state.phase === "live") this.startPhase("ended");
      else this.startPhase(this.state.lobby ? "waiting" : "warmup");
    }

    for (const p of this.players.values()) {
      if (p.bot) p.bot.update(TICK_MS / 1000, t);
      if (p.st.alive) {
        // Health regen.
        if (p.st.hp < MAX_HEALTH && t - p.lastDamageAt > REGEN_DELAY_MS) {
          p.st.hp = Math.min(MAX_HEALTH, p.st.hp + (REGEN_PER_SEC * TICK_MS) / 1000);
        }
        if (p.reloadingUntil && t >= p.reloadingUntil) this.finishReload(p);
        p.history.push(t, { x: p.st.x, y: p.st.y, z: p.st.z, crouch: (p.st.flags & F_CROUCH) !== 0 });
      } else if (p.respawnAt && t >= p.respawnAt) {
        this.spawn(p);
      }
    }

    this.stepGrenades(t);
  }

  private onPose(client: Client, m: PoseMsg) {
    const p = this.players.get(client.sessionId);
    if (!p || !p.st.alive || !m || !finite(m.x, m.y, m.z, m.yaw, m.pitch)) return;
    const t = now();
    if (p.expectSpawn) {
      const near = Math.hypot(m.x - p.expectSpawn.x, m.z - p.expectSpawn.z) < 3;
      if (!near && t < p.expectSpawn.until) return;
      p.expectSpawn = null;
      p.lastPoseAt = t;
    } else {
      // Speed check: allow sprint speed with generous slack for jitter and lag bursts.
      const dt = Math.max(0.05, (t - p.lastPoseAt) / 1000);
      const dist = Math.hypot(m.x - p.st.x, m.z - p.st.z);
      if (dist > SPRINT_SPEED * dt * 1.6 + 1.2) {
        client.send("correct", { x: p.st.x, y: p.st.y, z: p.st.z });
        return;
      }
      p.lastPoseAt = t;
    }
    const h = map.half;
    p.st.x = clamp(m.x, -h, h);
    p.st.y = clamp(m.y, -2, 40);
    p.st.z = clamp(m.z, -h, h);
    p.st.yaw = m.yaw;
    p.st.pitch = clamp(m.pitch, -1.55, 1.55);
    p.st.flags = m.flags & 0xff;
    if (m.weapon === p.st.primary || m.weapon === "pistol") {
      if (p.st.weapon !== m.weapon) p.reloadingUntil = 0;
      p.st.weapon = m.weapon;
    }
    p.vel = [m.vx || 0, m.vy || 0, m.vz || 0];
    if (m.land && m.land > FALL_DAMAGE_MIN_SPEED) {
      this.damage(p, (m.land - FALL_DAMAGE_MIN_SPEED) * 11, null, "fall", "body", [p.st.x, p.st.y + 3, p.st.z]);
    }
  }

  eyePos(p: ServerPlayer): V3 {
    return [p.st.x, p.st.y + ((p.st.flags & F_CROUCH) ? CROUCH_EYE_HEIGHT : EYE_HEIGHT), p.st.z];
  }

  // ---------------------------------------------------------------- combat

  changeLoadout(p: ServerPlayer, m: LoadoutMsg) {
    if (!m || !PRIMARIES.includes(m.primary) || this.state.phase === "ended") return;
    const changed = p.st.primary !== m.primary;
    p.st.primary = m.primary;
    if (changed && p.st.alive) {
      p.st.weapon = m.primary;
      p.reloadingUntil = 0;
    }
    // Keep each gun's ammunition for this life; swapping never refills a magazine.
    const a = p.ammo[m.primary];
    p.client?.send("loadout", { primary: m.primary, weapon: m.primary, ...a, shot: p.shotSeq } satisfies LoadoutEvent);
  }

  fire(p: ServerPlayer, m: FireMsg) {
    const t = now();
    const def = WEAPONS[m.weapon];
    if (!def || !p.st.alive || this.state.phase === "ended" || this.state.phase === "waiting") return;
    if (m.weapon !== p.st.primary && m.weapon !== "pistol") return;
    if (t - p.lastFireAt < fireIntervalMs(def) * 0.75) return;
    if (p.reloadingUntil && t < p.reloadingUntil - 150) return;
    const ammo = p.ammo[m.weapon];
    if (ammo.mag <= 0) return;
    if (!Array.isArray(m.dirs) || m.dirs.length !== def.pellets || !Array.isArray(m.origin)) return;
    const eye = this.eyePos(p);
    if (!finite(...m.origin) || Math.hypot(m.origin[0] - eye[0], m.origin[1] - eye[1], m.origin[2] - eye[2]) > 2) return;

    ammo.mag--;
    p.lastFireAt = t;
    p.reloadingUntil = 0;
    p.st.shots = (p.st.shots + 1) & 0xff;
    p.st.weapon = m.weapon;
    // Firing reveals you: drop spawn protection.
    p.st.protectedUntil = 0;

    const viewTime = clamp(finite(m.viewTime) ? m.viewTime : t, t - MAX_REWIND_MS, t);
    const damages = new Map<string, { dmg: number; part: HitPart; point: V3; dir: V3 }>();
    const ends: V3[] = [];
    const impacts: boolean[] = [];
    const hits: (HitPart | null)[] = [];

    for (const raw of m.dirs) {
      const len = Math.hypot(raw[0], raw[1], raw[2]);
      if (!finite(...raw) || len < 0.5) continue;
      const dir: V3 = [raw[0] / len, raw[1] / len, raw[2] / len];
      const wall = raycastWorld(RAPIER, this.world, m.origin, dir, def.range);
      const maxDist = wall ? wall.distance : def.range;
      let bestT = maxDist, bestTarget: ServerPlayer | null = null, bestPart: HitPart = "body";
      for (const o of this.players.values()) {
        if (o === p || !o.st.alive || !this.canDamage(p, o)) continue;
        const pose = p.bot ? { x: o.st.x, y: o.st.y, z: o.st.z, crouch: (o.st.flags & F_CROUCH) !== 0 } : o.history.sample(viewTime);
        if (!pose) continue;
        const hit = rayVsPose(m.origin, dir, bestT, pose);
        if (hit && hit.distance < bestT) {
          bestT = hit.distance; bestTarget = o; bestPart = hit.part;
        }
      }
      const point: V3 = [m.origin[0] + dir[0] * bestT, m.origin[1] + dir[1] * bestT, m.origin[2] + dir[2] * bestT];
      ends.push(point);
      impacts.push(!bestTarget && !!wall);
      hits.push(bestTarget ? bestPart : null);
      if (bestTarget) {
        const mult = bestPart === "head" ? def.headMult : bestPart === "legs" ? def.limbMult : 1;
        const d = damageAt(def, bestT) * mult;
        const acc = damages.get(bestTarget.id) ?? { dmg: 0, part: bestPart, point, dir };
        acc.dmg += d;
        if (bestPart === "head") { acc.part = "head"; acc.point = point; acc.dir = dir; }
        damages.set(bestTarget.id, acc);
      }
    }

    this.broadcast("shot", { id: p.id, weapon: m.weapon, origin: m.origin, ends, impacts, hits } satisfies ShotEvent, { except: p.client });

    for (const [id, { dmg, part, point, dir }] of damages) {
      const target = this.players.get(id)!;
      const killed = this.damage(target, dmg, p, m.weapon, part, m.origin);
      p.client?.send("hit", { target: id, damage: Math.round(dmg), part, killed, point, dir } satisfies HitConfirm);
    }
  }

  canDamage(a: ServerPlayer, b: ServerPlayer) {
    if (this.state.mode === "tdm" && a.st.team === b.st.team) return false;
    return now() >= b.st.protectedUntil;
  }

  /** Applies damage; returns true if it killed. `attacker` null = environment. */
  damage(target: ServerPlayer, amount: number, attacker: ServerPlayer | null, weapon: KillEvent["weapon"], part: HitPart, from: V3): boolean {
    if (!target.st.alive || amount <= 0 || this.state.phase === "ended") return false;
    const hp = Math.max(0, target.st.hp - amount);
    target.st.hp = Math.round(hp);
    target.lastDamageAt = now();
    if (attacker && attacker !== target) target.lastAttacker = attacker.id;
    target.client?.send("damaged", { from, damage: Math.round(amount), hp: target.st.hp } satisfies DamagedEvent);
    target.bot?.onDamaged(attacker);
    if (hp > 0) return false;

    target.st.alive = false;
    target.st.deaths++;
    target.st.streak = 0;
    target.respawnAt = now() + RESPAWN_MS;
    target.reloadingUntil = 0;
    // Suicide (fall, own grenade) credits the last player who hurt you.
    const killer = attacker && attacker !== target ? attacker : this.players.get(target.lastAttacker) ?? null;
    if (killer && killer !== target) {
      killer.st.kills++;
      killer.st.streak++;
      killer.st.score += part === "head" ? 150 : 100;
      // Scavenge: a kill tops up the killer's reserve ammo.
      const a = killer.ammo[killer.st.weapon as WeaponId];
      if (a) a.reserve = Math.min(WEAPONS[killer.st.weapon as WeaponId].reserve * 2, a.reserve + WEAPONS[killer.st.weapon as WeaponId].mag);
      if (this.state.mode === "tdm") {
        if (killer.st.team === 1) this.state.team1++;
        else if (killer.st.team === 2) this.state.team2++;
      }
    }
    this.broadcast("kill", {
      killer: killer?.id ?? target.id,
      victim: target.id,
      weapon,
      headshot: part === "head",
      streak: killer?.st.streak ?? 0,
    } satisfies KillEvent);
    this.checkScoreLimit();
    return true;
  }

  reload(p: ServerPlayer) {
    const w = p.st.weapon as WeaponId;
    const a = p.ammo[w];
    if (!p.st.alive || !a || p.reloadingUntil || a.mag >= WEAPONS[w].mag || a.reserve <= 0) return;
    p.reloadingUntil = now() + WEAPONS[w].reloadMs;
  }

  private finishReload(p: ServerPlayer) {
    p.reloadingUntil = 0;
    const w = p.st.weapon as WeaponId;
    const a = p.ammo[w];
    const take = Math.min(WEAPONS[w].mag - a.mag, a.reserve);
    a.mag += take;
    a.reserve -= take;
    this.sendAmmo(p, w);
  }

  private sendAmmo(p: ServerPlayer, weapon: WeaponId) {
    const a = p.ammo[weapon];
    p.client?.send("ammo", { weapon, mag: a.mag, reserve: a.reserve, shot: p.shotSeq } satisfies AmmoEvent);
  }

  private spawn(p: ServerPlayer) {
    const sp = this.pickSpawn(p);
    const t = now();
    p.st.x = sp.x; p.st.y = sp.y; p.st.z = sp.z; p.st.yaw = sp.yaw; p.st.pitch = 0;
    p.st.hp = MAX_HEALTH;
    p.st.alive = true;
    p.st.flags = 0;
    p.st.weapon = p.st.primary;
    p.st.protectedUntil = t + SPAWN_PROTECTION_MS;
    p.ammo = fullAmmo();
    p.grenades = GRENADES_PER_LIFE;
    p.reloadingUntil = 0;
    p.respawnAt = 0;
    p.lastAttacker = "";
    p.history.clear();
    p.expectSpawn = { x: sp.x, z: sp.z, until: t + 2500 };
    if (p.bot) p.bot.onSpawn(sp);
    p.client?.send("spawn", { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, primary: p.st.primary as WeaponId } satisfies SpawnEvent);
  }

  /** Spawn point furthest from living enemies (team spawns in TDM). */
  private pickSpawn(p: ServerPlayer) {
    const tdm = this.state.mode === "tdm";
    const candidates = map.spawns.filter((s) => (tdm ? s.team === p.st.team : s.team === 0));
    const enemies = [...this.players.values()].filter((o) => o !== p && o.st.alive && (!tdm || o.st.team !== p.st.team));
    let best = candidates[0], bestScore = -Infinity;
    for (const s of candidates) {
      let nearest = 80;
      for (const e of enemies) nearest = Math.min(nearest, Math.hypot(e.st.x - s.x, e.st.z - s.z));
      const score = nearest + Math.random() * 6;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  // ---------------------------------------------------------------- grenades

  throwGrenade(p: ServerPlayer, m: GrenadeMsg) {
    if (!p.st.alive || p.grenades <= 0 || !m || !Array.isArray(m.origin) || !Array.isArray(m.dir)) return;
    if (!finite(...m.origin, ...m.dir)) return;
    const eye = this.eyePos(p);
    if (Math.hypot(m.origin[0] - eye[0], m.origin[1] - eye[1], m.origin[2] - eye[2]) > 2) return;
    p.grenades--;
    p.st.protectedUntil = 0;
    const len = Math.hypot(...m.dir) || 1;
    const speed = GRENADE.throwSpeed;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...m.origin)
        .setLinvel(m.dir[0] / len * speed + p.vel[0] * 0.5, m.dir[1] / len * speed + 2 + p.vel[1] * 0.3, m.dir[2] / len * speed + p.vel[2] * 0.5)
        .setAngularDamping(1.5)
        .setLinearDamping(0.15)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(0.07).setRestitution(0.38).setFriction(0.7).setDensity(3).setCollisionGroups(GROUP_GRENADE),
      body,
    );
    const id = `g${++this.grenadeSeq}`;
    const cooked = clamp(m.cooked || 0, 0, GRENADE.fuseMs - 250);
    this.grenades.set(id, { id, owner: p.id, body, explodeAt: now() + GRENADE.fuseMs - cooked });
    const gs = new GrenadeState();
    gs.owner = p.id;
    gs.x = m.origin[0]; gs.y = m.origin[1]; gs.z = m.origin[2];
    this.state.grenades.set(id, gs);
  }

  private stepGrenades(t: number) {
    if (this.grenades.size === 0) return;
    this.world.step();
    for (const g of [...this.grenades.values()]) {
      const pos = g.body.translation();
      const gs = this.state.grenades.get(g.id);
      if (gs) { gs.x = pos.x; gs.y = pos.y; gs.z = pos.z; }
      if (t >= g.explodeAt) this.explode(g, [pos.x, pos.y, pos.z]);
    }
  }

  private explode(g: LiveGrenade, at: V3) {
    this.grenades.delete(g.id);
    this.state.grenades.delete(g.id);
    this.world.removeRigidBody(g.body);
    this.broadcast("explosion", { id: this.grenadeSeq, x: at[0], y: at[1], z: at[2] });
    const owner = this.players.get(g.owner) ?? null;
    const lift: V3 = [at[0], at[1] + 0.25, at[2]];
    for (const p of this.players.values()) {
      if (!p.st.alive) continue;
      if (owner && p !== owner && !this.canDamage(owner, p)) continue;
      const chest: V3 = [p.st.x, p.st.y + 1.1, p.st.z];
      const d = Math.hypot(chest[0] - at[0], chest[1] - at[1], chest[2] - at[2]);
      if (d > GRENADE.radius) continue;
      if (!lineOfSight(RAPIER, this.world, lift, chest) && !lineOfSight(RAPIER, this.world, lift, [p.st.x, p.st.y + 0.3, p.st.z])) continue;
      const k = 1 - d / GRENADE.radius;
      let dmg = GRENADE.damage * (GRENADE.edgeMult + (1 - GRENADE.edgeMult) * k * k);
      if (p === owner) dmg *= 0.5;
      this.damage(p, dmg, owner, "grenade", "body", at);
      if (owner && p !== owner) owner.client?.send("hit", { target: p.id, damage: Math.round(dmg), part: "body", killed: !p.st.alive } satisfies HitConfirm);
    }
  }
}

function fullAmmo(): ServerPlayer["ammo"] {
  const a = {} as ServerPlayer["ammo"];
  for (const w of Object.values(WEAPONS)) a[w.id] = { mag: w.mag, reserve: w.reserve };
  return a;
}

function sanitizeName(n: unknown) {
  const s = typeof n === "string" ? n.replace(/[^\p{L}\p{N} _\-.]/gu, "").trim().slice(0, 16) : "";
  return s || `Player${Math.floor(Math.random() * 900 + 100)}`;
}

function finite(...v: unknown[]) {
  return v.every((x) => typeof x === "number" && Number.isFinite(x));
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
