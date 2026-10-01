"use client";

import { useEffect, useState } from "react";
import { createRoom, joinByCode, joinErrorMessage, leaveCurrentRoom, listRooms, quickPlay, type GameRoom, type PublicRoom } from "./net/session";
import { useSettings, type Quality } from "./settings";
import { MODE_INFO, type GameMode } from "../shared/constants";
import type { JoinOptions } from "../shared/messages";
import GameView from "./GameView";
import { audio } from "./core/audio";
import { parseRoomCode } from "./net/invite";

export default function Shooter() {
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const [online, setOnline] = useState(false);
  const [name, setName] = useState(useSettings.getState().name || "Ranger");
  const [code, setCode] = useState(() => parseRoomCode(window.location.href));
  const [mode, setMode] = useState<GameMode>("tdm");
  const [character, setCharacter] = useState(0);
  const [privateRoom, setPrivateRoom] = useState(false);
  const [bots, setBots] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (room) return;
    let live = true;
    const refresh = async () => {
      try { const result = await listRooms(); if (live) { setRooms(result); setOnline(true); } }
      catch { if (live) { setRooms([]); setOnline(false); } }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [room]);

  async function join(kind: "quick" | "create" | "code", selectedCode = code) {
    if (busy) return;
    setBusy(true); setError(""); audio.unlock();
    const playerName = name.trim().slice(0, 20) || "Ranger";
    useSettings.getState().set({ name: playerName });
    const opts: JoinOptions = { name: playerName, char: character, mode };
    try {
      const joined = await (kind === "code" ? joinByCode(parseRoomCode(selectedCode), opts) : kind === "quick" ? quickPlay(opts) : createRoom({
        ...opts, create: { mode, maxPlayers: 12, bots, botSkill: 1, private: privateRoom, roomName: `${playerName}'s match` },
      }));
      setRoom(joined);
    } catch (e) { setError(joinErrorMessage(e)); }
    finally { setBusy(false); }
  }

  async function leave() { await leaveCurrentRoom(); setRoom(null); audio.dispose(); }
  if (room) return <GameView room={room} onLeave={() => void leave()} />;

  return <main className="lobby">
    <div className="lobby-grain" />
    <header className="lobby-top"><a className="wordmark" href="">H / M</a><span className={online ? "status online" : "status"}>{online ? "SERVER ONLINE" : "SERVER OFFLINE"}</span></header>
    <section className="lobby-intro"><span className="eyebrow">MULTIPLAYER · VILLAGE COMBAT</span><h1>HOLLOW<br /><em>MERE</em><span className="title-dot">.</span></h1><p>Quiet streets. Open season.<br />Gear up for close-quarters combat in a forgotten village.</p><div className="map-tag"><span>01</span> THE VILLAGE <small>12 PLAYERS / 5 WEAPONS</small></div></section>
    <section className="lobby-panel" aria-label="Play Hollowmere">
      <div className="panel-heading"><span className="eyebrow">DEPLOYMENT</span><span>01 — READY UP</span></div>
      <fieldset disabled={busy}>
        {parseRoomCode(code) && <div className="invite-banner">YOU HAVE AN INVITE <b>{parseRoomCode(code)}</b><button onClick={() => void join("code")}>JOIN THIS ROOM →</button></div>}
        <label>CALLSIGN<input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="nickname" /></label>
        <div className="field-row"><label>CHARACTER<select value={character} onChange={(e) => setCharacter(Number(e.target.value))}><option value={0}>Ranger / Male</option><option value={1}>Ranger / Female</option></select></label><label>MODE<select aria-label="Game mode" value={mode} onChange={(e) => setMode(e.target.value as GameMode)}><option value="tdm">Team Deathmatch</option><option value="ffa">Free for All</option></select></label></div>
        <button className="primary-button" onClick={() => void join("quick")}>{busy ? "CONNECTING…" : "QUICK PLAY"}<span>↗</span></button>
        <div className="field-row"><label>FILL MATCH TO<select value={bots} onChange={(e) => setBots(Number(e.target.value))}><option value={0}>No bots</option><option value={4}>4 players</option><option value={8}>8 players</option><option value={12}>12 players</option></select></label><label className="check-label"><input type="checkbox" checked={privateRoom} onChange={(e) => setPrivateRoom(e.target.checked)} /> Private room</label></div>
        <button className="outline-button" onClick={() => void join("create")}>CREATE {MODE_INFO[mode].name.toUpperCase()}</button>
        <div className="join-code"><input aria-label="Room code" placeholder="ROOM CODE OR INVITE LINK" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && parseRoomCode(code)) void join("code"); }} /><button disabled={!parseRoomCode(code)} onClick={() => void join("code")}>JOIN →</button></div>
      </fieldset>
      {error && <p role="alert" className="error-text">{error}</p>}
      <details className="settings-details"><summary>SETTINGS & CONTROLS</summary><SettingsPanel /><p className="controls-help">WASD move · Mouse aim · Click fire · Right-click ADS · Shift sprint · Space jump · C crouch · R reload · 1 / 2 / Q switch · Hold G to cook, release to throw · V camera · Tab scores · Esc pause</p></details>
    </section>
    <section className="room-browser"><div className="panel-heading"><span>OPEN MATCHES</span><span>{rooms.length.toString().padStart(2, "0")} AVAILABLE</span></div>{rooms.length ? rooms.map((r) => <button className="room-row" key={r.code} disabled={busy || r.locked} onClick={() => void join("code", r.code)}><span>{r.name}<small>{MODE_INFO[r.mode]?.name} · {r.code}</small></span><span>{r.humans} HUMAN / {r.bots} BOT <b>↗</b></span></button>) : <p>{online ? "The village is quiet. Create a match and bring it to life." : "Start the game server with npm run dev to open the village."}</p>}</section>
    <footer className="lobby-footer"><span>HOLLOWMERE / FIELD OPERATIONS</span><span>FPP + TPP · INSTANT RESPAWN MATCHES</span></footer>
  </main>;
}

