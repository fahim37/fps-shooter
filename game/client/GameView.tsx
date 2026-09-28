"use client";

import { Component, Suspense, useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { getVillage } from "../shared/map/village";
import { MODE_INFO, TEAM_NAMES } from "../shared/constants";
import { PRIMARIES, WEAPONS, type WeaponId } from "../shared/weapons";
import type { GameRoom } from "./net/session";
import { Game } from "./core/game";
import { hud, useHud } from "./core/hud";
import { PRESETS, useSettings } from "./settings";
import { SkyAndSun } from "./world/SkyAndSun";
import { Ground } from "./world/Ground";
import { StaticWorld } from "./world/StaticWorld";
import { PostFX } from "./world/PostFX";
import { SettingsPanel } from "./Shooter";
import { inviteUrl } from "./net/invite";

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
  useFrame((state, dt) => ref.current?.update(dt, state.size.height * state.gl.getPixelRatio()), -1);
  return null;
}

export default function GameView({ room, onLeave }: { room: GameRoom; onLeave: () => void }) {
  const quality = useSettings((s) => s.quality);
  const p = PRESETS[quality];
  const [game, setGame] = useState<Game | null>(null);
  return <div className="game-view">
    <SceneBoundary onLeave={onLeave}>
      <Canvas shadows={p.shadows ? { type: THREE.PCFShadowMap } : false} dpr={p.dpr} camera={{ fov: 78, near: 0.04, far: 600 }} gl={{ antialias: false, powerPreference: "high-performance" }}>
        <Suspense fallback={null}><SkyAndSun /><Ground /><StaticWorld map={getVillage()} /><PostFX /><Runtime room={room} onGame={setGame} /></Suspense>
      </Canvas>
      <MatchHud game={game} onLeave={onLeave} />
    </SceneBoundary>
  </div>;
}

