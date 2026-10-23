import * as THREE from "three";
import type { GameRoom } from "../net/session";
import { ServerClock } from "../net/clock";
import { loadCharacters, type CharacterTemplate } from "../assets/characters";
import { loadWeapons } from "../assets/weapons";
import { CharacterRig, type RigState } from "../player/CharacterRig";
import { gripPose } from "../player/grip";
import { getMap } from "../../shared/map/maps";
import { raycastWorld, type Rapier, type World } from "../../shared/physics";
import { INTERP_DELAY_MS, RESPAWN_MS, type GameMode } from "../../shared/constants";
import { GRENADE, WEAPONS, type WeaponId } from "../../shared/weapons";
import { grenadeFlight, grenadeVelocity } from "../../shared/grenade";
import { spreadRadius } from "../../shared/aim";
import type { MatchState } from "../../shared/schema";
import type { AmmoEvent, DamagedEvent, ExplosionEvent, HitConfirm, KillEvent, LoadoutEvent, Pong, ShotEvent, SpawnEvent } from "../../shared/messages";
import { loadClientWorld } from "./physics";
import { LocalPlayer } from "./local";
import { RemotePlayer } from "./remotes";
import { Input } from "./input";
import { Effects } from "./effects";
import { audio } from "./audio";
import { hud, useHud } from "./hud";
import { PRESETS, useSettings } from "../settings";
import { enemyAlongRay } from "./targeting";
import { useLoadout } from "../loadout";
import { DeathCamera } from "./deathcam";
import { liveView, MARK_MS, STEP_REVEAL_RANGE, THREAT_MS, addMark, addThreat, mapRelation, type MapMark, type MapPlayer } from "./minimap";
import { buildSquad } from "./squad";
import { updateSightMotion } from "./sightMotion";

const _frustum = new THREE.Frustum();
const _viewProjection = new THREE.Matrix4();
/** Covers a character with arms and gun out, peeking or emoting, around its waist. */
const _bounds = new THREE.Sphere(new THREE.Vector3(), 1.9);
const _arcNormal = new THREE.Vector3();
const _handOffset = new THREE.Vector3();
const _unitZ = new THREE.Vector3(0, 0, 1);
/** Dots drawn along a grenade's aiming arc, one every ARC_DOT meters past the hand. */
const ARC_DOTS = 90;
const ARC_DOT = 0.45;

/** Outfit tints (TEAM_COLORS): allies and you are blue, opponents red, whatever your team. */
const ALLY_TINT = 1;
const ENEMY_TINT = 2;

type V3 = [number, number, number];

/** Owns one match's input, simulation, network subscriptions and scene objects. */
export class Game {
  readonly clock = new ServerClock();
  readonly input: Input;
  readonly remotes = new Map<string, RemotePlayer>();
  readonly effects = new Effects();
  local: LocalPlayer | null = null;
  private R!: Rapier;
  private world: World | null = null;
  private templates!: [CharacterTemplate, CharacterTemplate];
  private weapons!: Map<WeaponId, THREE.Object3D>;
  private fpp: CharacterRig | null = null;
  private tpp: CharacterRig | null = null;
  private rigKey = "";
  private pendingSpawn: SpawnEvent | null = null;
  private initializedPlayer = false;
  private awaitingSpawnState = false;
  private disposed = false;
  private cleanup: (() => void)[] = [];
  private pingAt = 0;
  private hudAt = 0;
  private averageFrameTime = 1 / 60;
  /** Slowest frame of the current / last full second, for the FPS meter. */
  private worstFrame = { current: 0, last: 1 / 60, elapsed: 0 };
  private killSeq = 0;
  private killer = "";
  private deathCamera = new DeathCamera();
  private grenadeMeshes = new Map<string, THREE.Mesh>();
  private grenadeGeo = new THREE.IcosahedronGeometry(0.09, 1);
  private grenadeMat = new THREE.MeshStandardMaterial({ color: "#4e593c", roughness: 0.65 });
  /** The aiming arc shown while a grenade is held: dots to the landing spot and its blast radius. */
  private arc = createGrenadeArc();
  private handGrenade = createHandGrenade();
  /** Camera shake from nearby explosions, 0..1. */
  private shake = 0;
  private markSeq = 0;

  constructor(readonly room: GameRoom, readonly scene: THREE.Scene, readonly camera: THREE.PerspectiveCamera, element: HTMLElement) {
    useHud.setState({ ...useHud.getInitialState(), myId: room.sessionId, code: room.roomId, conn: "connected" });
    this.input = new Input(element);
    this.input.touch = matchMedia("(pointer: coarse)").matches;
    hud().set({ mobilePortrait: this.input.touch && window.innerHeight > window.innerWidth });
    this.input.attach();
    useLoadout.getState().hydrate();
    this.scene.add(this.effects.group, this.arc.group, this.handGrenade.group);
    this.bindRoom();
  }

  get matchEnded() { return this.room.state?.phase === "ended"; }