export function SettingsPanel() {
  const s = useSettings();
  return <div className="settings-grid">
    <label>QUALITY<select value={s.quality} onChange={(e) => s.set({ quality: e.target.value as Quality })}>{["low", "medium", "high", "ultra"].map((q) => <option key={q}>{q}</option>)}</select></label>
    <label>VOLUME {Math.round(s.volume * 100)}%<input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => s.set({ volume: Number(e.target.value) })} /></label>
    <label>SENSITIVITY {s.sensitivity.toFixed(1)}<input type="range" min={0.2} max={3} step={0.1} value={s.sensitivity} onChange={(e) => s.set({ sensitivity: Number(e.target.value) })} /></label>
    <label>ADS SENSITIVITY {s.adsSensitivity.toFixed(1)}<input type="range" min={0.2} max={1.5} step={0.1} value={s.adsSensitivity} onChange={(e) => s.set({ adsSensitivity: Number(e.target.value) })} /></label>
    <label>FIELD OF VIEW {s.fov}°<input type="range" min={60} max={110} value={s.fov} onChange={(e) => s.set({ fov: Number(e.target.value) })} /></label>
    <label className="check-label"><input type="checkbox" checked={s.thirdPerson} onChange={(e) => s.set({ thirdPerson: e.target.checked })} /> Third-person camera</label>
    <label className="check-label"><input type="checkbox" checked={s.showFps} onChange={(e) => s.set({ showFps: e.target.checked })} /> Show performance</label>
    <label className="check-label"><input type="checkbox" checked={s.adaptiveResolution} onChange={(e) => s.set({ adaptiveResolution: e.target.checked })} /> Auto-adjust resolution</label>
    <p className="controls-help settings-note">Graphics apply immediately. Press F6 during a match to cycle quality. Auto resolution helps keep play smooth when your PC is busy.</p>
  </div>;
}