function MatchHud({ game, onLeave }: { game: Game | null; onLeave: () => void }) {
  const h = useHud();
  const showFps = useSettings((s) => s.showFps);
  const [now, setNow] = useState(0);
  const [loadout, setLoadout] = useState<WeaponId>("ar");
  useEffect(() => { const timer = setInterval(() => setNow(performance.now()), 100); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.ceil((h.phaseEndsAt - now - h.serverOffset) / 1000));
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const paused = h.ready && ((!h.locked && !h.touch) || h.menu);
  const failed = h.conn === "error" || h.conn === "left";
  const scoreboard = h.scoreboard || h.phase === "ended";
  const winner = h.winner === "draw" ? "Draw" : h.mode === "tdm" ? `${TEAM_NAMES[Number(h.winner) as 1 | 2] ?? ""} team wins` : `${h.players.find((p) => p.id === h.winner)?.name ?? "Player"} wins`;
  return <>
    <div className="hud-layer">
      <div className="match-top"><span className="match-mode">{MODE_INFO[h.mode].name}<small>{h.code} · {h.phase.toUpperCase()}</small></span><div className="match-score">{h.mode === "tdm" && <b className="blue">{h.team1}</b>}<span>{time}<small>FIRST TO {h.scoreLimit}</small></span>{h.mode === "tdm" && <b className="red">{h.team2}</b>}</div><span className="match-stats">{h.ping} MS{showFps && <small>{h.fps} FPS</small>}</span></div>
      <div className="killfeed">{h.killfeed.filter((k) => now - k.at < 7000).map((k) => <div key={k.key} className={k.mine ? "mine" : ""}><b>{k.killer}</b><span>{k.headshot ? "⌖ " : ""}{k.weapon.toUpperCase()}</span>{k.victim}</div>)}</div>
      {h.ready && h.alive && !paused && !scoreboard && <>
        {h.scoped ? <div className="scope"><i /><b /></div> : <div className="crosshair" style={{ width: 8 + h.spreadDeg * 5, height: 8 + h.spreadDeg * 5 }}><i /><b /><em /><span /></div>}
        {h.hitmarker.at > 0 && now - h.hitmarker.at < 200 && <div className={`hitmarker ${h.hitmarker.kill ? "kill" : ""} ${h.hitmarker.confirmed ? "confirmed" : "predicted"}`}>×</div>}
        {h.hitmarker.confirmed && now - h.hitmarker.at < 650 && <div className="hit-confirm">{h.hitmarker.kill ? "ELIMINATED" : `${h.hitmarker.damage} DAMAGE`}{h.hitmarker.head && " · HEADSHOT"}</div>}
        {h.hurtAt > 0 && now - h.hurtAt < 550 && <div className="hurt-vignette" />}
        {h.protectedUntil > now + h.serverOffset && <div className="protected">SPAWN PROTECTION</div>}
      </>}
      {h.announce && now - h.announce.at < 3000 && <div className="announcement"><h2>{h.announce.text}</h2><p>{h.announce.sub}</p></div>}
      <div className="hud-bottom"><div className="health"><small>HEALTH</small><strong>{h.hp}<span> / 100</span></strong><div><i style={{ width: `${h.hp}%` }} /></div></div><div className="hud-hints">WASD MOVE · R RELOAD · G GRENADE · V CAMERA<br />TAB SCORES · ESC PAUSE</div><div className="ammo"><small>{WEAPONS[h.weapon].name} · {h.thirdPerson ? "TPP" : "FPP"}</small><strong>{h.mag}<span> / {h.reserve}</span></strong><small>{h.reloading >= 0 ? `RELOADING ${Math.round(h.reloading * 100)}%` : `${h.grenades} GRENADES`}</small></div></div>
      {!h.alive && h.ready && !scoreboard && !paused && <div className="death-card"><span className="eyebrow">ELIMINATED</span><h2>{h.killedBy?.name ?? "Returning to the field"}</h2><p>Respawning in {Math.max(0, Math.ceil((h.respawnAt - now - h.serverOffset) / 1000))}s</p></div>}
    </div>
    {h.touch && h.ready && !h.menu && game && <TouchControls game={game} />}
    {scoreboard && <div className="scoreboard"><span className="eyebrow">{h.phase === "ended" ? "MATCH COMPLETE" : "FIELD REPORT"}</span><h2>{h.phase === "ended" ? winner : h.roomName}</h2><table><thead><tr><th>PLAYER</th><th>K</th><th>D</th><th>SCORE</th><th>PING</th></tr></thead><tbody>{h.players.map((p) => <tr key={p.id} className={p.me ? "self" : ""}><td><span className={p.team === 1 ? "blue" : p.team === 2 ? "red" : ""}>{p.name}</span>{p.me ? " (YOU)" : p.bot ? " [BOT]" : ""}{!p.connected && " · OFFLINE"}</td><td>{p.kills}</td><td>{p.deaths}</td><td>{p.score}</td><td>{p.bot ? "—" : p.ping}</td></tr>)}</tbody></table>{h.phase === "ended" && <p>Next match in {seconds}s <button onClick={onLeave}>Leave match</button></p>}</div>}
    {(!h.ready || failed || h.conn === "reconnecting" || (paused && !scoreboard)) && <div className="modal-shade"><div className="match-modal">
      <span className="eyebrow">HOLLOWMERE / {h.code}</span>
      <h2>{failed ? "Connection interrupted" : h.conn === "reconnecting" ? "Reconnecting…" : !h.ready ? "Loading the village…" : "Ready to deploy?"}</h2>
      {failed ? <p role="alert">{h.error}</p> : !h.ready ? <p>Preparing terrain, collision and character rigs.</p> : h.conn === "reconnecting" ? <p>Waiting for the game server.</p> : <>
        <p>{h.roomName} · {MODE_INFO[h.mode].name} · Room <b>{h.code}</b></p>
        <RoomInvite code={h.code} />
        <button className="primary-button" onClick={() => game?.resume()}>ENTER MATCH <span>↗</span></button>
        <label>NEXT SPAWN LOADOUT<select value={loadout} onChange={(e) => { const w = e.target.value as WeaponId; setLoadout(w); game?.send("loadout", { primary: w }); }}>{PRIMARIES.map((w) => <option key={w} value={w}>{WEAPONS[w].name}</option>)}</select></label>
        <details className="settings-details"><summary>GAME SETTINGS & CONTROLS</summary><SettingsPanel /><p className="controls-help">WASD move · Mouse aim · Click fire · Right-click ADS · Shift sprint · Space jump · C crouch · R reload · Q switch · Hold G grenade · V camera · Tab scores</p></details>
        <p className="controls-help">WASD to move, mouse to aim, click to shoot. Press Esc to pause and invite friends.</p>
      </>}
      <button className="outline-button" onClick={onLeave}>RETURN TO LOBBY</button>
    </div></div>}
  </>;
}

function RoomInvite({ code }: { code: string }) {
  const [message, setMessage] = useState("");
  const url = inviteUrl(code, window.location.href);
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setMessage(`${label} copied. Send it to your friends.`); }
    catch { setMessage("Select and copy the invite link below."); }
  }
  return <div className="room-invite">
    <div><span>INVITE FRIENDS</span><strong>{code}</strong></div>
    <div className="invite-actions"><button aria-label="Copy invite link" onClick={() => void copy(url, "Invite link")}>COPY INVITE LINK ↗</button><button aria-label="Copy room code" onClick={() => void copy(code, "Room code")}>COPY CODE</button></div>
    <input aria-label="Invite link" value={url} readOnly onFocus={(e) => e.target.select()} />
    {message && <small role="status">{message}</small>}
  </div>;
}