  async init() {
    // Capture spawn messages while assets load; initial state also recovers a missed join message.
    const physics = await loadClientWorld(getMap(this.room.state?.map));
    if (this.disposed) { physics.world.free(); return; }
    this.R = physics.R;
    this.world = physics.world;
    hud().set({ loading: 0.35 });
    [this.templates, this.weapons] = await Promise.all([loadCharacters(), loadWeapons()]);
    if (this.disposed) return;
    // Solve every hand pose behind the loading screen, not on the first weapon switch.
    const t0 = performance.now();
    for (const template of this.templates) for (const w of Object.keys(WEAPONS) as WeaponId[]) gripPose(template, w);
    console.debug(`[game] grip poses solved in ${(performance.now() - t0).toFixed(0)} ms`);
    this.local = new LocalPlayer(this, this.R, this.world);
    this.local.thirdPerson = useSettings.getState().thirdPerson;
    if (this.pendingSpawn) this.spawn(this.pendingSpawn);
    this.syncState(this.room.state);
    hud().set({ ready: true, loading: 1, touch: this.input.touch });
  }

  send(type: string, message: unknown) {
    if (!this.disposed && hud().conn === "connected") this.room.send(type, message);
  }

  resume(fullscreen = false) {
    audio.unlock();
    hud().set({ menu: false, loadoutOpen: false, customizingControls: false });
    this.input.enabled = !hud().mobilePortrait;
    this.input.requestLock(fullscreen);
  }

  openLoadout() {
    this.input.releaseAll();
    this.local?.cancelActions();
    hud().set({ loadoutOpen: true, menu: false, customizingControls: false });
    this.input.enabled = false;
    this.input.exitLock();
  }

  private bindRoom() {
    const room = this.room;
    const state = (s: MatchState) => this.syncState(s);
    const drop = () => { this.input.releaseAll(); hud().set({ conn: "reconnecting" }); };
    const reconnect = () => { hud().set({ conn: "connected", error: "" }); this.pingAt = 0; };
    const leave = () => { this.input.exitLock(); hud().set({ conn: "left", error: "Connection closed. Return to the lobby to join again." }); };
    const error = (_code: number, message?: string) => hud().set({ conn: "error", error: message ?? "Connection failed." });
    room.onStateChange(state); room.onDrop(drop); room.onReconnect(reconnect); room.onLeave(leave); room.onError(error);
    this.cleanup.push(() => {
      room.onStateChange.remove(state); room.onDrop.remove(drop); room.onReconnect.remove(reconnect);
      room.onLeave.remove(leave); room.onError.remove(error);
    });
    this.cleanup.push(
      room.onMessage<SpawnEvent>("spawn", (ev) => this.spawn(ev)),
      room.onMessage<{ x: number; y: number; z: number }>("correct", (ev) => this.local?.correct(ev.x, ev.y, ev.z)),
      room.onMessage<Pong>("pong", (ev) => this.clock.onPong(ev.c, ev.s)),
      room.onMessage<AmmoEvent>("ammo", (ev) => this.local?.reconcileAmmo(ev)),
      room.onMessage<LoadoutEvent>("loadout", (ev) => this.local?.applyLoadout(ev)),
      room.onMessage<ShotEvent>("shot", (ev) => this.remoteShot(ev)),
      room.onMessage<HitConfirm>("hit", (ev) => {
        hud().set({ hitmarker: { at: performance.now(), head: ev.part === "head", kill: ev.killed, confirmed: true, damage: ev.damage } });
        if (!ev.killed) audio.hitmarker(ev.part === "head");
        if (ev.point && ev.dir) this.confirmedBlood(ev.point, ev.dir, ev.part === "head");
      }),
      room.onMessage<DamagedEvent>("damaged", (ev) => {
        const now = performance.now();
        // Falls and your own grenade hurt without pointing at anyone.
        const threats = ev.attacker && ev.kind !== "fall"
          ? addThreat(hud().threats, { key: ev.attacker, from: ev.from, at: now, damage: ev.damage, kind: ev.kind === "explosion" ? "explosion" : "bullet" })
          : hud().threats;
        hud().set({ hp: ev.hp, regenerating: false, hurtAt: now, threats });
        audio.hurt();
      }),
      room.onMessage<KillEvent>("kill", (ev) => this.onKill(ev)),
      room.onMessage<ExplosionEvent>("explosion", (ev) => {
        const p = new THREE.Vector3(ev.x, ev.y, ev.z);
        this.effects.explosion(p); audio.explosion(p);
        this.shake = Math.max(this.shake, 1 - this.camera.position.distanceTo(p) / (GRENADE.radius * 2.8));
      }),
      room.onMessage<{ text: string; sub?: string }>("announce", (ev) => hud().set({ announce: { ...ev, at: performance.now() } })),
    );
  }

  private spawn(ev: SpawnEvent) {
    if (!this.local) { this.pendingSpawn = ev; return; }
    this.pendingSpawn = null;
    this.initializedPlayer = true;
    this.awaitingSpawnState = true;
    this.killer = "";
    this.local.spawn(ev);
    this.local.updateView();
    this.deathCamera.start(this.local.eye, null);
    hud().set({ alive: true, hp: 100, regenerating: false, hurtAt: 0, threats: [], killedBy: null, respawnAt: 0, killerMarker: null, deathCam: "environment" });
  }

