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
import { WEAPONS, type WeaponId } from "../../shared/weapons";
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
import { useSettings } from "../settings";
import { enemyAlongRay } from "./targeting";
import { useLoadout } from "../loadout";
import { DeathCamera } from "./deathcam";
import { THREAT_MS, addThreat, mapRelation, type MapPlayer } from "./minimap";
import { buildSquad } from "./squad";
import { updateSightMotion } from "./sightMotion";

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

  constructor(readonly room: GameRoom, readonly scene: THREE.Scene, readonly camera: THREE.PerspectiveCamera, element: HTMLElement) {
    useHud.setState({ ...useHud.getInitialState(), myId: room.sessionId, code: room.roomId, conn: "connected" });
    this.input = new Input(element);
    this.input.touch = matchMedia("(pointer: coarse)").matches;
    hud().set({ mobilePortrait: this.input.touch && window.innerHeight > window.innerWidth });
    this.input.attach();
    useLoadout.getState().hydrate();
    this.scene.add(this.effects.group);
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
        this.fpp = new CharacterRig(this.templates[me.char === 1 ? 1 : 0], this.weapons, me.team, false, "fpp");
        this.tpp = new CharacterRig(this.templates[me.char === 1 ? 1 : 0], this.weapons, me.team, false, "tpp");
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
        remote.ensureRig(this.templates, this.weapons, p.team, p.char, this.scene);
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
      squad: buildSquad(state.players.entries(), this.room.sessionId, me?.team ?? 0, state.mode as GameMode),
      players: Array.from(state.players.entries()).map(([id, p]) => ({
        id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, assists: p.assists ?? 0, score: p.score,
        ping: p.ping, bot: p.bot, alive: p.alive, me: id === this.room.sessionId, connected: p.connected,
      })).sort((a, b) => b.score - a.score || b.kills - a.kills),
    });
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
    const from = remote?.rig?.muzzle ?? new THREE.Vector3(...ev.origin);
    audio.shot(ev.weapon, from);
    if (ev.ends[0]) this.effects.muzzleFlash(from, new THREE.Vector3(...ev.ends[0]).sub(from).normalize(), 1, false);
    ev.ends.forEach((end, i) => {
      const to = new THREE.Vector3(...end);
      this.effects.tracer(from, to, hud().mode === "tdm" && remote?.team === hud().myTeam ? "friendly" : "enemy");
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
    const fov = local.alive ? local.currentFov() : 62;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
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
      bob: local.bob, sway: local.sway, tuck: local.tuck, throwing: local.throwAnim, lean: local.lean,
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
        grenades: local.grenades, reloading: local.reloadProgress, ads: local.ads, scoped: local.scoped,
        thirdPerson: local.thirdPerson, spreadDeg: local.spread, enemyInSight,
        crosshairRadius: Math.min(120, Math.max(3, spreadRadius(local.spread, fov, viewportHeight))),
        cameraFov: fov, locked: this.input.locked, scoreboard, fps: Math.round(1 / Math.max(this.averageFrameTime, 0.001)),
        fpsLow: Math.round(1 / Math.max(this.worstFrame.last, 0.001)),
        ping: Math.round(this.clock.rtt), serverOffset: this.clock.offset,
        killerMarker: local.alive ? null : this.deathCamera.marker(this.camera),
        mapPlayers, peek: local.leanSide, emoteMenu: local.emoteMenu && local.alive, emote: local.emote,
        threats: hud().threats.some((threat) => now - threat.at >= THREAT_MS) ? hud().threats.filter((threat) => now - threat.at < THREAT_MS) : hud().threats,
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
    this.effects.dispose(); audio.dispose();
  }
}