function TouchControls({ game }: { game: Game }) {
  const input = game.input;
  const moveStart = useRef<{ x: number; y: number } | null>(null);
  const lookStart = useRef<{ x: number; y: number } | null>(null);
  const capture = (e: PointerEvent) => e.currentTarget.setPointerCapture(e.pointerId);
  function action(label: string, down: () => void, up: () => void = () => {}) {
    return <button key={label} onPointerDown={(e) => { capture(e); down(); }} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>{label}</button>;
  }
  return <div className="touch-controls">
    <div className="touch-look" aria-label="Drag to look" onPointerDown={(e) => { capture(e); lookStart.current = { x: e.clientX, y: e.clientY }; }} onPointerMove={(e) => { if (lookStart.current) { input.addLook(e.clientX - lookStart.current.x, e.clientY - lookStart.current.y); lookStart.current = { x: e.clientX, y: e.clientY }; } }} onLostPointerCapture={() => { lookStart.current = null; }} />
    <div className="touch-stick" aria-label="Movement joystick" onPointerDown={(e) => { capture(e); moveStart.current = { x: e.clientX, y: e.clientY }; }} onPointerMove={(e) => { if (moveStart.current) input.setStick({ x: THREE.MathUtils.clamp((e.clientX - moveStart.current.x) / 45, -1, 1), y: THREE.MathUtils.clamp((moveStart.current.y - e.clientY) / 45, -1, 1) }); }} onLostPointerCapture={() => { moveStart.current = null; input.setStick(null); }}>MOVE</div>
    <div className="touch-actions">{action("FIRE", () => { input.setAction("fire", true); }, () => { input.setAction("fire", false); })}{action("ADS", () => { input.setAction("ads", true); }, () => { input.setAction("ads", false); })}{action("JUMP", () => { input.setAction("jump", true); }, () => { input.setAction("jump", false); })}{action("RELOAD", () => input.press("KeyR"))}{action("SWITCH", () => input.press("KeyQ"))}{action("GRENADE", () => input.hold("KeyG", true), () => input.hold("KeyG", false))}</div>
    <button className="touch-menu" onClick={() => { input.releaseAll(); hud().set({ menu: true }); }}>MENU</button>
  </div>;
}
