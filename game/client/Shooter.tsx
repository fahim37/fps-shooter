"use client";

import { useEffect, useRef, useState } from "react";
import { createRoom, joinByCode, joinErrorMessage, leaveCurrentRoom, listRooms, quickPlay, type GameRoom, type PublicRoom } from "./net/session";
import { useSettings } from "./settings";
import { MODE_INFO, type GameMode } from "../shared/constants";
import type { JoinOptions } from "../shared/messages";
import { audio } from "./core/audio";
import { parseRoomCode } from "./net/invite";
import { ConnectedRoom } from "./RoomLobby";
import { SettingsPanel } from "./SettingsPanel";

type PlayTab = "friends" | "quick" | "join";
type Format = "1v1" | "2v2" | "custom";

export default function Shooter() {
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [name, setName] = useState(useSettings.getState().name || "Ranger");
  const [code, setCode] = useState(() => parseRoomCode(window.location.href));
  const [tab, setTab] = useState<PlayTab>(() => parseRoomCode(window.location.href) ? "join" : "friends");
  const [mode, setMode] = useState<GameMode>("tdm");
  const [format, setFormat] = useState<Format>("1v1");
  const [character, setCharacter] = useState(0);
  const [privateRoom, setPrivateRoom] = useState(true);
  const [bots, setBots] = useState(0);
  const [maxPlayers, setMaxPlayers] = useState(12);
  const [roomName, setRoomName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const joining = useRef(false);

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
  }, [room, refreshKey]);

  async function join(kind: "quick" | "create" | "code", selectedCode = code) {
    if (joining.current) return;
    joining.current = true;
    setBusy(kind === "create" ? "Creating your room…" : kind === "quick" ? "Finding a match…" : "Joining room…");
    setError(""); audio.unlock();
    const playerName = name.trim().slice(0, 16) || "Ranger";
    useSettings.getState().set({ name: playerName });
    const opts: JoinOptions = { name: playerName, char: character, mode };
    try {
      const joined = await (kind === "code" ? joinByCode(parseRoomCode(selectedCode), opts) : kind === "quick" ? quickPlay(opts) : createRoom({
        ...opts, mode: format === "custom" ? mode : "tdm",
        create: { mode: format === "custom" ? mode : "tdm", format, lobby: true, maxPlayers: format === "1v1" ? 2 : format === "2v2" ? 4 : maxPlayers, bots: format === "custom" ? bots : 0, botSkill: 1, private: privateRoom, roomName: roomName.trim() || `${playerName}'s room` },
      }));
      setRoom(joined);
    } catch (e) { setError(joinErrorMessage(e)); }
    finally { joining.current = false; setBusy(""); }
  }

  async function leave() {
    await leaveCurrentRoom(); setRoom(null); audio.dispose();
    const url = new URL(window.location.href); url.searchParams.delete("room");
    window.history.replaceState(null, "", url); setCode(""); setError("");
  }
  if (room) return <ConnectedRoom room={room} onLeave={() => void leave()} />;

  const visibleRooms = rooms.filter((r) => (filter !== "humans" || r.botFill === 0) && (filter !== "waiting" || r.phase === "waiting") && `${r.name} ${r.code} ${r.format}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="lobby home-lobby">
    <div className="lobby-grain" />
    <header className="lobby-top"><span className="wordmark">H / M <small>HOLLOWMERE</small></span><span className={online ? "status online" : "status"}>{online === null ? "CHECKING SERVER…" : online ? "SERVER ONLINE" : "SERVER OFFLINE"}</span></header>
    <section className="lobby-intro"><span className="eyebrow">YOUR FRIENDS. YOUR TEAMS. YOUR MATCH.</span><h1>Better<br />with <em>friends</em><span className="title-dot">.</span></h1><p>A village. Two teams. A little friendly rivalry.<br />Create a room, share the invite and play on your terms.</p>
      <div className="map-brief"><span className="eyebrow">01 / THE VILLAGE</span><div className="village-mark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><strong>Small teams.<br />Big moments.</strong><div className="brief-tags"><span>1v1 & 2v2</span><span>5 weapons</span><span>FPP + TPP</span></div></div>
      <div className="lobby-steps"><span><b>01</b> Create a room</span><span><b>02</b> Invite your friends</span><span><b>03</b> Ready up & play</span></div>
    </section>
    <section className="lobby-panel" aria-label="Play Hollowmere">
      <div className="play-tabs" role="tablist" aria-label="How to play">{([ ["friends", "With friends"], ["quick", "Quick play"], ["join", "Join room"] ] as const).map(([id, label]) => <button key={id} role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`} aria-selected={tab === id} disabled={!!busy} onClick={() => { setTab(id); setError(""); }}>{label}</button>)}</div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <div className="play-heading"><span className="eyebrow">{tab === "friends" ? "MAKE IT YOUR MATCH" : tab === "quick" ? "STRAIGHT INTO THE ACTION" : "YOU’RE INVITED"}</span><h2>{tab === "friends" ? "Play with your people." : tab === "quick" ? "Jump into a match." : "Meet in the same room."}</h2><p>{tab === "friends" ? "Pick a format. Friends join with a code or invite link." : tab === "quick" ? "Join a public match. Bots fill empty slots so you can play right away." : "Paste a five-character room code or an invite link."}</p></div>
        <fieldset disabled={!!busy}>
          <div className="field-row player-fields"><label>CALLSIGN<input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} autoComplete="nickname" /></label><label>CHARACTER<select value={character} onChange={(e) => setCharacter(Number(e.target.value))}><option value={0}>Ranger / Male</option><option value={1}>Ranger / Female</option></select></label></div>
          {tab === "friends" && <>
            <span className="field-caption">MATCH FORMAT</span>
            <div className="format-options" role="group" aria-label="Match format">{([ ["1v1", "Duel", "2 players"], ["2v2", "Doubles", "4 players"], ["custom", "Custom", "Up to 12"] ] as const).map(([id, label, count]) => <button key={id} className={format === id ? "selected" : ""} aria-pressed={format === id} onClick={() => setFormat(id)}><strong>{id === "custom" ? "Custom" : id}</strong><span>{label}</span><small>{count}</small></button>)}</div>
            <p className="format-note">{format === "custom" ? "Your rules. Choose the mode, room size and optional practice bots." : `${format === "1v1" ? "One friend. One rival." : "Bring three friends and pick your teammate."} Players only. No bots, ever.`}</p>
            {format === "custom" && <><div className="field-row"><label>MODE<select aria-label="Game mode" value={mode} onChange={(e) => setMode(e.target.value as GameMode)}><option value="tdm">Team Deathmatch</option><option value="ffa">Free for All</option></select></label><label>ROOM SIZE<select value={maxPlayers} onChange={(e) => { const max = Number(e.target.value); setMaxPlayers(max); setBots(Math.min(bots, max)); }}>{[2, 4, 6, 8, 12].map((n) => <option key={n} value={n}>{n} players</option>)}</select></label></div><label>FILL MATCH TO<select value={bots} onChange={(e) => setBots(Number(e.target.value))}><option value={0}>No bots · Players only</option>{[2, 4, 8, 12].filter((n) => n <= maxPlayers).map((n) => <option key={n} value={n}>{n} players · Practice bots fill empty slots</option>)}</select></label></>}
            <div className="field-row room-options"><label>ROOM NAME <span className="optional">OPTIONAL</span><input value={roomName} maxLength={32} placeholder={`${name.trim() || "Ranger"}'s room`} onChange={(e) => setRoomName(e.target.value)} /></label><label className="check-label"><input type="checkbox" checked={privateRoom} onChange={(e) => setPrivateRoom(e.target.checked)} /> Private room<small>Only people with your invite can join.</small></label></div>
            <button className="primary-button" onClick={() => void join("create")}>{busy || `CREATE ${format === "custom" ? "CUSTOM" : format.toUpperCase()} ROOM`}<span>→</span></button><p className="action-help">You’ll enter a room lobby. The match starts when everyone is ready and you press Start.</p>
          </>}
          {tab === "quick" && <><label>MODE<select aria-label="Game mode" value={mode} onChange={(e) => setMode(e.target.value as GameMode)}><option value="tdm">Team Deathmatch</option><option value="ffa">Free for All</option></select></label><div className="quick-summary"><strong>Public matchmaking</strong><span>Up to 12 players · Practice bots enabled</span><span>Want a match without bots? Choose With friends.</span></div><button className="primary-button" onClick={() => void join("quick")}>{busy || "QUICK PLAY"}<span>→</span></button></>}
          {tab === "join" && <><label>ROOM CODE OR INVITE LINK<div className="join-code"><input aria-label="Room code" placeholder="e.g. ABC23 or paste an invite" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && parseRoomCode(code)) void join("code"); }} /><button disabled={!parseRoomCode(code)} onClick={() => void join("code")}>{busy || "JOIN ROOM →"}</button></div></label><p className="action-help">Ask your friend to copy the invite from their room lobby.</p></>}
        </fieldset>
        {busy && <p role="status" className="connection-progress">{busy}</p>}
        {error && <p role="alert" className="error-text">{error}</p>}
      </div>
      <details className="settings-details"><summary>SETTINGS & CONTROLS</summary><SettingsPanel /><p className="controls-help">WASD move · Mouse aim · Click fire · Right-click ADS · Shift sprint · Space jump · C crouch · R reload · Q switch · Hold G grenade · V camera · Tab scores · Esc pause</p></details>
    </section>
    <section className="room-browser" aria-label="Public rooms"><div className="browser-heading"><div><span className="eyebrow">FIND YOUR NEXT MATCH</span><h2>Open rooms <span>{visibleRooms.length}</span></h2></div><button className="text-button" disabled={!!busy} onClick={() => setRefreshKey((v) => v + 1)}>↻ Refresh</button></div><div className="browser-tools"><div className="room-filters" role="group" aria-label="Room filters">{([ ["all", "All rooms"], ["humans", "No bots"], ["waiting", "Waiting lobby"] ] as const).map(([id, label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? "selected" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><input aria-label="Search rooms" placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {visibleRooms.length ? visibleRooms.map((r) => <button className="room-row" key={r.code} disabled={!!busy || r.locked || r.humans >= r.max} onClick={() => void join("code", r.code)}><span>{r.name}<small>{r.format === "custom" ? MODE_INFO[r.mode]?.name : r.format} · {r.code} · {r.bots ? `${r.bots} bots` : r.phase === "waiting" ? "Room lobby" : "In progress"}</small></span><span>{r.humans} / {r.max} players <b>{r.locked ? "Unavailable" : "Join →"}</b></span></button>) : <div className="empty-rooms"><strong>{online === false ? "The server is unavailable." : online === null ? "Looking for open rooms…" : rooms.length ? "No rooms match your search." : "Your room could be the first."}</strong><p>{online === false ? "Try refreshing in a moment." : rooms.length ? "Try another filter or search." : "Create a public room to appear here, or invite friends to a private one."}</p></div>}
    </section>
    <footer className="lobby-footer"><span>HOLLOWMERE / FIELD OPERATIONS</span><span>PLAY TOGETHER. MAKE IT A GOOD MATCH.</span></footer>
  </main>;
}
