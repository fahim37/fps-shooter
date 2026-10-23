"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { assetUrl } from "./assets/url";
import { createRoom, joinByCode, joinErrorMessage, leaveCurrentRoom, listRooms, quickPlay, type GameRoom, type PublicRoom } from "./net/session";
import { useSettings } from "./settings";
import { MAX_PLAYERS, MODE_INFO, SCORE_LIMITS, scoreLimitFor, type GameMode } from "../shared/constants";
import type { JoinOptions } from "../shared/messages";
import { audio } from "./core/audio";
import { parseRoomCode } from "./net/invite";
import { LobbySounds } from "./lobbyAudio";
import { ConnectedRoom } from "./RoomLobby";
import { LobbyTools, SettingsDialog } from "./SettingsDialog";
import { CharacterShowcase } from "./CharacterShowcase";
import type { ShowoffId } from "../shared/showcase";
import { MAPS, mapId } from "../shared/map/maps";
import type { MapId } from "../shared/map/types";
import { MapPicker } from "./MapPicker";
import { HowToPlay } from "./HowToPlay";
import { NAME_MAX, randomName } from "../shared/names";

const MAP_KEY = "hollowmere.map";
/** Last chosen map, per browser (storage may be unavailable). */
function savedMap(): MapId {
  try { return mapId(window.localStorage.getItem(MAP_KEY)); } catch { return mapId(null); }
}

type PlayTab = "friends" | "quick" | "join";
type Format = "1v1" | "2v2" | "custom";

const TABS = [["quick", "Quick play"], ["friends", "With friends"], ["join", "Join room"]] as const;
/** Each play option gets an icon, and the operator strikes a pose to match when you switch to it. */
const TAB_ICONS: Record<PlayTab, ReactNode> = {
  quick: <path d="M13 2 5 13h6l-1 9 8-11h-6Z" />,
  friends: <><circle cx="9" cy="8" r="3.2" /><circle cx="16.5" cy="9" r="2.6" /><path d="M3 20c.5-3.8 3-5.8 6-5.8s5.5 2 6 5.8M15 14.6c3.2-.4 5.4 1.4 6 4.8" /></>,
  join: <><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" /><path d="M3 12h12M11 7.5 15.5 12 11 16.5" /></>,
};
const TAB_POSES: Record<PlayTab, ShowoffId> = { quick: "magic", friends: "dance", join: "talk" };

/** Every option on show at once, as a row of buttons, rather than hidden in a dropdown. */
function Choices<T extends string | number>({ label, hint, value, options, onChange, wide = false }: {
  label: string; hint?: string; value: T; options: readonly { value: T; text: string; name?: string }[]; onChange: (value: T) => void; wide?: boolean;
}) {
  return <div className={`choice-field ${wide ? "wide" : ""}`}>
    <span className="field-caption">{label}{hint && <em>{hint}</em>}</span>
    <div className="choice-row" role="radiogroup" aria-label={label.charAt(0) + label.slice(1).toLowerCase()}>
      {options.map((o) => <button type="button" role="radio" key={String(o.value)} aria-checked={o.value === value} aria-label={o.name} onClick={() => onChange(o.value)}>{o.text}</button>)}
    </div>
  </div>;
}
const FORMATS = [["1v1", "Duel", "2 players"], ["2v2", "Doubles", "4 players"], ["custom", "Your rules", `Up to ${MAX_PLAYERS}`]] as const;
/** A handful of room sizes: 2v2 up to 10v10 (or that many players in Free for All). */
const ROOM_SIZES = [4, 8, 12, 16, MAX_PLAYERS];

