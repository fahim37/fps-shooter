"use client";

import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { getMap, MAPS } from "../shared/map/maps";
import type { MapId } from "../shared/map/types";
import { MODE_INFO, TEAM_NAMES } from "../shared/constants";
import { WEAPONS } from "../shared/weapons";
import type { GameRoom } from "./net/session";
import { Game } from "./core/game";
import { hud, useHud } from "./core/hud";
import { PRESETS, useSettings } from "./settings";
import { SkyAndSun } from "./world/SkyAndSun";
import { Ground } from "./world/Ground";
import { StaticWorld } from "./world/StaticWorld";
import { PostFX } from "./world/PostFX";
import { SettingsPanel } from "./SettingsPanel";
import { RoomInvite } from "./RoomInvite";
import { GraphicsControl } from "./GraphicsControl";
import { PerformanceTuner } from "./world/PerformanceTuner";
import { MobileControls } from "./MobileControls";
import { MobileScreen } from "./MobileScreen";
import { enterMobileFullscreen, exitMobileFullscreen } from "./mobileFullscreen";
import { LoadoutPanel, LoadoutPicker, WeaponBar } from "./LoadoutPanel";
import { useLoadout } from "./loadout";
import { RedDotSight } from "./RedDotSight";
import { ScopeSight } from "./ScopeSight";
import { DeathRecap, EliminationNotice, KillFeed } from "./CombatHud";
import { EmoteHint, EmoteMenu } from "./EmoteMenu";
import { Minimap } from "./Minimap";
import { HealthBar } from "./HealthBar";
import { SquadPanel } from "./SquadPanel";
import { DamageIndicator } from "./DamageIndicator";
import { MatchStats } from "./MatchStats";
import { HowToPlay } from "./HowToPlay";

class SceneBoundary extends Component<{ children: ReactNode; onLeave: () => void }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div className="match-modal"><h2>Unable to load the match</h2><p role="alert">{this.state.error}</p><button onClick={this.props.onLeave}>Return to lobby</button></div> : this.props.children; }
}

