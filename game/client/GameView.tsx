"use client";

import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { getVillage } from "../shared/map/village";
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
import { OPTICS } from "../shared/optics";

class SceneBoundary extends Component<{ children: ReactNode; onLeave: () => void }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div className="match-modal"><h2>Unable to load the match</h2><p role="alert">{this.state.error}</p><button onClick={this.props.onLeave}>Return to lobby</button></div> : this.props.children; }
}

function Runtime({ room, onGame }: { room: GameRoom; onGame: (game: Game | null) => void }) {
  const { scene, camera, gl } = useThree();
  const ref = useRef<Game | null>(null);
  useEffect(() => {
    const game = new Game(room, scene, camera as THREE.PerspectiveCamera, gl.domElement);
    ref.current = game; onGame(game);
    let live = true;
    void game.init().catch((e: unknown) => { if (live) hud().set({ conn: "error", error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; ref.current = null; onGame(null); game.dispose(); };
  }, [room, scene, camera, gl, onGame]);
  useFrame((state, dt) => ref.current?.update(dt, state.size.height, state.gl.getPixelRatio()), -1);
  return null;
}

export default function GameView({ room, onLeave }: { room: GameRoom; onLeave: () => void }) {
  const quality = useSettings((s) => s.quality);
  const p = PRESETS[quality];
  const [game, setGame] = useState<Game | null>(null);
  const [screenMessage, setScreenMessage] = useState("");
  const fullscreenAttempted = useRef(false);
  useEffect(() => () => { if (game?.input.touch) void exitMobileFullscreen(); }, [game]);
  return <div className="game-view" onPointerDownCapture={(e) => {
    if (!game?.input.touch || !hud().ready || fullscreenAttempted.current || (e.target as HTMLElement).closest('[aria-label="Mobile screen options"], [aria-label="Landscape required"]')) return;
    fullscreenAttempted.current = true;
    void enterMobileFullscreen(e.currentTarget).then(setScreenMessage);
  }}>
    <SceneBoundary onLeave={onLeave}>
      <Canvas shadows={p.shadows ? { type: THREE.PCFShadowMap } : false} dpr={p.dpr} camera={{ fov: 78, near: 0.04, far: p.drawDistance }} gl={{ antialias: false, powerPreference: "high-performance" }}>
        <PerformanceTuner />
        <Suspense fallback={null}><SkyAndSun /><Ground /><StaticWorld map={getVillage()} /><PostFX /><Runtime room={room} onGame={setGame} /></Suspense>
      </Canvas>
      <MatchHud game={game} onLeave={onLeave} />
      <GraphicsControl />
      {game?.input.touch && <MobileScreen message={screenMessage} setMessage={setScreenMessage} onLeave={onLeave} />}
    </SceneBoundary>
  </div>;
}

function MatchHud({ game, onLeave }: { game: Game | null; onLeave: () => void }) {
  const h = useHud();
  const showFps = useSettings((s) => s.showFps);
  const clearView = useSettings((s) => s.clearView);
  const [now, setNow] = useState(0);
  const optic = useLoadout((s) => s.optics[h.weapon]);
  useEffect(() => { const timer = setInterval(() => setNow(performance.now()), 100); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.ceil((h.phaseEndsAt - now - h.serverOffset) / 1000));
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const paused = h.ready && !h.loadoutOpen && ((!h.locked && !h.touch) || h.menu);
  const failed = h.conn === "error" || h.conn === "left";
  const scoreboard = h.scoreboard || h.phase === "ended";
  const winner = h.winner === "draw" ? "Draw" : h.mode === "tdm" ? `${TEAM_NAMES[Number(h.winner) as 1 | 2] ?? ""} team wins` : `${h.players.find((p) => p.id === h.winner)?.name ?? "Player"} wins`;
  return <>
    <div className="hud-layer">
      <div className="match-top"><span className="match-mode">{MODE_INFO[h.mode].name}<small>{h.code} · {h.phase.toUpperCase()}</small></span><div className="match-score">{h.mode === "tdm" && <b className="blue">{h.team1}</b>}<span>{time}<small>FIRST TO {h.scoreLimit}</small></span>{h.mode === "tdm" && <b className="red">{h.team2}</b>}</div><span className="match-stats">{h.ping} MS{showFps && <small>{h.fps} FPS</small>}</span></div>
      <div className="killfeed">{h.killfeed.filter((k) => now - k.at < 7000).map((k) => <div key={k.key} className={k.mine ? "mine" : ""}><b>{k.killer}</b><span>{k.headshot ? "⌖ " : ""}{k.weapon.toUpperCase()}</span>{k.victim}</div>)}</div>
      {h.ready && h.alive && !paused && !scoreboard && <>
        {!clearView && h.ads > 0.1 && !h.scoped && <div className="ads-vignette" style={{ opacity: h.ads * 0.45 }} />}
        {h.scoped ? <Scope enemy={h.enemyInSight} ads={h.ads} fov={h.cameraFov} /> : <div aria-label={h.enemyInSight ? "Enemy in sights" : "Crosshair"} className={`crosshair ${h.enemyInSight ? "enemy-sighted" : ""} ${h.ads > 0.5 ? "aiming" : ""} ${h.ads > 0.5 && optic === "red-dot" ? "red-dot-sight" : ""}`} style={{ width: h.crosshairRadius * 2, height: h.crosshairRadius * 2 }}><i /><b /><em /><span /></div>}
        {h.hitmarker.at > 0 && now - h.hitmarker.at < 200 && <div className={`hitmarker ${h.hitmarker.kill ? "kill" : ""} ${h.hitmarker.confirmed ? "confirmed" : "predicted"}`}>×</div>}
        {h.hitmarker.confirmed && now - h.hitmarker.at < 650 && <div className="hit-confirm">{h.hitmarker.kill ? "ELIMINATED" : `${h.hitmarker.damage} DAMAGE`}{h.hitmarker.head && " · HEADSHOT"}</div>}
        {h.hurtAt > 0 && now - h.hurtAt < 550 && <div className="hurt-vignette" />}
        {h.protectedUntil > now + h.serverOffset && <div className="protected">SPAWN PROTECTION</div>}
      </>}
      {h.announce && now - h.announce.at < 3000 && <div className="announcement"><h2>{h.announce.text}</h2><p>{h.announce.sub}</p></div>}
      <div className="hud-bottom"><div className="health"><small>HEALTH</small><strong>{h.hp}<span> / 100</span></strong><div><i style={{ width: `${h.hp}%` }} /></div></div><div className="hud-hints">WASD MOVE · R RELOAD · G GRENADE · V CAMERA<br />TAB SCORES · ESC PAUSE</div><div className="ammo"><small>{WEAPONS[h.weapon].name} · {h.thirdPerson ? "TPP" : "FPP"}</small><strong>{h.mag}<span> / {h.reserve}</span></strong><small>{h.reloading >= 0 ? `RELOADING ${Math.round(h.reloading * 100)}%` : `${h.grenades} GRENADES`}</small></div></div>
      {!h.alive && h.ready && !scoreboard && !paused && <div className="death-card"><span className="eyebrow">ELIMINATED</span><h2>{h.killedBy?.name ?? "Returning to the field"}</h2><p>Respawning in {Math.max(0, Math.ceil((h.respawnAt - now - h.serverOffset) / 1000))}s</p></div>}
    </div>
    {h.ready && !h.mobilePortrait && !paused && !h.loadoutOpen && !scoreboard && !h.customizingControls && h.conn === "connected" && h.phase !== "ended" && game && <WeaponBar game={game} />}
    {h.loadoutOpen && h.ready && !failed && h.conn === "connected" && h.phase !== "ended" && game && <LoadoutPanel game={game} />}
    {h.touch && !h.mobilePortrait && h.ready && (h.alive || h.customizingControls) && !h.menu && !h.loadoutOpen && h.conn === "connected" && h.phase !== "ended" && game && <MobileControls game={game} />}
    {scoreboard && <div className="scoreboard"><span className="eyebrow">{h.phase === "ended" ? "MATCH COMPLETE" : "FIELD REPORT"}</span><h2>{h.phase === "ended" ? winner : h.roomName}</h2><table><thead><tr><th>PLAYER</th><th>K</th><th>D</th><th>SCORE</th><th>PING</th></tr></thead><tbody>{h.players.map((p) => <tr key={p.id} className={p.me ? "self" : ""}><td><span className={p.team === 1 ? "blue" : p.team === 2 ? "red" : ""}>{p.name}</span>{p.me ? " (YOU)" : p.bot ? " [BOT]" : ""}{!p.connected && " · OFFLINE"}</td><td>{p.kills}</td><td>{p.deaths}</td><td>{p.score}</td><td>{p.bot ? "—" : p.ping}</td></tr>)}</tbody></table>{h.phase === "ended" && <p>Next match in {seconds}s <button onClick={onLeave}>Leave match</button></p>}</div>}
    {(!h.ready || failed || h.conn === "reconnecting" || (paused && !scoreboard)) && <div className="modal-shade"><div className="match-modal">
      <span className="eyebrow">HOLLOWMERE / {h.code}</span>
      <h2>{failed ? "Connection interrupted" : h.conn === "reconnecting" ? "Reconnecting…" : !h.ready ? "Loading the village…" : "Ready to deploy?"}</h2>
      {failed ? <p role="alert">{h.error}</p> : !h.ready ? <p>Preparing terrain, collision and character rigs.</p> : h.conn === "reconnecting" ? <p>Waiting for the game server.</p> : <>
        <p>{h.roomName} · {MODE_INFO[h.mode].name} · Room <b>{h.code}</b></p>
        <RoomInvite code={h.code} />
        <button className="primary-button" onClick={() => game?.resume()}>ENTER MATCH <span>↗</span></button>
        {!h.touch && <button className="outline-button" onClick={() => game?.resume(true)}>ENTER FULLSCREEN MATCH</button>}
        {h.touch && <button className="outline-button" onClick={() => { game?.input.releaseAll(); hud().set({ menu: false, customizingControls: true }); }}>CUSTOMIZE TOUCH CONTROLS</button>}
        {game && <LoadoutPicker game={game} />}
        <details className="settings-details"><summary>GAME SETTINGS & CONTROLS</summary><SettingsPanel /><p className="controls-help">WASD move · Mouse aim · Click fire · Right-click ADS · Shift sprint · Space jump · C crouch · R reload · Q switch · Hold G grenade · V camera · Tab scores</p></details>
        <p className="controls-help">WASD to move, mouse to aim, click to shoot. Press Esc to pause and invite friends.</p>
      </>}
      <button className="outline-button" onClick={onLeave}>RETURN TO LOBBY</button>
    </div></div>}
  </>;
}

function Scope({ enemy, ads, fov }: { enemy: boolean; ads: number; fov: number }) {
  const baseFov = useSettings((s) => s.fov);
  const weapon = useHud((s) => s.weapon);
  const optic = useLoadout((s) => s.optics[weapon]);
  const zoom = Math.tan(baseFov * Math.PI / 360) / Math.tan(fov * Math.PI / 360);
  return <div aria-label={enemy ? "Enemy in scope" : OPTICS[optic].name} className={`scope ${enemy ? "enemy-sighted" : ""}`} style={{ opacity: Math.min(1, (ads - 0.68) / 0.22) }}>
    <svg className="scope-reticle" viewBox="0 0 1000 1000" aria-hidden="true">
      <g className="reticle-lines" fill="none" strokeWidth="1.4">
        <path d="M0 500H490 M510 500H1000 M500 0V490 M500 510V1000" />
        {[100, 160, 220, 280].map((offset) => <g key={offset}><path d={`M${500 - offset} 491v18 M${500 + offset} 491v18 M491 ${500 - offset}h18 M491 ${500 + offset}h18`} /><path d={`M492 ${500 + offset + 30}h16 M496 ${500 + offset + 60}h8`} /></g>)}
        <path strokeWidth="5" d="M0 500H180 M820 500H1000 M500 820V1000" />
      </g>
      <g className="reticle-center" stroke="currentColor" fill="currentColor"><circle cx="500" cy="500" r="2.2" /><path fill="none" strokeWidth="1.2" d="M484 500h8 M508 500h8 M500 484v8 M500 508v8" /></g>
    </svg>
    <span className="scope-label">{OPTICS[optic].name.toUpperCase()} <b>{zoom.toFixed(1)}×</b></span>
  </div>;
}