  private syncLife(alive: boolean) {
    // Spawn messages arrive before the state patch. Ignore the previous life's
    // dead snapshot until replication acknowledges the new live player.
    if (alive) this.awaitingSpawnState = false;
    else if (!this.awaitingSpawnState && this.local?.alive) this.local.die();
  }

  private syncState(state: MatchState) {
    if (!state?.players || this.disposed) return;
    if (!this.clock.synced && state.serverTime) this.clock.offset = state.serverTime - performance.now();
    const me = state.players.get(this.room.sessionId);
    if (me && this.local) {
      if (!this.initializedPlayer && me.alive) this.spawn({ x: me.x, y: me.y, z: me.z, yaw: me.yaw, primary: me.primary as WeaponId });
      this.syncLife(me.alive);
      const key = `${me.team}:${me.char}`;
      if (key !== this.rigKey) {
        this.fpp?.dispose(); this.tpp?.dispose();
        // Your own outfit is always blue; opponents are always red (see the remotes below).
        this.fpp = new CharacterRig(this.templates[me.char === 1 ? 1 : 0], this.weapons, ALLY_TINT, false, "fpp");
        this.tpp = new CharacterRig(this.templates[me.char === 1 ? 1 : 0], this.weapons, ALLY_TINT, false, "tpp");
        this.scene.add(this.fpp.object, this.tpp.object);
        this.rigKey = key;
      }
    }
    if (this.local) {
      state.players.forEach((p, id) => {
        if (id === this.room.sessionId) return;
        let remote = this.remotes.get(id);
        if (!remote) { remote = new RemotePlayer(id); this.remotes.set(id, remote); }
        remote.name = p.name;
        remote.protectedUntil = p.protectedUntil;
        remote.team = p.team;
        const ally = mapRelation(id, p.team, this.room.sessionId, me?.team ?? 0, state.mode as GameMode) === "ally";
        remote.ensureRig(this.templates, this.weapons, ally ? ALLY_TINT : ENEMY_TINT, p.char, this.scene);
        remote.setWeapon(p.weapon as WeaponId);
        remote.push(state.serverTime, p);
      });
      for (const [id, remote] of this.remotes) {
        if (!state.players.has(id)) { remote.dispose(); this.remotes.delete(id); }
      }
    }
    hud().set({
      myTeam: me?.team ?? 0, hp: me?.hp ?? 100, protectedUntil: me?.protectedUntil ?? 0,
      regenerating: !!me?.alive && me.hp < 100 && me.hp >= hud().hp && (hud().regenerating || me.hp > hud().hp),
      mode: state.mode as GameMode, phase: state.phase, phaseEndsAt: state.phaseEndsAt,
      team1: state.team1, team2: state.team2, scoreLimit: state.scoreLimit, winner: state.winner,
      roomName: state.roomName,
      squad: this.stable("squad", buildSquad(state.players.entries(), this.room.sessionId, me?.team ?? 0, state.mode as GameMode)),
      players: this.stable("players", Array.from(state.players.entries()).map(([id, p]) => ({
        id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, assists: p.assists ?? 0, score: p.score,
        ping: p.ping, bot: p.bot, alive: p.alive, me: id === this.room.sessionId, connected: p.connected,
      })).sort((a, b) => b.score - a.score || b.kills - a.kills)),
    });
  }

  private hudLists = new Map<string, string>();
  /**
   * The previous HUD list when nothing in it changed. State patches arrive 30 times a second,
   * and a fresh array each time would re-render every panel that shows players.
   */
  private stable<K extends "squad" | "players">(key: K, next: ReturnType<typeof hud>[K]): ReturnType<typeof hud>[K] {
    const signature = JSON.stringify(next);
    if (this.hudLists.get(key) === signature) return hud()[key];
    this.hudLists.set(key, signature);
    return next;
  }

  /** The previous grenade-aim object when nothing visible changed (the fuse shows in tenths). */
  private stableAim(aim: ReturnType<LocalPlayer["grenadeAim"]>, airburst: boolean) {
    const prev = hud().grenadeAim, next = aim && { ...aim, airburst };
    const tenths = (fuse: number | null) => fuse === null ? null : Math.ceil(fuse / 100);
    if (prev && next && prev.lob === next.lob && prev.airburst === next.airburst && tenths(prev.fuse) === tenths(next.fuse)) return prev;
    return next;
  }

  traceFrom(origin: V3, dir: V3, range: number, players = true) {
    const wall = this.world ? raycastWorld(this.R, this.world, origin, dir, range) : null;
    const { distance, target, part } = enemyAlongRay(origin, dir, wall?.distance ?? range,
      players ? this.remotes.values() : [], hud().mode === "tdm", hud().myTeam, this.clock.now());
    const point: V3 = [origin[0] + dir[0] * distance, origin[1] + dir[1] * distance, origin[2] + dir[2] * distance];
    return { point, target, part, wall: target ? null : wall };
  }

