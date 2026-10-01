"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { GameRoom } from "./net/session";
import { MODE_INFO, type GameMode } from "../shared/constants";
import { startBlockReason } from "../shared/lobby";
import { RoomInvite } from "./RoomInvite";
import { SettingsPanel } from "./SettingsPanel";

const GameView = dynamic(() => import("./GameView"), { ssr: false, loading: () => <main className="boot-screen">Loading the village…</main> });

function snapshot(room: GameRoom) {
  const s = room.state;
  return JSON.stringify({
    phase: s?.code ? s.phase : "", lobby: s?.lobby ?? false, name: s?.roomName ?? "", mode: s?.mode ?? "tdm",
    host: s?.hostId ?? "", format: s?.format ?? "custom", maxPlayers: s?.maxPlayers ?? 12,
    botFill: s?.botFill ?? 0, privateRoom: s?.privateRoom ?? false,
    players: s?.players ? [...s.players.entries()].map(([id, p]) => ({ id, name: p.name, team: p.team, ready: p.ready, connected: p.connected, bot: p.bot })) : [],
  });
}
interface RoomSnapshot {
  phase: string; lobby: boolean; name: string; mode: GameMode; host: string; format: string;
  maxPlayers: number; botFill: number; privateRoom: boolean;
  players: { id: string; name: string; team: number; ready: boolean; connected: boolean; bot: boolean }[];
}

export function ConnectedRoom({ room, onLeave }: { room: GameRoom; onLeave: () => void }) {
  const value = useSyncExternalStore((notify) => { room.onStateChange(notify); return () => room.onStateChange.remove(notify); }, () => snapshot(room));
  const s = JSON.parse(value) as RoomSnapshot;
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("connected");
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
  if (s.phase && s.phase !== "waiting") return <GameView room={room} onLeave={onLeave} />;
  const me = s.players.find((p) => p.id === room.sessionId);
  const isHost = s.host === room.sessionId;
  const reason = startBlockReason(s, s.players);
  const disabled = connection !== "connected" || !me;
  function send(type: string, data: unknown) { setError(""); room.send(type, data); }
  const teams = s.mode === "tdm" ? [1, 2] : [0];
  return <main className="waiting-room">
    <header className="lobby-top"><span className="wordmark">H / M</span><button className="text-button" onClick={onLeave}>← Leave room</button></header>
    <section className="room-heading"><span className="eyebrow">YOUR ROOM · {s.privateRoom ? "INVITE ONLY" : "PUBLIC"}</span><h1>{s.name || "Joining room…"}</h1><p>{s.format === "custom" ? MODE_INFO[s.mode].name : `${s.format} · Team Deathmatch`} <span>·</span> The Village <span>·</span> {s.botFill ? `Practice bots fill to ${s.botFill}` : "Players only · No bots"}</p></section>
    <section className="roster-panel" aria-label="Room players">
      <div className="panel-heading"><span>TEAM LINEUP</span><span>{s.players.filter((p) => !p.bot).length} / {s.maxPlayers} PLAYERS</span></div>
      <div className={`team-grid ${s.mode === "ffa" ? "solo-grid" : ""}`}>
        {teams.map((team) => {
          const players = s.players.filter((p) => !p.bot && p.team === team);
          const capacity = team ? Math.ceil(s.maxPlayers / 2) : s.maxPlayers;
          return <div key={team} className={`team-column ${team === 1 ? "team-blue" : team === 2 ? "team-red" : ""}`}>
            <div className="team-heading"><h2>{team === 1 ? "Blue team" : team === 2 ? "Red team" : "Players"}</h2>{!!team && <button className="text-button" disabled={disabled || me?.team === team || players.length >= capacity} onClick={() => send("team", team)}>{me?.team === team ? "Your team" : "Join team"}</button>}</div>
            {Array.from({ length: capacity }, (_, i) => {
              const p = players[i];
              return <div key={p?.id ?? `empty-${i}`} className={`player-slot ${p ? "occupied" : ""}`}>
                <span className="player-avatar" aria-hidden="true">{p ? p.name.slice(0, 1).toUpperCase() : "+"}</span>
                <div><strong>{p ? `${p.name}${p.id === room.sessionId ? " (you)" : ""}` : "Open slot"}</strong><small>{p ? p.id === s.host ? "Room host" : "Player" : "Invite a friend to join"}</small></div>
                {p && <span className={`ready-badge ${p.ready && p.connected ? "is-ready" : ""}`}>{!p.connected ? "Reconnecting" : p.ready ? "Ready" : "Not ready"}</span>}
              </div>;
            })}
          </div>;
        })}
      </div>
      <p className="controls-help">Choose your team, then ready up. Team or player changes reset everyone’s ready status.</p>
    </section>
    <aside className="room-sidebar">
      <RoomInvite code={room.roomId} />
      <div className="room-start" aria-live="polite">
        <span className="eyebrow">{isHost ? "YOU ARE THE HOST" : "GET READY"}</span>
        <h2>{me?.ready ? "You’re ready." : "Ready when you are."}</h2>
        <p>{connection === "closed" ? "Connection closed. Return to the lobby to join again." : connection === "reconnecting" ? "Reconnecting to your room…" : reason || (isHost ? "Everyone is ready. Start the match!" : "Everyone is ready. Waiting for the host to start.")}</p>
        <button className={me?.ready ? "outline-button" : "primary-button"} disabled={disabled} onClick={() => send("ready", !me?.ready)}>{me?.ready ? "CANCEL READY" : "READY UP"}</button>
        {isHost && <button className="primary-button" disabled={disabled || !!reason} onClick={() => send("start", {})}>START MATCH <span>→</span></button>}
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
      <details className="settings-details"><summary>SETTINGS & CONTROLS</summary><SettingsPanel /></details>
    </aside>
    <footer className="lobby-footer"><span>01 INVITE FRIENDS → 02 READY UP → 03 HOST STARTS</span><span>HOLLOWMERE / FIELD OPERATIONS</span></footer>
  </main>;
}
