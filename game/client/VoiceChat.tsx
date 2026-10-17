"use client";

import { useEffect, useRef, useState } from "react";
import { canHearVoice, type VoiceChannel } from "../shared/voice";
import type { GameRoom } from "./net/session";
import { INITIAL_VOICE, VoiceClient } from "./net/voice";
import styles from "./VoiceChat.module.css";

/** Push-to-talk keys: N reaches your team, M reaches everyone (Free for All sends both to All). */
const TALK_KEYS: Record<string, VoiceChannel> = { KeyN: "team", KeyM: "all" };

function MicIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
  </svg>;
}

export function VoiceChat({ room }: { room: GameRoom }) {
  const [state, setState] = useState(INITIAL_VOICE);
  const [open, setOpen] = useState(false);
  const client = useRef<VoiceClient | null>(null);
  /** Held talk sources in press order; the latest one picks the channel (undefined keeps the selected one). */
  const held = useRef(new Map<string, VoiceChannel | undefined>());
  const control = useRef<{ start: (source: string, channel?: VoiceChannel) => void; stop: (source: string) => void } | null>(null);
  useEffect(() => {
    let snapshot = INITIAL_VOICE;
    const voice = new VoiceClient(room, (next) => { snapshot = next; setState(next); }); client.current = voice;
    const sources = held.current;
    const resume = () => { if (sources.size) voice.talk(true, [...sources.values()].at(-1)); };
    const start = (source: string, channel?: VoiceChannel) => {
      sources.delete(source); sources.set(source, channel);
      if (snapshot.enabled) voice.talk(true, channel);
      // The first talk press enables voice; talk only if the key is still held once the microphone opens.
      else if (!snapshot.pending) void voice.join().then(resume);
    };
    const stop = (source: string) => { if (!sources.delete(source)) return; if (sources.size) resume(); else voice.talk(false); };
    control.current = { start, stop };
    const down = (e: KeyboardEvent) => {
      const channel = TALK_KEYS[e.code];
      if (!channel || e.repeat || e.altKey || e.metaKey || (e.target as HTMLElement).closest("input, select, textarea, [contenteditable=true]")) return;
      e.preventDefault(); start(e.code, channel);
    };
    const up = (e: KeyboardEvent) => { if (TALK_KEYS[e.code]) stop(e.code); };
    const release = () => { sources.clear(); voice.talk(false); };
    const visibility = () => { if (document.hidden) release(); };
    document.addEventListener("keydown", down); document.addEventListener("keyup", up);
    window.addEventListener("blur", release); document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("keydown", down); document.removeEventListener("keyup", up);
      window.removeEventListener("blur", release); document.removeEventListener("visibilitychange", visibility);
      sources.clear(); control.current = null; voice.dispose(); client.current = null;
    };
  }, [room]);
  const me = room.state.players.get(room.sessionId);
  const teams = room.state.mode === "tdm";
  const speakers = state.members.filter((m) => m.id !== room.sessionId && m.talking && !state.deafened && !state.mutedPeers.includes(m.id) && canHearVoice(m.channel, room.state.players.get(m.id)?.team ?? 0, me?.team ?? 0, room.state.mode));
  const stopPointer = () => control.current?.stop("pointer");
  return <aside className={styles.voice} aria-label="Voice chat" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
    <div className={styles.bar}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>VOICE {state.enabled ? `· ${state.channel.toUpperCase()}` : "OFF"}</button>
      {state.enabled ? <button type="button" className={state.talking ? styles.talking : ""} aria-label="Hold to talk" aria-pressed={state.talking} disabled={state.micMuted || state.deafened}
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); control.current?.start("pointer"); }}
        onPointerUp={stopPointer} onPointerCancel={stopPointer} onLostPointerCapture={stopPointer}
        onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); control.current?.start("button"); } }}
        onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") control.current?.stop("button"); }} onBlur={() => control.current?.stop("button")}>
        {state.talking ? `TALKING · ${state.channel.toUpperCase()}` : state.micMuted ? "MIC MUTED" : "HOLD TO TALK"}
      </button> : <button type="button" className={styles.enable} disabled={state.pending} onClick={() => void client.current?.join()}>
        <MicIcon />{state.pending ? "WAITING FOR MIC…" : "ENABLE VOICE"}
      </button>}
    </div>
    <p className={styles.keys}>HOLD {teams ? <><kbd>N</kbd> TEAM · <kbd>M</kbd> ALL</> : <><kbd>N</kbd> / <kbd>M</kbd> TALK</>}</p>
    {speakers.length > 0 && <p className={styles.speakers} aria-live="polite">{speakers.map((m) => `${room.state.players.get(m.id)?.name ?? "Player"} (${m.channel})`).join(", ")}</p>}
    {!open && state.error && <p className={styles.error} role="alert">{state.error}</p>}
    {open && <div className={styles.panel}>
      <strong>Voice chat</strong>
      <p>{teams ? "Hold N to talk to your team, M to talk to everyone, or hold the talk button to use the channel below." : "Hold N, M or the talk button to talk to everyone."} You always hear teammates and All voice.</p>
      <label>Speak to<select aria-label="Voice channel" value={teams ? state.channel : "all"} onChange={(e) => client.current?.channel(e.target.value as VoiceChannel)}><option value="team" disabled={!teams}>Team</option><option value="all">All players</option></select></label>
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