  onLocalShot(weapon: WeaponId, origin: V3, dirs: V3[]) {
    const rig = this.local?.thirdPerson && !this.local.throughSight ? this.tpp : this.fpp;
    // The scoped viewmodel is hidden and not animated; its old muzzle is stale.
    const muzzle = this.local?.scoped ? new THREE.Vector3(...origin) : rig?.muzzle ?? new THREE.Vector3(...origin);
    if (!this.local?.scoped) this.effects.muzzleFlash(muzzle, new THREE.Vector3(...dirs[0]));
    audio.shot(weapon, undefined, true);
    for (const dir of dirs) {
      const hit = this.traceFrom(origin, dir, WEAPONS[weapon].range);
      const point = new THREE.Vector3(...hit.point);
      this.effects.tracer(muzzle, point, "local");
      if (hit.target) {
        // Prediction is visual only. Damage, scores and kill confirmation stay server-owned.
        if (performance.now() - hud().hitmarker.at > 150 || !hud().hitmarker.confirmed) {
          hud().set({ hitmarker: { at: performance.now(), head: hit.part === "head", kill: false, confirmed: false, damage: 0 } });
        }
      } else if (hit.wall) this.effects.impact(point, new THREE.Vector3(...hit.wall.normal), point.y < 0.1);
    }
  }

  private confirmedBlood(point: V3, dir: V3, head: boolean) {
    const impact = new THREE.Vector3(...point);
    this.effects.blood(impact, new THREE.Vector3(...dir), head);
    if (!this.world) return;
    // Only stain real nearby geometry, offset beyond the hitbox to avoid self-intersection.
    const start: V3 = [point[0] + dir[0] * 0.08, point[1] + dir[1] * 0.08, point[2] + dir[2] * 0.08];
    const surface = raycastWorld(this.R, this.world, start, dir, 3);
    if (surface) this.effects.bloodSplatter(new THREE.Vector3(...surface.point), new THREE.Vector3(...surface.normal), head);
  }

  private remoteShot(ev: ShotEvent) {
    if (!WEAPONS[ev.weapon]) return;
    const remote = this.remotes.get(ev.id);
    remote?.onShot();
    const friendly = hud().mode === "tdm" && remote?.team === hud().myTeam;
    // A character skipped this frame (off-screen) has a stale muzzle; its eye is close enough.
    const from = remote?.posed && remote.rig ? remote.rig.muzzle : new THREE.Vector3(...ev.origin);
    audio.shot(ev.weapon, from, false, friendly ? "ally" : "enemy");
    // Like PUBG, enemy gunfire gives the shooter's position away on the minimap.
    if (!friendly) this.mark({ key: ev.id, kind: "shot", x: ev.origin[0], z: ev.origin[2], yaw: remote?.yaw ?? 0, at: performance.now() });
    if (ev.ends[0]) this.effects.muzzleFlash(from, new THREE.Vector3(...ev.ends[0]).sub(from).normalize(), 1, false);
    ev.ends.forEach((end, i) => {
      const to = new THREE.Vector3(...end);
      this.effects.tracer(from, to, friendly ? "friendly" : "enemy");
      if (ev.hits?.[i]) {
        const delta = to.clone().sub(new THREE.Vector3(...ev.origin)).normalize();
        this.confirmedBlood(end, delta.toArray() as V3, ev.hits[i] === "head");
      }
      if (ev.impacts[i] && this.world) {
        const delta = to.clone().sub(new THREE.Vector3(...ev.origin));
        const distance = delta.length(); delta.normalize();
        const wall = raycastWorld(this.R, this.world, ev.origin, delta.toArray() as V3, distance + 0.1);
        if (wall) this.effects.impact(new THREE.Vector3(...wall.point), new THREE.Vector3(...wall.normal), to.y < 0.1);
      }
    });
  }

  private mark(mark: MapMark) {
    hud().set({ mapMarks: addMark(hud().mapMarks, mark) });
  }

  /** Sprinting enemies close by leave red footprints on the minimap. */
  private footprints(remote: RemotePlayer) {
    if (!remote.stepped || !remote.alive || !remote.sprinting || !this.local?.alive) return;
    if (hud().mode === "tdm" && remote.team === hud().myTeam) return;
    if (remote.pos.distanceTo(this.local.motion.position) > STEP_REVEAL_RANGE) return;
    this.mark({ key: `${remote.id}:${++this.markSeq}`, kind: "step", x: remote.pos.x, z: remote.pos.z, yaw: remote.moveYaw, left: remote.footLeft, at: performance.now() });
  }

