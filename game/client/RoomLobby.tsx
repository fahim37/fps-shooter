"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { GameRoom } from "./net/session";
import { MODE_INFO, matchMinutes, type GameMode } from "../shared/constants";
import { startBlockReason } from "../shared/lobby";
import { RoomInvite } from "./RoomInvite";
import { LobbyTools, SettingsDialog } from "./SettingsDialog";
import { HowToPlay } from "./HowToPlay";
import { CharacterShowcase } from "./CharacterShowcase";
import { MapPicker } from "./MapPicker";
import { MAPS, mapId } from "../shared/map/maps";
import type { MapId } from "../shared/map/types";

import { audio } from "./core/audio";
import { LobbySounds } from "./lobbyAudio";
import { VoiceChat, useVoiceSession } from "./VoiceChat";
const GameView = dynamic(() => import("./GameView"), { ssr: false, loading: () => <main className="boot-screen">Loading the match…</main> });

function snapshot(room: GameRoom) {
  const s = room.state;
  return JSON.stringify({
    phase: s?.code ? s.phase : "", lobby: s?.lobby ?? false, name: s?.roomName ?? "", mode: s?.mode ?? "tdm", map: mapId(s?.map),
    host: s?.hostId ?? "", format: s?.format ?? "custom", maxPlayers: s?.maxPlayers ?? 12,
    botFill: s?.botFill ?? 0, scoreLimit: s?.scoreLimit ?? 0, privateRoom: s?.privateRoom ?? false,
    players: s?.players ? [...s.players.entries()].map(([id, p]) => ({ id, name: p.name, char: p.char, emote: p.emote, team: p.team, ready: p.ready, connected: p.connected, bot: p.bot })) : [],
  });
}
interface RoomSnapshot {
  phase: string; lobby: boolean; name: string; mode: GameMode; map: MapId; host: string; format: string;
  maxPlayers: number; botFill: number; scoreLimit: number; privateRoom: boolean;
  players: { id: string; name: string; char: number; emote: string; team: number; ready: boolean; connected: boolean; bot: boolean }[];
}
type Player = RoomSnapshot["players"][number];
interface Side { key: string; team: number; title: string; players: Player[]; capacity: number }

/** Team Deathmatch puts Blue left and Red right; Free for All splits the slots across both sides. */
function rosterSides(s: RoomSnapshot): Side[] {
  const humans = s.players.filter((p) => !p.bot);
  const half = Math.ceil(s.maxPlayers / 2);
  if (s.mode === "tdm") return [1, 2].map((team) => ({ key: `team-${team}`, team, title: team === 1 ? "Blue team" : "Red team", players: humans.filter((p) => p.team === team), capacity: half }));
  return [[0, half], [half, s.maxPlayers]].map(([start, end]) => ({ key: `ffa-${start}`, team: 0, title: end - start === 1 ? `Player ${end}` : `Players ${start + 1}–${end}`, players: humans.slice(start, end), capacity: end - start }));
}

