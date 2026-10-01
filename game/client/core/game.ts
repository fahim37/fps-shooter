import * as THREE from "three";
import type { GameRoom } from "../net/session";
import { ServerClock } from "../net/clock";
import { loadCharacters, type CharacterTemplate } from "../assets/characters";
import { loadWeapons } from "../assets/weapons";
import { CharacterRig, type RigState } from "../player/CharacterRig";
import { getVillage } from "../../shared/map/village";
import { raycastWorld, type Rapier, type World } from "../../shared/physics";
import { INTERP_DELAY_MS, RESPAWN_MS, type GameMode } from "../../shared/constants";
import { WEAPONS, type WeaponId } from "../../shared/weapons";
import { spreadRadius } from "../../shared/aim";
import type { MatchState } from "../../shared/schema";
import type { AmmoEvent, DamagedEvent, ExplosionEvent, HitConfirm, KillEvent, Pong, ShotEvent, SpawnEvent } from "../../shared/messages";
import { loadClientWorld } from "./physics";
import { LocalPlayer } from "./local";
import { RemotePlayer } from "./remotes";
import { Input } from "./input";
import { Effects } from "./effects";
import { audio } from "./audio";
import { hud, useHud } from "./hud";
import { useSettings } from "../settings";
import { enemyAlongRay } from "./targeting";

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
  private disposed = false;
  private cleanup: (() => void)[] = [];
  private pingAt = 0;
  private hudAt = 0;
  private averageFrameTime = 1 / 60;
  private killSeq = 0;
  private killer = "";
  private grenadeMeshes = new Map<string, THREE.Mesh>();
  private grenadeGeo = new THREE.IcosahedronGeometry(0.09, 1);
  private grenadeMat = new THREE.MeshStandardMaterial({ color: "#4e593c", roughness: 0.65 });

  constructor(readonly room: GameRoom, readonly scene: THREE.Scene, readonly camera: THREE.PerspectiveCamera, element: HTMLElement) {
    useHud.setState({ ...useHud.getInitialState(), myId: room.sessionId, code: room.roomId, conn: "connected" });
    this.input = new Input(element);
    this.input.touch = matchMedia("(pointer: coarse)").matches;
    this.input.attach();
    this.scene.add(this.effects.group);
    this.bindRoom();
  }

  get matchEnded() { return this.room.state?.phase === "ended"; }

  async init() {
    // Capture spawn messages while assets load; initial state also recovers a missed join message.
    const physics = await loadClientWorld(getVillage());
    if (this.disposed) { physics.world.free(); return; }
    this.R = physics.R;
    this.world = physics.world;
    hud().set({ loading: 0.35 });
    [this.templates, this.weapons] = await Promise.all([loadCharacters(), loadWeapons()]);
    if (this.disposed) return;
    this.local = new LocalPlayer(this, this.R, this.world);
    this.local.thirdPerson = useSettings.getState().thirdPerson;
    if (this.pendingSpawn) this.spawn(this.pendingSpawn);
    this.syncState(this.room.state);
    hud().set({ ready: true, loading: 1, touch: this.input.touch });
  }

  send(type: string, message: unknown) {
    if (!this.disposed && hud().conn === "connected") this.room.send(type, message);
  }

  resume() {
    audio.unlock();
    hud().set({ menu: false, customizingControls: false });
    this.input.requestLock();
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
      room.onMessage<ShotEvent>("shot", (ev) => this.remoteShot(ev)),
      room.onMessage<HitConfirm>("hit", (ev) => {
        hud().set({ hitmarker: { at: performance.now(), head: ev.part === "head", kill: ev.killed, confirmed: true, damage: ev.damage } });
        audio.hitmarker(ev.part === "head", ev.killed);
        if (ev.point && ev.dir) this.confirmedBlood(ev.point, ev.dir, ev.part === "head");
      }),
      room.onMessage<DamagedEvent>("damaged", (ev) => {
        const now = performance.now();
        const p = this.local?.ms;
        const angle = p ? Math.atan2(ev.from[0] - p.x, ev.from[2] - p.z) + (this.local?.yaw ?? 0) : 0;
        hud().set({ hp: ev.hp, hurtAt: now, damage: [...hud().damage.filter((d) => now - d.at < 1200), { angle, at: now }] });
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
    this.killer = "";
    this.local.spawn(ev);
    this.local.updateView();
    hud().set({ alive: true, hp: 100, killedBy: null, respawnAt: 0 });
  }

  private syncState(state: MatchState) {
    if (!state?.players || this.disposed) return;
    if (!this.clock.synced && state.serverTime) this.clock.offset = state.serverTime - performance.now();
    const me = state.players.get(this.room.sessionId);
    if (me && this.local) {
      if (!this.initializedPlayer && me.alive) this.spawn({ x: me.x, y: me.y, z: me.z, yaw: me.yaw, primary: me.primary as WeaponId });
      if (!me.alive && this.local.alive) this.local.die();
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
      mode: state.mode as GameMode, phase: state.phase, phaseEndsAt: state.phaseEndsAt,
      team1: state.team1, team2: state.team2, scoreLimit: state.scoreLimit, winner: state.winner,
      roomName: state.roomName,
      players: Array.from(state.players.entries()).map(([id, p]) => ({
        id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, score: p.score,
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
    const rig = this.local?.thirdPerson ? this.tpp : this.fpp;
    // The scoped viewmodel is hidden and not animated; its old muzzle is stale.
    const muzzle = this.local?.scoped ? new THREE.Vector3(...origin) : rig?.muzzle ?? new THREE.Vector3(...origin);
    if (!this.local?.scoped) this.effects.muzzleFlash(muzzle, new THREE.Vector3(...dirs[0]));
    audio.shot(weapon, undefined, true);
    for (const dir of dirs) {
      const hit = this.traceFrom(origin, dir, WEAPONS[weapon].range);
      const point = new THREE.Vector3(...hit.point);
      this.effects.tracer(muzzle, point);
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
      this.effects.tracer(from, to);
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
    hud().set({ killfeed: [...hud().killfeed.filter((k) => at - k.at < 7000), {
      key: ++this.killSeq, killer: killer?.name ?? "Environment", killerTeam: killer?.team ?? 0,
      victim: victim?.name ?? "Player", victimTeam: victim?.team ?? 0, weapon: ev.weapon,
      headshot: ev.headshot, mine: ev.killer === this.room.sessionId || ev.victim === this.room.sessionId, at,
    }].slice(-5) });
    if (ev.victim === this.room.sessionId) {
      this.local?.die(); this.killer = ev.killer;
      hud().set({ alive: false, respawnAt: this.clock.now() + RESPAWN_MS, killedBy: { name: killer?.name ?? "Environment", weapon: ev.weapon } });
    } else if (ev.killer === this.room.sessionId) this.local?.onKillScavenge();
  }

  update(dt: number, viewportHeight: number, pixelRatio = 1) {
    if (this.disposed || !this.local) return;
    this.averageFrameTime += (Math.min(dt, 0.25) - this.averageFrameTime) * (1 - Math.exp(-dt * 2));
    dt = Math.min(dt, 0.1);
    const now = performance.now(), local = this.local;
    const active = hud().conn === "connected" && !hud().menu && !hud().customizingControls && !this.matchEnded && (this.input.locked || this.input.touch);
    this.input.enabled = active;
    if (!active) { this.input.releaseAll(); local.cancelActions(); }
    const scoreboard = this.input.held("Tab");
    local.thirdPerson = useSettings.getState().thirdPerson;
    for (const remote of this.remotes.values()) remote.update(dt, this.clock.now() - INTERP_DELAY_MS, this.camera.position);
    local.update(dt, this.input, now);
    local.updateView();
    if (local.alive) local.camera(this.camera, dt);
    else {
      // Keep the corpse in view, then ease the look direction toward its attacker.
      const pivot = local.eye.clone();
      const back = new THREE.Vector3(0, 0.8, 2.8).applyAxisAngle(new THREE.Vector3(0, 1, 0), local.yaw);
      const len = back.length(); back.normalize();
      const hit = raycastWorld(this.R, this.world!, pivot.toArray() as V3, back.toArray() as V3, len);
      this.camera.position.lerp(pivot.addScaledVector(back, hit ? Math.max(0, hit.distance - 0.2) : len), Math.min(1, dt * 3));
      const target = this.remotes.get(this.killer)?.head ?? local.eye;
      const look = new THREE.Matrix4().lookAt(this.camera.position, target, this.camera.up);
      this.camera.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(look), Math.min(1, dt * 3));
    }
    const fov = local.alive ? local.currentFov() : useSettings.getState().fov;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const s: RigState = {
      x: local.ms.x, y: local.ms.y, z: local.ms.z, yaw: local.yaw, pitch: local.pitch,
      eye: local.eye, view: local.viewQuat, speed: Math.hypot(local.ms.vx, local.ms.vz),
      moveYaw: Math.atan2(-local.ms.vx, -local.ms.vz), crouch: local.crouchT > 0.5,
      grounded: local.ms.grounded, alive: local.alive, sprint: local.ms.sprinting ? 1 : 0,
      ads: local.ads, reload: local.reloadProgress, recoil: local.recoil,
      bob: local.bob, sway: local.sway, tuck: local.tuck, throwing: local.throwAnim,
    };
    this.fpp?.setWeapon(local.weapon); this.tpp?.setWeapon(local.weapon);
    this.fpp?.setVisible(local.alive && !local.thirdPerson && !local.scoped);
    this.tpp?.setVisible(local.thirdPerson || !local.alive);
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
      let enemyInSight = false;
      if (active && local.alive) {
        const origin = this.camera.position.toArray() as V3;
        const direction = this.camera.getWorldDirection(new THREE.Vector3()).toArray() as V3;
        const sight = this.traceFrom(origin, direction, local.def.range);
        enemyInSight = !!sight.target;
        if (enemyInSight && local.thirdPerson) {
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
        ping: Math.round(this.clock.rtt), serverOffset: this.clock.offset,
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