function CharacterPicker({ value, onChange }: { value: number; onChange: (char: number) => void }) {
  return <div className="character-picker" role="radiogroup" aria-label="Character">
    {(["Male", "Female"] as const).map((label, char) => <button key={char} type="button" role="radio" aria-checked={value === char} aria-label={`${label} Operator`} onClick={() => onChange(char)}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        {char === 1 && <path className="hair" d="M13.5 22c-1-9 4-15.5 10.5-15.5S35.5 13 34.5 22c-.3 5.5 1.5 9 4 11.5-5 1.2-9.5-.3-11.5-3.5h-5c-2 3.2-6.5 4.7-11.5 3.5 2.5-2.5 4.3-6 4-11.5z" />}
        <path d="M7 47c1-10.5 7.5-15.5 17-15.5S40 36.5 41 47z" /><circle cx="24" cy="19" r="9" />
      </svg>
      <strong>{label}</strong><small>OPERATOR</small>
    </button>)}
  </div>;
}

export default function Shooter() {
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  // New players get a random callsign (kept for next time) until they type their own.
  const [name, setName] = useState(() => {
    const saved = useSettings.getState().name;
    if (saved) return saved;
    const fresh = randomName();
    useSettings.getState().set({ name: fresh });
    return fresh;
  });
  const [code, setCode] = useState(() => parseRoomCode(window.location.href));
  // New players start with Quick play: one click into a match, no friend needed.
  const [tab, setTab] = useState<PlayTab>(() => parseRoomCode(window.location.href) ? "join" : "quick");
  const [mode, setMode] = useState<GameMode>("tdm");
  const [map, setMapState] = useState<MapId>(savedMap);
  const setMap = (next: MapId) => { setMapState(next); try { window.localStorage.setItem(MAP_KEY, next); } catch { /* not persisted */ } };
  const [format, setFormat] = useState<Format>("custom");
  const [character, setCharacter] = useState(0);
  const [joinTeam, setJoinTeam] = useState<0 | 1 | 2>(0);
  const [emote, setEmote] = useState<ShowoffId>("idle");
  const [privateRoom, setPrivateRoom] = useState(true);
  const [bots, setBots] = useState(0);
  const [maxPlayers, setMaxPlayers] = useState(12);
  /** Chosen score to win; 0 (or one not offered for the mode) uses the mode's default. */
  const [scoreTarget, setScoreTarget] = useState(0);
  const [roomName, setRoomName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const joining = useRef(false);
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);

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
    const playerName = name.trim().slice(0, NAME_MAX) || randomName();
    useSettings.getState().set({ name: playerName });
    const opts: JoinOptions = { name: playerName, char: character, mode, ...(kind === "code" ? { team: joinTeam } : { map }) };
    try {
      const joined = await (kind === "code" ? joinByCode(parseRoomCode(selectedCode), opts) : kind === "quick" ? quickPlay(opts) : createRoom({
        ...opts, mode: format === "custom" ? mode : "tdm",
        create: { mode: format === "custom" ? mode : "tdm", map, format, lobby: true, maxPlayers: format === "1v1" ? 2 : format === "2v2" ? 4 : maxPlayers, bots: format === "custom" ? bots : 0, botSkill: 1, private: privateRoom, roomName: roomName.trim() || `${playerName}'s room`, scoreLimit: scoreLimitFor(format === "custom" ? mode : "tdm", scoreTarget) },
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
  const roomMode: GameMode = format === "custom" ? mode : "tdm";
  const scoreSelect = <Choices label="SCORE TO WIN" hint="kills" value={scoreLimitFor(roomMode, scoreTarget)} onChange={setScoreTarget}
    options={SCORE_LIMITS[roomMode].map((n) => ({ value: n, text: String(n), name: `${n} kills` }))} />;
  const modeSelect = <Choices<GameMode> label="MODE" value={mode} onChange={setMode}
    options={[{ value: "tdm", text: "Team DM", name: "Team Deathmatch" }, { value: "ffa", text: "Free for All" }]} />;
  return <main className="lobby home-lobby" data-tab={tab} data-format={tab === "friends" ? format : undefined}>
    <LobbySounds />
    <div className="lobby-grain" aria-hidden="true" />
    <header className="lobby-top">
      <span className="wordmark" aria-label="Strikeline">
        <Image src={assetUrl("/brand/strikeline-emblem.png")} alt="" width={48} height={48} unoptimized priority />
        <span className="brand-name">STRIKELINE<small>SQUAD COMBAT · FOUR FRONTS</small></span>
      </span>
      <div className="top-tools">
        <span className={online ? "status online" : "status"}>{online === null ? "CHECKING SERVER…" : online ? "SERVER ONLINE" : "SERVER OFFLINE"}</span>
        <LobbyTools onHelp={() => setHelp(true)} onSettings={() => setSettings(true)} />
      </div>
    </header>
    <nav className="play-tabs" role="tablist" aria-label="Play options">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" id={`tab-${id}`} aria-controls="play-panel" aria-selected={tab === id} disabled={!!busy} onClick={() => { if (tab !== id) setEmote(TAB_POSES[id]); setTab(id); setError(""); }}><svg viewBox="0 0 24 24" aria-hidden="true">{TAB_ICONS[id]}</svg><span>{label}</span></button>)}</nav>

    <section className="lobby-operator" aria-label="Your operator">
      <div className="operator-intro"><span className="eyebrow">SQUAD UP. LOCK IN. STRIKE FIRST.</span><h1>Hold the <em>line</em><span className="title-dot">.</span></h1><p>Four fronts: a village, a downtown block, a freight yard and an outpost. Two squads, one scoreboard.</p></div>
      <fieldset className="operator-fields" disabled={!!busy}>
        <label>CALLSIGN<span className="callsign"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} autoComplete="nickname" /><button type="button" aria-label="Random callsign" title="Random callsign" onClick={() => setName(randomName())}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" /><circle cx="8.5" cy="8.5" r="1.4" /><circle cx="15.5" cy="8.5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="8.5" cy="15.5" r="1.4" /><circle cx="15.5" cy="15.5" r="1.4" /></svg></button></span></label>
        <div className="character-field"><span className="field-caption">CHARACTER</span><CharacterPicker value={character} onChange={setCharacter} /></div>
      </fieldset>
      <ol className="lobby-steps"><li><b>01</b>Pick a front</li><li><b>02</b>Squad up with friends or bots</li><li><b>03</b>Strike first</li></ol>
    </section>

    <div className="lobby-stage"><CharacterShowcase preview players={[{ id: "preview", name: name.trim() || "Operator", char: character, team: 0, emote }]} me="preview" onShowoff={setEmote} /></div>

    <section className="lobby-panel" role="tabpanel" id="play-panel" aria-labelledby={`tab-${tab}`}>
      <div className="panel-body" key={tab}>
        <fieldset disabled={!!busy}>
          {tab === "friends" && <>
            <div className="format-options" role="group" aria-label="Match format">{FORMATS.map(([id, label, count]) => <button key={id} type="button" className={format === id ? "selected" : ""} aria-pressed={format === id} onClick={() => setFormat(id)}><strong>{id === "custom" ? "Custom" : id}</strong><span>{label}</span><small>{count}</small></button>)}</div>
            <MapPicker value={map} onChange={setMap} />
            <div className="custom-fields">{format === "custom" && <>{modeSelect}{scoreSelect}
              <Choices wide label="ROOM SIZE" hint={`${maxPlayers} players`} value={maxPlayers}
                onChange={(max) => { setMaxPlayers(max); if (bots) setBots(max); }}
                options={ROOM_SIZES.map((n) => ({ value: n, text: mode === "tdm" ? `${n / 2}v${n / 2}` : String(n), name: `${n} players` }))} />
            </>}{format !== "custom" && scoreSelect}</div>
            <div className="room-options">
              <input aria-label="Room name (optional)" value={roomName} maxLength={32} placeholder={`Room name: ${name.trim() || "Operator"}'s room`} onChange={(e) => setRoomName(e.target.value)} />
              <div className="room-checks">
                <label className="check-label" title="Only people with your invite can join."><input type="checkbox" checked={privateRoom} onChange={(e) => setPrivateRoom(e.target.checked)} /> Private room</label>
                {format === "custom" && <label className="check-label" title="Practice bots fill the empty slots."><input type="checkbox" checked={bots > 0} onChange={(e) => setBots(e.target.checked ? maxPlayers : 0)} /> Practice bots</label>}
              </div>
            </div>
          </>}
          {tab === "quick" && <>
            <MapPicker value={map} onChange={setMap} />
            {modeSelect}
            <div className="quick-summary"><strong>Public matchmaking</strong><span>{MAPS[map].name} · Up to {MAX_PLAYERS} players · Practice bots enabled</span><span>Want a match without bots? Choose With friends.</span></div>
          </>}
          {tab === "join" && <>
            <div className="join-fields">
              <label>ROOM CODE OR INVITE LINK<input aria-label="Room code" placeholder="e.g. ABC23 or paste an invite" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && parseRoomCode(code)) void join("code"); }} /></label>
              <Choices<0 | 1 | 2> label="JOIN TEAM" value={joinTeam} onChange={setJoinTeam}
                options={[{ value: 0, text: "Auto", name: "Auto assign" }, { value: 1, text: "Blue", name: "Blue team" }, { value: 2, text: "Red", name: "Red team" }]} />
            </div>
            <section className="room-browser" aria-label="Public rooms">
              <div className="browser-heading"><h3>Open rooms <span>{visibleRooms.length}</span></h3><button type="button" className="text-button" onClick={() => setRefreshKey((v) => v + 1)}>↻ Refresh</button></div>
              <div className="browser-tools"><div className="room-filters" role="group" aria-label="Room filters">{([["all", "All rooms"], ["humans", "No bots"], ["waiting", "Waiting lobby"]] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} className={filter === id ? "selected" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><input aria-label="Search rooms" placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
              <div className="room-list">{visibleRooms.length ? visibleRooms.map((r) => <button type="button" className="room-row" key={r.code} disabled={r.locked || r.humans >= r.max} onClick={() => void join("code", r.code)}><span>{r.name}<small>{MAPS[mapId(r.map)].name} · {r.format === "custom" ? MODE_INFO[r.mode]?.name : r.format} · {r.code} · {r.bots ? `${r.bots} bots` : r.phase === "waiting" ? "Room lobby" : "In progress"}</small></span><span>{r.humans} / {r.max}<b>{r.locked ? "Unavailable" : "Join →"}</b></span></button>) : <div className="empty-rooms"><strong>{online === false ? "The server is unavailable." : online === null ? "Looking for open rooms…" : rooms.length ? "No rooms match your search." : "No open rooms yet."}</strong><p>{online === false ? "Try refreshing in a moment." : rooms.length ? "Try another filter or search." : "Create a public room and it shows up here."}</p></div>}</div>
            </section>
          </>}
        </fieldset>
      </div>
      <fieldset className="panel-action" disabled={!!busy}>
        {busy && <p role="status" className="connection-progress">{busy}</p>}
        {error && <p role="alert" className="error-text">{error}</p>}
        {tab === "friends" && <button type="button" className="primary-button" onClick={() => void join("create")}>{busy || `CREATE ${format === "custom" ? "CUSTOM" : format.toUpperCase()} ROOM`}<span>→</span></button>}
        {tab === "quick" && <button type="button" className="primary-button" onClick={() => void join("quick")}>{busy || "QUICK PLAY"}<span>→</span></button>}
        {tab === "join" && <button type="button" className="primary-button" disabled={!parseRoomCode(code)} onClick={() => void join("code")}>{busy || "JOIN ROOM →"}</button>}
      </fieldset>
    </section>
    {help && <HowToPlay onClose={() => setHelp(false)} touch={window.matchMedia("(pointer: coarse)").matches} />}
    {settings && <SettingsDialog onClose={() => setSettings(false)} />}
  </main>;
}