  /**
   * PUBG-style aiming arc for a held grenade: bright dots through the air to where it lands,
   * fainter ones where it bounces and rolls, and the blast radius where the fuse runs out
   * (in the air, for a grenade cooked long enough). Returns whether it would burst in the air.
   */
  private updateGrenadeArc(local: LocalPlayer, now: number) {
    const { group, flight: flightDots, roll, marker, blast, burst } = this.arc;
    const aim = local.grenadeAim(now);
    group.visible = !!this.world && local.alive && !!aim;
    if (!group.visible || !this.world || !aim) return false;
    const world = this.world;
    const { origin, dir, power } = local.grenadeThrow();
    const path = grenadeFlight(origin, grenadeVelocity(dir, power, [local.ms.vx, local.ms.vy, local.ms.vz]), (aim.fuse ?? GRENADE.fuseMs) / 1000,
      (from, d, distance) => raycastWorld(this.R, world, from, d, distance));
    const landed = path.impact >= 0 ? path.impact : path.points.length - 1;
    // Evenly spaced dots, starting a meter out so none sit in front of the camera.
    const place = (dots: THREE.Points, from: number, to: number, start: number, spacing: number) => {
      const positions = dots.geometry.getAttribute("position") as THREE.BufferAttribute;
      let count = 0, travelled = 0, next = start;
      for (let i = from + 1; i <= to && count < ARC_DOTS; i++) {
        const a = path.points[i - 1], b = path.points[i];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        while (next <= travelled + length && count < ARC_DOTS) {
          const t = (next - travelled) / length;
          positions.setXYZ(count++, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
          next += spacing;
        }
        travelled += length;
      }
      dots.geometry.setDrawRange(0, count);
      positions.needsUpdate = true;
    };
    place(flightDots, 0, landed, 1, ARC_DOT);
    place(roll, landed, path.points.length - 1, ARC_DOT * 0.7, ARC_DOT * 0.7);
    // The landing marker lies on whatever the grenade hits first.
    marker.visible = path.impact >= 0 && !!path.impactNormal;
    if (marker.visible) {
      _arcNormal.set(...path.impactNormal!);
      marker.position.set(...path.points[path.impact]).addScaledVector(_arcNormal, 0.04);
      marker.quaternion.setFromUnitVectors(_unitZ, _arcNormal);
    }
    // The blast radius stays level, since that's how it reads, wherever it goes off.
    const airburst = !path.normal;
    for (const ring of [blast, burst]) {
      ring.position.set(path.end[0], path.end[1] + (airburst ? 0 : 0.05), path.end[2]);
      ring.quaternion.setFromUnitVectors(_unitZ, _arcNormal.set(0, 1, 0));
    }
    (blast.material as THREE.MeshBasicMaterial).opacity = airburst ? 0.55 : 0.3;
    return airburst;
  }

  /**
   * The grenade in your hand: in first person a gloved hand brings it up from below the view; in
   * third person it sits in the character's right hand. Gone once thrown.
   */
  private updateHandGrenade(local: LocalPlayer) {
    const { group, pin, lever, hand } = this.handGrenade;
    const hold = local.grenadeHold, throwing = local.throwAnim;
    group.visible = local.alive && !local.emote && (hold > 0.05 || throwing > 0.55);
    if (!group.visible) return;
    // The pin and lever come off once the fuse is burning.
    pin.visible = lever.visible = local.cooked === false && throwing === 0;
    const palm = this.tpp?.inst?.bones.get("hand_r");
    hand.visible = !local.thirdPerson || local.throughSight;
    if (!hand.visible) {
      if (!palm) { group.visible = false; return; }
      palm.getWorldPosition(group.position);
      group.quaternion.copy(this.camera.quaternion);
      group.position.y += 0.05;
      return;
    }
    // Brought up from below the view; on release it is flung forward and out of sight.
    const flung = throwing > 0 ? 1 - throwing : 0;
    _handOffset.set(0.16 - flung * 0.05, -0.34 + hold * 0.15 + local.bob.y * 0.5, -0.36 - flung * 0.9);
    _handOffset.applyQuaternion(this.camera.quaternion);
    group.position.copy(this.camera.position).add(_handOffset);
    group.quaternion.copy(this.camera.quaternion);
    group.rotateX(-0.35 + local.sway.y * 4).rotateZ(0.25 + local.sway.x * 4);
  }

  private onKill(ev: KillEvent) {
    const players = this.room.state.players;
    const killer = players.get(ev.killer), victim = players.get(ev.victim);
    const at = performance.now();
    const self = ev.killer === ev.victim;
    const name = self ? ev.weapon === "fall" ? "Fall damage" : "Own grenade" : ev.killerInfo?.name ?? killer?.name ?? "Unknown player";
    hud().set({ killfeed: [...hud().killfeed.filter((k) => at - k.at < 7000), {
      key: ++this.killSeq, killer: name, killerTeam: ev.killerInfo?.team ?? killer?.team ?? 0,
      victim: ev.victimInfo?.name ?? victim?.name ?? "Player", victimTeam: ev.victimInfo?.team ?? victim?.team ?? 0, weapon: ev.weapon,
      headshot: ev.headshot, mine: ev.killer === this.room.sessionId || ev.victim === this.room.sessionId, at,
      localKill: !self && ev.killer === this.room.sessionId, localDeath: ev.victim === this.room.sessionId,
    }].slice(-5) });
    if (ev.victim === this.room.sessionId) {
      this.local?.die(); this.killer = self ? "" : ev.killer;
      const position = !self ? ev.killerInfo?.position ?? (killer ? [killer.x, killer.y, killer.z] as V3 : null) : null;
      this.deathCamera.start(this.local?.eye ?? new THREE.Vector3(), position ? new THREE.Vector3(...position).add(new THREE.Vector3(0, 1.5, 0)) : null);
      hud().set({ alive: false, hp: 0, regenerating: false, respawnAt: ev.respawnAt ?? this.clock.now() + RESPAWN_MS, killedBy: {
        id: this.killer, name, weapon: ev.weapon, headshot: ev.headshot,
        hp: self ? null : ev.killerInfo?.hp ?? killer?.hp ?? null,
        distance: ev.distance ?? (position && this.local ? this.local.eye.distanceTo(new THREE.Vector3(...position).add(new THREE.Vector3(0, 1.5, 0))) : null),
        streak: ev.streak, at,
      } });
    } else if (ev.killer === this.room.sessionId) {
      audio.elimination(ev.headshot);
      this.local?.onKillScavenge();
      const previous = hud().elimination;
      hud().set({ elimination: { name: ev.victimInfo?.name ?? victim?.name ?? "Player", weapon: ev.weapon,
        headshot: ev.headshot, streak: ev.streak, at, count: previous && at - previous.at < 2800 ? previous.count + 1 : 1 } });
    }
  }

  update(dt: number, viewportHeight: number, pixelRatio = 1) {
    if (this.disposed || !this.local) return;
    this.averageFrameTime += (Math.min(dt, 0.25) - this.averageFrameTime) * (1 - Math.exp(-dt * 2));
    const worst = this.worstFrame;
    worst.current = Math.max(worst.current, dt);
    worst.elapsed += dt;
    if (worst.elapsed >= 1) { worst.last = worst.current; worst.current = worst.elapsed = 0; }
    dt = Math.min(dt, 0.1);
    const now = performance.now(), local = this.local;
    const portrait = this.input.touch && window.innerHeight > window.innerWidth;
    if (hud().mobilePortrait !== portrait) hud().set({ mobilePortrait: portrait });
    if (this.input.consume("KeyB")) this.openLoadout();
    if (this.input.consume("KeyH")) hud().set({ help: !hud().help });
    const active = hud().conn === "connected" && !portrait && !hud().menu && !hud().loadoutOpen && !hud().customizingControls && !this.matchEnded && (this.input.locked || this.input.touch);
    this.input.enabled = active;
    if (!active) { this.input.releaseAll(); local.cancelActions(); }
    const scoreboard = this.input.held("Tab");
    local.thirdPerson = useSettings.getState().thirdPerson;
    for (const remote of this.remotes.values()) {
      remote.setReadability(useSettings.getState().quality === "low" && (hud().mode !== "tdm" || remote.team !== hud().myTeam));
      remote.update(dt, this.clock.now() - INTERP_DELAY_MS, this.camera.position);
      this.footprints(remote);
    }
    local.update(dt, this.input, now);
    local.updateView();
    if (local.alive) local.camera(this.camera, dt);
    else {
      const remote = this.remotes.get(this.killer);
      const deathCam = this.deathCamera.update(this.camera, dt, local.eye, local.yaw,
        remote?.alive && remote.rig && this.room.state.players.get(this.killer)?.connected ? remote.head : null,
        (origin, direction, distance) => this.world ? raycastWorld(this.R, this.world, origin.toArray() as V3, direction.toArray() as V3, distance)?.distance ?? null : null);
      if (hud().deathCam !== deathCam) hud().set({ deathCam });
    }
    if (this.shake > 0) {
      const k = this.shake * this.shake * 0.04;
      this.camera.rotateX((Math.random() - 0.5) * k);
      this.camera.rotateY((Math.random() - 0.5) * k);
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    const airburst = this.updateGrenadeArc(local, now);
    this.updateHandGrenade(local);
    liveView.x = local.motion.position.x; liveView.z = local.motion.position.z; liveView.yaw = local.yaw; liveView.alive = local.alive;
    const fov = local.alive ? local.currentFov() : 62;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // Characters are skinned with culling off (their bounds don't follow the animation), so cull
    // them here, against this frame's camera, with a sphere covering a gun, a peek or an emote.
    // Off-screen ones are neither animated nor drawn unless they may cast a shadow into view.
    this.camera.updateMatrixWorld();
    _frustum.setFromProjectionMatrix(_viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    const preset = PRESETS[useSettings.getState().quality];
    const shadowReach = preset.shadows ? preset.shadowExtent + 4 : 0;
    for (const remote of this.remotes.values()) {
      _bounds.center.set(remote.pos.x, remote.pos.y + 1, remote.pos.z);
      remote.animate(dt, _frustum.intersectsSphere(_bounds) || remote.pos.distanceTo(this.camera.position) < shadowReach);
    }
    if (local.alive && local.ads > 0.4) updateSightMotion(dt, {
      swayX: local.sway.x, swayY: local.sway.y, bobX: local.bob.x, bobY: local.bob.y,
      strafe: local.ms.vx * Math.cos(local.yaw) - local.ms.vz * Math.sin(local.yaw), vy: local.ms.vy,
      recoil: local.recoil, time: now / 1000,
    });
    const s: RigState = {
      x: local.motion.position.x, y: local.motion.position.y, z: local.motion.position.z, yaw: local.yaw, pitch: local.pitch,
      eye: local.viewEye, view: local.viewQuat, speed: Math.hypot(local.ms.vx, local.ms.vz),
      moveYaw: Math.atan2(-local.ms.vx, -local.ms.vz), crouch: local.crouchT > 0.5,
      grounded: local.ms.grounded, alive: local.alive, sprint: local.ms.sprinting ? 1 : 0,
      ads: local.ads, optic: local.optic, reload: local.reloadProgress, recoil: local.recoil,
      bob: local.bob, sway: local.sway, tuck: local.tuck, throwing: Math.max(local.throwAnim, local.grenadeHold), lean: local.lean,
      sinceShot: local.sinceShot(now), sinceDraw: local.sinceDraw(now), emote: local.emote,
    };
    if (local.emote) s.yaw = local.emoteYaw;
    this.fpp?.setWeapon(local.weapon); this.tpp?.setWeapon(local.weapon);
    // Emoting pulls the camera out so you can see yourself.
    // A red dot in third person is aimed through the sight with the first-person arms.
    this.fpp?.setVisible(local.alive && (!local.thirdPerson || local.throughSight) && !local.emote && !local.scoped);
    this.tpp?.setVisible(((local.thirdPerson || !!local.emote) && !local.throughSight) || !local.alive);
    if (this.fpp?.object.visible) this.fpp.update(dt, s);
    if (this.tpp?.object.visible) this.tpp.update(dt, s);
    this.room.state.grenades?.forEach((g, id) => {
      let mesh = this.grenadeMeshes.get(id);
      if (!mesh) { mesh = new THREE.Mesh(this.grenadeGeo, this.grenadeMat); this.grenadeMeshes.set(id, mesh); this.scene.add(mesh); mesh.position.set(g.x, g.y, g.z); }
      mesh.position.lerp(new THREE.Vector3(g.x, g.y, g.z), Math.min(1, dt * 25));
      mesh.rotation.x += dt * 5;
    });
    for (const [id, mesh] of this.grenadeMeshes) if (!this.room.state.grenades.has(id)) { mesh.removeFromParent(); this.grenadeMeshes.delete(id); }
    this.effects.setQuality(useSettings.getState().quality);
    this.effects.setViewportHeight(viewportHeight * pixelRatio);
    this.effects.update(dt);
    audio.setVolume(useSettings.getState().volume);
    audio.setListener(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()));
    if (now >= this.pingAt) { this.send("ping", { c: now, rtt: this.clock.rtt }); this.pingAt = now + 1500; }
    if (now >= this.hudAt) {
      this.hudAt = now + 50;
      const ammo = local.ammo[local.weapon];
      const mapPlayers: MapPlayer[] = [];
      if (hud().conn === "connected") {
        const me = this.room.state.players.get(this.room.sessionId);
        if (local.alive) mapPlayers.push({
          id: this.room.sessionId, name: me?.name ?? "You", x: local.motion.position.x,
          y: local.motion.position.y, z: local.motion.position.z, yaw: local.yaw, relation: "self", slot: 0,
        });
        const squad = hud().squad;
        for (const [id, remote] of this.remotes) {
          const player = this.room.state.players.get(id);
          if (!remote.alive || !player?.alive || !player.connected) continue;
          const relation = mapRelation(id, player.team, this.room.sessionId, me?.team ?? hud().myTeam, this.room.state.mode as GameMode);
          // Like PUBG, enemies never appear on the map; only hit directions reveal them.
          if (relation === "enemy") continue;
          mapPlayers.push({ id, name: remote.name, x: remote.pos.x, y: remote.pos.y, z: remote.pos.z, yaw: remote.yaw,
            relation, slot: squad.find((member) => member.id === id)?.slot });
        }
      }
      let enemyInSight = false;
      if (active && local.alive) {
        const origin = this.camera.position.toArray() as V3;
        const direction = this.camera.getWorldDirection(new THREE.Vector3()).toArray() as V3;
        const sight = this.traceFrom(origin, direction, local.def.range);
        enemyInSight = !!sight.target;
        if (enemyInSight && local.thirdPerson && !local.throughSight) {
          // A shoulder camera can see around cover that still blocks the actual shot.
          const shotDir = new THREE.Vector3(...sight.point).sub(local.eye).normalize().toArray() as V3;
          enemyInSight = this.traceFrom(local.eye.toArray() as V3, shotDir, local.def.range).target === sight.target;
        }
      }
      hud().set({
        alive: local.alive, weapon: local.weapon, primary: local.primary, mag: ammo.mag, reserve: ammo.reserve,
        grenades: local.grenades, grenadeAim: this.stableAim(local.grenadeAim(now), airburst), reloading: local.reloadProgress, ads: local.ads, scoped: local.scoped,
        thirdPerson: local.thirdPerson, spreadDeg: local.spread, enemyInSight,
        crosshairRadius: Math.min(120, Math.max(3, spreadRadius(local.spread, fov, viewportHeight))),
        cameraFov: fov, locked: this.input.locked, scoreboard, fps: Math.round(1 / Math.max(this.averageFrameTime, 0.001)),
        fpsLow: Math.round(1 / Math.max(this.worstFrame.last, 0.001)),
        ping: Math.round(this.clock.rtt), serverOffset: this.clock.offset,
        killerMarker: local.alive ? null : this.deathCamera.marker(this.camera),
        mapPlayers, peek: local.leanSide, emoteMenu: local.emoteMenu && local.alive, emote: local.emote,
        threats: hud().threats.some((threat) => now - threat.at >= THREAT_MS) ? hud().threats.filter((threat) => now - threat.at < THREAT_MS) : hud().threats,
        mapMarks: hud().mapMarks.some((mark) => now - mark.at >= MARK_MS[mark.kind]) ? hud().mapMarks.filter((mark) => now - mark.at < MARK_MS[mark.kind]) : hud().mapMarks,
      });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const clean of this.cleanup) clean();
    this.input.detach(); this.local?.dispose(); this.world?.free(); this.world = null;
    this.fpp?.dispose(); this.tpp?.dispose();
    for (const remote of this.remotes.values()) remote.dispose();
    for (const mesh of this.grenadeMeshes.values()) mesh.removeFromParent();
    this.grenadeGeo.dispose(); this.grenadeMat.dispose();
    this.arc.group.removeFromParent();
    this.handGrenade.group.removeFromParent();
    for (const group of [this.arc.group, this.handGrenade.group]) group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    this.arc.dot.dispose();
    this.effects.dispose(); audio.dispose();
  }
}

function createGrenadeArc() {
  const group = new THREE.Group();
  // Round dots of a fixed size on screen, so the far end of a long throw stays as readable as
  // the near end; drawn over the world, so the arc stays readable where it passes behind cover.
  const size = 32, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(255 * Math.min(1, Math.max(0, (1 - d) * 4)));
  }
  const dot = new THREE.DataTexture(pixels, size, size);
  dot.needsUpdate = true;
  const dots = (pixelSize: number, opacity: number) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ARC_DOTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    return new THREE.Points(geometry, new THREE.PointsMaterial({
      color: "#ffe28a", map: dot, size: pixelSize, sizeAttenuation: false, transparent: true, opacity, depthTest: false, depthWrite: false,
    }));
  };
  const ring = (inner: number, outer: number, color: string, opacity: number) => new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  );
  const flight = dots(7, 0.95), roll = dots(4, 0.55);
  const marker = ring(0.28, 0.4, "#ffe28a", 0.95);
  const blast = ring(GRENADE.radius - 0.12, GRENADE.radius, "#ff6a4a", 0.3);
  const burst = ring(0, 0.3, "#ff6a4a", 0.85);
  for (const mesh of [flight, roll, marker, blast, burst]) { mesh.frustumCulled = false; mesh.renderOrder = 10; }
  group.add(flight, roll, marker, blast, burst);
  group.visible = false;
  return { group, flight, roll, marker, blast, burst, dot };
}