export function ConnectedRoom({ room, onLeave }: { room: GameRoom; onLeave: () => void }) {
  const value = useSyncExternalStore((notify) => { room.onStateChange(notify); return () => room.onStateChange.remove(notify); }, () => snapshot(room));
  const s = JSON.parse(value) as RoomSnapshot;
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("connected");
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    const drop = () => setConnection("reconnecting");
    const reconnect = () => { setConnection("connected"); setError(""); };
    const leave = () => setConnection("closed");
    const fail = (_code: number, message?: string) => { setConnection("closed"); setError(message ?? "The connection closed. Please join again."); };
    room.onDrop(drop); room.onReconnect(reconnect); room.onLeave(leave); room.onError(fail);
    const unsubscribe = room.onMessage<string>("lobbyError", setError);
    // Spawn/ammo events in staging are recovered from state when the game mounts.
    const ignore = room.onMessage("*", () => {});
    return () => { room.onDrop.remove(drop); room.onReconnect.remove(reconnect); room.onLeave.remove(leave); room.onError.remove(fail); unsubscribe(); ignore(); };
  }, [room]);
  // Voice starts as soon as you're in the room and carries on into the match.
  const voice = useVoiceSession(room, !!s.phase);
  // A soft confirm when you ready up, and a deploy hit when the match starts (or you join one).
  const meReady = !!s.players.find((p) => p.id === room.sessionId)?.ready;
  const started = !!s.phase && s.phase !== "waiting";
  useEffect(() => { if (meReady && !started) audio.uiSting(); }, [meReady, started]);
  useEffect(() => { if (started) audio.uiDeploy(); }, [started]);
  if (s.phase && s.phase !== "waiting") return <GameView room={room} map={s.map} onLeave={onLeave} voice={voice} />;
  const me = s.players.find((p) => p.id === room.sessionId);
  const isHost = s.host === room.sessionId;
  const reason = startBlockReason(s, s.players);
  const disabled = connection !== "connected" || !me;
  function send(type: string, data: unknown) { setError(""); room.send(type, data); }
  const humans = s.players.filter((p) => !p.bot);
  return <main className="waiting-room" data-mode={s.mode}>
    <LobbySounds />
    <div className="lobby-grain" aria-hidden="true" />
    <header className="lobby-top room-top">
      <button type="button" className="text-button leave-button" onClick={onLeave}>← Leave room</button>
      <section className="room-heading"><span className="eyebrow">{s.privateRoom ? "INVITE ONLY" : "PUBLIC ROOM"} · {humans.length} / {s.maxPlayers} PLAYERS</span><h1>{s.name || "Joining room…"}</h1><p>{s.format === "custom" ? MODE_INFO[s.mode].name : `${s.format} · Team Deathmatch`} <span>·</span> {MAPS[s.map].name} <span>·</span> {s.scoreLimit > 0 && <>First to {s.scoreLimit} · {matchMinutes(s.mode, s.scoreLimit)} min <span>·</span> </>}{s.botFill ? `Bots fill to ${s.botFill}` : "No bots"}</p></section>
      <div className="top-tools">{s.phase && <VoiceChat room={room} session={voice} placement="room" />}<LobbyTools onHelp={() => setHelp(true)} onSettings={() => setSettings(true)} /></div>
    </header>

    {rosterSides(s).map((side, i) => {
      const canJoin = !!side.team && !disabled && me?.team !== side.team && side.players.length < side.capacity;
      const joinTeam = () => send("team", side.team);
      return <section key={side.key} className={`room-roster ${i === 0 ? "roster-left" : "roster-right"} ${side.team === 1 ? "team-blue" : side.team === 2 ? "team-red" : "team-solo"}`} aria-label={side.title}>
      <div className="team-heading"><h2>{side.title}<span>{side.players.length}/{side.capacity}</span></h2>{!!side.team && <button type="button" className="text-button" disabled={!canJoin} onClick={joinTeam}>{me?.team === side.team ? "Your team" : "Join team"}</button>}</div>
      <div className="slot-list">{Array.from({ length: side.capacity }, (_, slot) => {
        const p = side.players[slot];
        if (!p && side.team) return <button key={`empty-${slot}`} type="button" className="player-slot open-slot" disabled={!canJoin} onClick={joinTeam} aria-label={`Join ${side.title}, open slot ${slot + 1}`}>
          <span className="player-avatar" aria-hidden="true">+</span>
          <span className="player-details"><strong>Open slot</strong><small>{me?.team === side.team ? "Invite a friend" : "Click to join team"}</small></span>
        </button>;
        return <div key={p?.id ?? `empty-${slot}`} className={`player-slot ${p ? "occupied" : ""} ${p?.id === room.sessionId ? "is-me" : ""}`}>
          <span className="player-avatar" aria-hidden="true">{p ? p.name.slice(0, 1).toUpperCase() : "+"}</span>
          <div><strong>{p ? `${p.name}${p.id === room.sessionId ? " (you)" : ""}` : "Open slot"}</strong><small>{p ? `${p.id === s.host ? "Host · " : ""}${p.char === 1 ? "Female" : "Male"} Operator` : "Invite a friend"}</small></div>
          {p && <span className={`ready-badge ${p.ready && p.connected ? "is-ready" : ""}`}>{!p.connected ? "Reconnecting" : p.ready ? "Ready" : "Not ready"}</span>}
        </div>;
      })}</div>
    </section>;
    })}

    <div className="room-stage"><CharacterShowcase players={humans} me={room.sessionId} onShowoff={(id) => send("emote", id)} disabled={disabled} title={s.name} /></div>

    <footer className="room-bar">
      <RoomInvite code={room.roomId} />
      <div className="room-map" aria-live="polite">
        <span className="eyebrow">{isHost ? "PICK THE MAP" : "MAP · HOST PICKS"}</span>
        <MapPicker compact value={s.map} onChange={isHost && !disabled ? (id) => send("map", id) : undefined} />
      </div>
      <div className="room-start" aria-live="polite">
        <p className="start-status"><b>{isHost ? "YOU ARE THE HOST" : me?.ready ? "YOU’RE READY" : "GET READY"}</b>{connection === "closed" ? "Connection closed. Leave and join again." : connection === "reconnecting" ? "Reconnecting to your room…" : reason || (isHost ? "Everyone is ready. Start the match!" : "Everyone is ready. Waiting for the host.")}</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="button" className={me?.ready ? "outline-button" : "primary-button"} disabled={disabled} onClick={() => send("ready", !me?.ready)}>{me?.ready ? "CANCEL READY" : "READY UP"}</button>
        {isHost && <button type="button" className="primary-button" disabled={disabled || !!reason} onClick={() => send("start", {})}>START MATCH <span>→</span></button>}
      </div>
    </footer>
    {help && <HowToPlay onClose={() => setHelp(false)} touch={window.matchMedia("(pointer: coarse)").matches} />}
    {settings && <SettingsDialog onClose={() => setSettings(false)} />}
  </main>;
}
