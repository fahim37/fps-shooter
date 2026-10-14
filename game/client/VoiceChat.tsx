"use client";

import { useEffect, useRef, useState } from "react";
import { canHearVoice, type VoiceChannel } from "../shared/voice";
import type { GameRoom } from "./net/session";
import { INITIAL_VOICE, VoiceClient } from "./net/voice";
import styles from "./VoiceChat.module.css";

export function VoiceChat({ room }: { room: GameRoom }) {
  const [state, setState] = useState(INITIAL_VOICE);
  const [open, setOpen] = useState(false);
  const client = useRef<VoiceClient | null>(null);
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const voice = new VoiceClient(room, setState); client.current = voice;
    const held = keys.current;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "KeyN" || e.repeat || (e.target as HTMLElement).closest("input, select, textarea, [contenteditable=true]")) return;
      e.preventDefault(); held.add("keyboard"); voice.talk(true);
    };
    const up = (e: KeyboardEvent) => { if (e.code === "KeyN") { held.delete("keyboard"); if (!held.size) voice.talk(false); } };
    const release = () => { held.clear(); voice.talk(false); };
    const visibility = () => { if (document.hidden) release(); };
    document.addEventListener("keydown", down); document.addEventListener("keyup", up);
    window.addEventListener("blur", release); document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("keydown", down); document.removeEventListener("keyup", up);
      window.removeEventListener("blur", release); document.removeEventListener("visibilitychange", visibility);
      held.clear(); voice.dispose(); client.current = null;
    };
  }, [room]);
  const me = room.state.players.get(room.sessionId);
  const speakers = state.members.filter((m) => m.id !== room.sessionId && m.talking && !state.deafened && !state.mutedPeers.includes(m.id) && canHearVoice(m.channel, room.state.players.get(m.id)?.team ?? 0, me?.team ?? 0, room.state.mode));
  const stopPointer = () => { keys.current.delete("pointer"); if (!keys.current.size) client.current?.talk(false); };
  return <aside className={styles.voice} aria-label="Voice chat" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
    <div className={styles.bar}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>VOICE {state.enabled ? `· ${state.channel.toUpperCase()}` : "OFF"}</button>
      {state.enabled && <button type="button" className={state.talking ? styles.talking : ""} aria-label="Hold to talk" aria-pressed={state.talking} disabled={state.micMuted || state.deafened}
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); keys.current.add("pointer"); client.current?.talk(true); }}
        onPointerUp={stopPointer} onPointerCancel={stopPointer} onLostPointerCapture={stopPointer}
        onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); client.current?.talk(true); } }}
        onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") client.current?.talk(false); }} onBlur={() => client.current?.talk(false)}>
        {state.talking ? "TALKING" : "HOLD N / TALK"}
      </button>}
    </div>
    {speakers.length > 0 && <p className={styles.speakers} aria-live="polite">{speakers.map((m) => `${room.state.players.get(m.id)?.name ?? "Player"} (${m.channel})`).join(", ")}</p>}
    {open && <div className={styles.panel}>
      <strong>Voice chat</strong>
      <p>Hold N or the talk button to speak. Team reaches teammates; All reaches everyone in voice.</p>
      <label>Speak to<select aria-label="Voice channel" value={room.state.mode === "tdm" ? state.channel : "all"} onChange={(e) => client.current?.channel(e.target.value as VoiceChannel)}><option value="team" disabled={room.state.mode !== "tdm"}>Team</option><option value="all">All players</option></select></label>
      {!state.enabled ? <button type="button" disabled={state.pending} onClick={() => void client.current?.join()}>{state.pending ? "Waiting for microphone…" : "JOIN VOICE"}</button> : <>
        <p role="status">{state.connected} connected · Microphone {state.talking ? "live" : "muted until you talk"}</p>
        <div className={styles.actions}><button type="button" aria-pressed={state.micMuted} onClick={() => client.current?.muteMic()}>{state.micMuted ? "Unmute mic" : "Mute mic"}</button><button type="button" aria-pressed={state.deafened} onClick={() => client.current?.deafen()}>{state.deafened ? "Enable sound" : "Mute sound"}</button></div>
        <label>Voice volume<input aria-label="Voice volume" type="range" min="0" max="1" step="0.05" value={state.volume} onChange={(e) => client.current?.volume(Number(e.target.value))} /></label>
        {state.members.filter((m) => m.id !== room.sessionId).map((m) => <div className={styles.member} key={m.id}><span>{room.state.players.get(m.id)?.name ?? "Player"}</span><button type="button" aria-label={`Mute ${room.state.players.get(m.id)?.name ?? "Player"}`} aria-pressed={state.mutedPeers.includes(m.id)} onClick={() => client.current?.mutePeer(m.id)}>{state.mutedPeers.includes(m.id) ? "Unmute" : "Mute"}</button></div>)}
        <button type="button" onClick={() => client.current?.leave()}>LEAVE VOICE</button>
      </>}
      {state.soundBlocked && <button type="button" onClick={() => void client.current?.resumeSound()}>ENABLE VOICE AUDIO</button>}
      {state.error && <p role="alert">{state.error}</p>}
    </div>}
  </aside>;
}