/**
 * A frag grenade (olive body, steel lever and pull ring) held in a gloved hand, with the sleeve
 * running down to the lower right of the view; the hand is hidden in third person.
 */
function createHandGrenade() {
  const group = new THREE.Group();
  const hand = new THREE.Group();
  const glove = new THREE.MeshStandardMaterial({ color: "#2e3229", roughness: 0.85 });
  const sleeve = new THREE.MeshStandardMaterial({ color: "#3b5f93", roughness: 0.9 });
  const part = (geometry: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    hand.add(m);
    return m;
  };
  // A rounded palm cupped under the grenade, four capsule fingers curled over its front and a
  // thumb across the side, then wrist and sleeve running back to the lower right of the view.
  const palm = part(new THREE.SphereGeometry(0.042, 14, 10), glove, 0.006, -0.038, 0.018);
  palm.scale.set(1.05, 0.55, 1.15);
  const finger = new THREE.CapsuleGeometry(0.0085, 0.034, 4, 8);
  for (let i = 0; i < 4; i++) {
    const x = -0.024 + i * 0.016;
    part(finger, glove, x, -0.004 - Math.abs(i - 1.5) * 0.004, -0.032, 0.5, 0, 0);
    part(new THREE.SphereGeometry(0.0088, 8, 6), glove, x, 0.02 - Math.abs(i - 1.5) * 0.004, -0.025);
  }
  part(new THREE.CapsuleGeometry(0.0095, 0.03, 4, 8), glove, 0.036, -0.004, 0.004, 0.2, 0, -0.7);
  part(new THREE.CylinderGeometry(0.03, 0.034, 0.07, 14), glove, 0.016, -0.068, 0.06, 1.15, 0, -0.3);
  part(new THREE.CylinderGeometry(0.038, 0.05, 0.34, 14), sleeve, 0.07, -0.13, 0.21, 1.15, 0, -0.3);
  const steel = new THREE.MeshStandardMaterial({ color: "#8a8d86", roughness: 0.4, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 10), new THREE.MeshStandardMaterial({ color: "#4e593c", roughness: 0.65 }));
  body.scale.set(1, 1.18, 1);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.022, 10), steel);
  cap.position.y = 0.045;
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.07, 0.014), steel);
  lever.position.set(0.026, 0.022, 0);
  lever.rotation.z = -0.25;
  const pin = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.0025, 6, 16), steel);
  pin.position.set(-0.016, 0.052, 0);
  pin.rotation.y = Math.PI / 2;
  group.add(body, cap, lever, pin, hand);
  group.traverse((o) => { if (o instanceof THREE.Mesh) { o.renderOrder = 9; o.frustumCulled = false; } });
  group.visible = false;
  return { group, pin, lever, hand };
}