function Runtime({ room, map, onGame }: { room: GameRoom; map: MapId; onGame: (game: Game | null) => void }) {
  const { scene, camera, gl } = useThree();
  const ref = useRef<Game | null>(null);
  useEffect(() => {
    const game = new Game(room, scene, camera as THREE.PerspectiveCamera, gl.domElement);
    ref.current = game; onGame(game);
    let live = true;
    void game.init().catch((e: unknown) => { if (live) hud().set({ conn: "error", error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; ref.current = null; onGame(null); game.dispose(); };
    // The game reads its map from room state; a different map needs a new physics world.
  }, [room, map, scene, camera, gl, onGame]);
  useFrame((state, dt) => ref.current?.update(dt, state.size.height, state.gl.getPixelRatio()), -1);
  return null;
}

export default function GameView({ room, map: mapId, onLeave }: { room: GameRoom; map: MapId; onLeave: () => void }) {
  const map = useMemo(() => getMap(mapId), [mapId]);
  const quality = useSettings((s) => s.quality);
  const p = PRESETS[quality];
  const [game, setGame] = useState<Game | null>(null);
  const [screenMessage, setScreenMessage] = useState("");
  const fullscreenAttempted = useRef(false);
  useEffect(() => () => { if (game?.input.touch) void exitMobileFullscreen(); }, [game]);
  return <div className="game-view" data-touch={game?.input.touch || undefined} onPointerDownCapture={(e) => {
    if (!game?.input.touch || !hud().ready || fullscreenAttempted.current || (e.target as HTMLElement).closest('[aria-label="Mobile screen options"], [aria-label="Landscape required"]')) return;
    fullscreenAttempted.current = true;
    void enterMobileFullscreen(e.currentTarget).then(setScreenMessage);
  }}>
    <SceneBoundary onLeave={onLeave}>
      <Canvas shadows={p.shadows ? { type: THREE.PCFShadowMap } : false} dpr={p.dpr} camera={{ fov: 78, near: 0.04, far: p.drawDistance }} gl={{ antialias: false, powerPreference: "high-performance" }}>
        <PerformanceTuner />
        <Suspense fallback={null}><SkyAndSun /><Ground map={map.id} /><StaticWorld map={map} /><PostFX /><Runtime room={room} map={map.id} onGame={setGame} /></Suspense>
      </Canvas>
      <MatchHud game={game} map={map.id} onLeave={onLeave} />
      <GraphicsControl />
      {game?.input.touch && <MobileScreen message={screenMessage} setMessage={setScreenMessage} onLeave={onLeave} />}
    </SceneBoundary>
  </div>;
}

/** Frame rate, frame time and the slowest recent frame, colored by how smooth play is. */
function FpsMeter({ fps, low }: { fps: number; low: number }) {
  const grade = (v: number) => v >= 55 ? "good" : v >= 30 ? "fair" : "poor";
  return <span className="fps-meter" data-grade={grade(fps)} title="Frames per second · frame time · slowest frame in the last second">
    <i aria-hidden="true" /><b>{fps}</b> FPS
    <small>{(1000 / Math.max(fps, 1)).toFixed(1)} MS</small>
    <small data-grade={grade(low)}>LOW {low}</small>
  </span>;
}

function MatchHud({ game, map, onLeave }: { game: Game | null; map: MapId; onLeave: () => void }) {
  const h = useHud();
  const fpsMeter = useSettings((s) => s.fpsMeter);
  const clearView = useSettings((s) => s.clearView);
  const [now, setNow] = useState(0);
  const optic = useLoadout((s) => s.optics[h.weapon]);
  const baseFov = useSettings((s) => s.fov);
  useEffect(() => { const timer = setInterval(() => setNow(performance.now()), 100); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.ceil((h.phaseEndsAt - now - h.serverOffset) / 1000));
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const paused = h.ready && !h.loadoutOpen && ((!h.locked && !h.touch) || h.menu);
  const failed = h.conn === "error" || h.conn === "left";
  const scoreboard = h.scoreboard || h.phase === "ended";
  const winner = h.winner === "draw" ? "Draw" : h.mode === "tdm" ? `${TEAM_NAMES[Number(h.winner) as 1 | 2] ?? ""} team wins` : `${h.players.find((p) => p.id === h.winner)?.name ?? "Player"} wins`;
  return <>
    <div className="hud-layer">
      <div className="match-top"><span className="match-mode">{MODE_INFO[h.mode].name}<small>{h.code} · {h.phase.toUpperCase()}</small></span><div className="match-score">{h.mode === "tdm" && <b className="blue">{h.team1}</b>}<span>{time}<small>FIRST TO {h.scoreLimit}</small></span>{h.mode === "tdm" && <b className="red">{h.team2}</b>}</div><span className="match-stats">{fpsMeter && h.ready && <FpsMeter fps={h.fps} low={h.fpsLow} />}<span className="ping-meter" title="Round-trip time to the game server"><b>{h.ping}</b> MS<small>PING</small></span></span></div>
      <KillFeed h={h} now={now} />
      {h.ready && !paused && !scoreboard && !h.loadoutOpen && !h.customizingControls && h.conn === "connected" && <><Minimap now={now} map={map} /><SquadPanel /></>}
      {h.ready && h.alive && !paused && !scoreboard && !h.loadoutOpen && !h.customizingControls && h.conn === "connected" && <MatchStats />}
      {h.ready && !paused && !scoreboard && !h.loadoutOpen && <EliminationNotice h={h} now={now} />}
      {h.ready && h.alive && !paused && !scoreboard && <>
        {!clearView && h.ads > 0.1 && !h.scoped && <div className="ads-vignette" style={{ opacity: h.ads * 0.45 }} />}
        {h.emote ? <EmoteHint emote={h.emote} /> : h.scoped ? <ScopeSight optic={optic} enemy={h.enemyInSight} ads={h.ads} zoom={Math.tan(baseFov * Math.PI / 360) / Math.tan(h.cameraFov * Math.PI / 360)} /> : h.ads > 0.5 && optic === "red-dot" ? <RedDotSight enemy={h.enemyInSight} ads={h.ads} /> : <div aria-label={h.enemyInSight ? "Enemy in sights" : "Crosshair"} className={`crosshair ${h.enemyInSight ? "enemy-sighted" : ""} ${h.ads > 0.5 ? "aiming" : ""}`} style={{ width: h.crosshairRadius * 2, height: h.crosshairRadius * 2 }}><i /><b /><em /><span /></div>}
        {h.hitmarker.at > 0 && now - h.hitmarker.at < 200 && <div className={`hitmarker ${h.hitmarker.kill ? "kill" : ""} ${h.hitmarker.confirmed ? "confirmed" : "predicted"}`}>×</div>}
        {h.hitmarker.confirmed && !h.hitmarker.kill && now - h.hitmarker.at < 650 && <div className="hit-confirm">{h.hitmarker.damage} DAMAGE{h.hitmarker.head && " · HEADSHOT"}</div>}
        {h.hurtAt > 0 && now - h.hurtAt < 550 && <div className="hurt-vignette" />}
        <DamageIndicator now={now} />
        {h.protectedUntil > now + h.serverOffset && <div className="protected">SPAWN PROTECTION</div>}
      </>}
      {h.announce && now - h.announce.at < 3000 && <div className="announcement"><h2>{h.announce.text}</h2><p>{h.announce.sub}</p></div>}
      {h.alive && <div className="hud-bottom"><div className="hud-hints">WASD MOVE · Q / E PEEK · R RELOAD · C GRENADE<br />V CAMERA · T EMOTE · TAB SCORES · H HELP · ESC PAUSE</div><div className="ammo"><small>{WEAPONS[h.weapon].name} · {h.thirdPerson ? "TPP" : "FPP"}</small><strong>{h.mag}<span> / {h.reserve}</span></strong><small>{h.reloading >= 0 ? `RELOADING ${Math.round(h.reloading * 100)}%` : `${h.grenades} GRENADES`}</small></div></div>}
      {h.ready && h.alive && !paused && !scoreboard && !h.loadoutOpen && !h.customizingControls && <HealthBar h={h} now={now} />}
      {!h.alive && h.ready && !scoreboard && !paused && !h.loadoutOpen && <DeathRecap h={h} now={now} />}
    </div>
    {h.ready && h.alive && !h.mobilePortrait && !paused && !h.loadoutOpen && !scoreboard && !h.customizingControls && h.conn === "connected" && h.phase !== "ended" && game && <WeaponBar game={game} />}
    {h.loadoutOpen && h.ready && !failed && h.conn === "connected" && h.phase !== "ended" && game && <LoadoutPanel game={game} />}
    {h.touch && !h.mobilePortrait && h.ready && (h.alive || h.customizingControls) && !h.menu && !h.loadoutOpen && h.conn === "connected" && h.phase !== "ended" && game && <MobileControls game={game} />}
    {h.emoteMenu && h.ready && h.alive && !paused && !scoreboard && !h.loadoutOpen && !h.customizingControls && h.conn === "connected" && game && <EmoteMenu game={game} touch={h.touch} />}
    {scoreboard && <div className="scoreboard"><span className="eyebrow">{h.phase === "ended" ? "MATCH COMPLETE" : "FIELD REPORT"}</span><h2>{h.phase === "ended" ? winner : h.roomName}</h2><table><thead><tr><th>PLAYER</th><th>K</th><th>D</th><th>A</th><th>SCORE</th><th>PING</th></tr></thead><tbody>{h.players.map((p) => <tr key={p.id} className={p.me ? "self" : ""}><td><span className={p.team === 1 ? "blue" : p.team === 2 ? "red" : ""}>{p.name}</span>{p.me ? " (YOU)" : p.bot ? " [BOT]" : ""}{!p.connected && " · OFFLINE"}</td><td>{p.kills}</td><td>{p.deaths}</td><td>{p.assists}</td><td>{p.score}</td><td>{p.bot ? "—" : p.ping}</td></tr>)}</tbody></table>{h.phase === "ended" && <p>Next match in {seconds}s <button onClick={onLeave}>Leave match</button></p>}</div>}
    {h.help && h.ready && <HowToPlay touch={h.touch} locked={h.locked && !paused} onClose={() => hud().set({ help: false })} />}
    {(!h.ready || failed || h.conn === "reconnecting" || (paused && !scoreboard)) && <div className="modal-shade"><div className="match-modal">
      <span className="eyebrow">HOLLOWMERE / {h.code}</span>
      <h2>{failed ? "Connection interrupted" : h.conn === "reconnecting" ? "Reconnecting…" : !h.ready ? `Loading ${MAPS[map].name}…` : "Ready to deploy?"}</h2>
      {failed ? <p role="alert">{h.error}</p> : !h.ready ? <p>Preparing terrain, collision and character rigs.</p> : h.conn === "reconnecting" ? <p>Waiting for the game server.</p> : <>
        <p>{h.roomName} · {MODE_INFO[h.mode].name} · Room <b>{h.code}</b></p>
        <RoomInvite code={h.code} />
        <button className="primary-button" onClick={() => game?.resume()}>ENTER MATCH <span>↗</span></button>
        {!h.touch && <button className="outline-button" onClick={() => game?.resume(true)}>ENTER FULLSCREEN MATCH</button>}
        {h.touch && <button className="outline-button" onClick={() => { game?.input.releaseAll(); hud().set({ menu: false, customizingControls: true }); }}>CUSTOMIZE TOUCH CONTROLS</button>}
        <button className="outline-button" onClick={() => hud().set({ help: true })}>HOW TO PLAY · CONTROLS</button>
        {game && <LoadoutPicker game={game} />}
        <details className="settings-details"><summary>GAME SETTINGS & CONTROLS</summary><SettingsPanel /><p className="controls-help">WASD move · Mouse aim · Click fire · Right-click ADS · Shift sprint · Space jump · Ctrl crouch · Q / E peek · R reload · 1 / 2 or wheel switch · Hold C grenade · V camera · T emote · Tab scores</p></details>
        <p className="controls-help">WASD to move, mouse to aim, click to shoot. Press H for all controls, Esc to pause and invite friends.</p>
      </>}
      <button className="outline-button" onClick={onLeave}>RETURN TO LOBBY</button>
    </div></div>}
  </>;
}
