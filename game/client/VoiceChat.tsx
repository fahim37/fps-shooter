"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { canHearVoice, type VoiceChannel } from "../shared/voice";
import type { GameRoom } from "./net/session";
import { INITIAL_VOICE, VoiceClient } from "./net/voice";
import styles from "./VoiceChat.module.css";

/** Push-to-talk keys: N reaches your team, M reaches everyone (Free for All sends both to All). */
const TALK_KEYS: Record<string, VoiceChannel> = { KeyN: "team", KeyM: "all" };

const svg = { "aria-hidden": true, viewBox: "0 0 20 20", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function TeamIcon() {
  return <svg {...svg}><circle cx="7" cy="7" r="2.6" /><circle cx="13.5" cy="7.5" r="2.1" /><path d="M2.5 16c.4-3 2.2-4.6 4.5-4.6S11.1 13 11.5 16M12 11.6c2.6-.4 4.6 1 5.2 4.2" /></svg>;
}
function AllIcon() {
  return <svg {...svg}><circle cx="10" cy="10" r="7.2" /><path d="M2.8 10h14.4M10 2.8c2.1 2 3 4.4 3 7.2s-.9 5.2-3 7.2c-2.1-2-3-4.4-3-7.2s.9-5.2 3-7.2Z" /></svg>;
}
function MicIcon({ open }: { open: boolean }) {
  return <svg {...svg}><rect x="7" y="2.5" width="6" height="10" rx="3" /><path d="M4.2 9.5a5.8 5.8 0 0 0 11.6 0M10 15.3v2.4" />{!open && <path d="M3.5 3.5l13 13" />}</svg>;
}
function MoreIcon() {
  return <svg {...svg}><path d="M4 6h12M4 10h12M4 14h12" /><circle cx="7" cy="6" r="1.4" fill="currentColor" /><circle cx="13" cy="10" r="1.4" fill="currentColor" /><circle cx="9" cy="14" r="1.4" fill="currentColor" /></svg>;
}

interface Control {
  start: (source: string, channel: VoiceChannel) => void;
  stop: (source: string) => void;
  setOpenMic: (open: boolean) => void;
  select: (channel: VoiceChannel) => void;
}

/** Press and hold to talk on a channel; it also becomes the open-mic channel. */
function ChannelButton({ channel, control, live, pressed, label, title, children }: {
  channel: VoiceChannel; control: RefObject<Control | null>; live: boolean; pressed: boolean; label: string; title: string; children: ReactNode;
}) {
  const source = `button-${channel}`;
  const begin = () => { control.current?.select(channel); control.current?.start(source, channel); };
  const end = () => control.current?.stop(source);
  return <button type="button" className={live ? styles.live : ""} aria-label={label} title={title} aria-pressed={pressed}
    onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); begin(); }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onBlur={end}
    onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); begin(); } }}
    onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") end(); }}>{children}</button>;
}

/**
 * Icon bar under the scores. Everyone listens from the start (All and their team); talking is
 * opt-in. Hold Team / All (or N / M) to talk on that channel; the mic button keeps the
 * microphone open on the selected channel instead. Either turns the microphone on first.
 */
export function VoiceChat({ room }: { room: GameRoom }) {
  const teams = room.state.mode === "tdm";
  const [state, setState] = useState(INITIAL_VOICE);
  const [panel, setPanel] = useState(false);
  const [openMic, setOpenMic] = useState(false);
  const [selected, setSelected] = useState<VoiceChannel>(teams ? "team" : "all");
  const client = useRef<VoiceClient | null>(null);
  const control = useRef<Control | null>(null);
  useEffect(() => {
    let snapshot = INITIAL_VOICE;
    let open = false;
    let channel: VoiceChannel = room.state.mode === "tdm" ? "team" : "all";
    const voice = new VoiceClient(room, (next) => {
      // Turning the mic off (or losing it) closes the open mic, so it never comes back on by surprise.
      if (snapshot.mic && !next.mic && open) { open = false; setOpenMic(false); }
      snapshot = next; setState(next);
    }); client.current = voice;
    voice.listen();
    /** Held talk sources in press order; the latest one picks the channel. */
    const sources = new Map<string, VoiceChannel>();
    const settle = () => {
      if (sources.size) voice.talk(true, [...sources.values()].at(-1));
      else if (open) voice.talk(true, channel);
      else voice.talk(false);
    };
    const ensureJoined = () => {
      if (snapshot.mic) settle();
      // Talk only if something still asks for it once the microphone opens.
      else if (!snapshot.pending) void voice.join().then(() => {
        if (snapshot.mic) settle();
        else if (open) { open = false; setOpenMic(false); }
      });
    };
    const start = (source: string, to: VoiceChannel) => { sources.delete(source); sources.set(source, to); ensureJoined(); };
    const stop = (source: string) => { if (sources.delete(source)) settle(); };
    control.current = {
      start, stop,
      setOpenMic: (value) => { open = value; setOpenMic(value); if (value) ensureJoined(); else settle(); },
      select: (to) => { channel = to; setSelected(to); if (snapshot.mic) settle(); },
    };
    const down = (e: KeyboardEvent) => {
      const to = TALK_KEYS[e.code];
      if (!to || e.repeat || e.altKey || e.metaKey || (e.target as HTMLElement).closest("input, select, textarea, [contenteditable=true]")) return;
      e.preventDefault(); start(e.code, to);
    };
    const up = (e: KeyboardEvent) => { if (TALK_KEYS[e.code]) stop(e.code); };
    // Losing focus drops held keys; an open mic stays open.
    const release = () => { sources.clear(); settle(); };
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
  const speakers = state.enabled ? state.members.filter((m) => m.id !== room.sessionId && m.talking && !state.deafened && !state.mutedPeers.includes(m.id)
    && (state.hearAll || m.channel !== "all") && canHearVoice(m.channel, room.state.players.get(m.id)?.team ?? 0, me?.team ?? 0, room.state.mode)) : [];
  const live = (channel: VoiceChannel) => state.talking && state.channel === channel;
  const micTitle = state.pending ? "Waiting for microphone…" : !state.mic ? "Mic is off (you still hear voice). Click to turn it on with an open mic" : openMic ? "Mic open: everyone on your channel hears you. Click for push-to-talk" : "Push-to-talk (hold N / M). Click to keep the mic open";
  return <aside className={styles.voice} aria-label="Voice chat" data-voice={state.mic ? "on" : state.pending ? "pending" : "off"} data-talking={state.talking ? state.channel : ""} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
    <div className={styles.bar}>
      {teams && <ChannelButton channel="team" control={control} live={live("team")} pressed={state.mic && selected === "team"} label="Team voice" title="Team voice: hold to talk to your team (N)"><TeamIcon /></ChannelButton>}
      <ChannelButton channel="all" control={control} live={live("all")} pressed={state.mic && selected === "all"} label="All voice" title={`All voice: hold to talk to everyone (${teams ? "M" : "N / M"})`}><AllIcon /></ChannelButton>
      <button type="button" className={`${styles.mic} ${openMic && state.mic ? styles.open : ""}`} aria-label="Open mic" title={micTitle} aria-pressed={openMic} aria-busy={state.pending} disabled={state.pending}
        onClick={() => control.current?.setOpenMic(!openMic || !state.mic)}><MicIcon open={openMic && state.mic} /></button>
      <button type="button" className={styles.more} aria-label="Voice settings" title="Voice settings" aria-expanded={panel} onClick={() => setPanel(!panel)}><MoreIcon /></button>
    </div>
    {speakers.length > 0 && <p className={styles.speakers} aria-live="polite">{speakers.map((m) => `${room.state.players.get(m.id)?.name ?? "Player"} (${m.channel})`).join(", ")}</p>}
    {!panel && state.error && <p className={styles.error} role="alert">{state.error}</p>}
    {panel && <div className={styles.panel}>
      <strong>Voice chat</strong>
      <p>Everyone hears All voice{teams ? " and their own team" : ""} from the start; switch All off below if you only want your team. {teams ? "Hold the team button or N to talk to your team, the globe or M to talk to everyone." : "Hold the globe, N or M to talk to everyone."} The mic button keeps your microphone open on the selected channel.</p>
      {!state.enabled ? <button type="button" onClick={() => client.current?.listen()}>LISTEN TO VOICE</button> : <>
        <p role="status">{state.mic ? `${state.connected} connected · ${state.talking ? `Talking to ${state.channel === "team" ? "your team" : "everyone"}` : openMic ? "Mic open" : "Push-to-talk"}` : `Listening · mic off · ${state.connected} connected`}</p>
        <div className={styles.actions}>
          <button type="button" aria-pressed={state.hearAll} onClick={() => client.current?.hearAll(!state.hearAll)}>{state.hearAll ? "All voice: on" : "All voice: off"}</button>
          <button type="button" aria-pressed={state.deafened} onClick={() => client.current?.deafen()}>{state.deafened ? "Enable sound" : "Mute sound"}</button>
        </div>
        <label>Voice volume<input aria-label="Voice volume" type="range" min="0" max="1" step="0.05" value={state.volume} onChange={(e) => client.current?.volume(Number(e.target.value))} /></label>
        {state.members.filter((m) => m.id !== room.sessionId && m.mic).map((m) => <div className={styles.member} key={m.id}><span>{room.state.players.get(m.id)?.name ?? "Player"}</span><button type="button" aria-label={`Mute ${room.state.players.get(m.id)?.name ?? "Player"}`} aria-pressed={state.mutedPeers.includes(m.id)} onClick={() => client.current?.mutePeer(m.id)}>{state.mutedPeers.includes(m.id) ? "Unmute" : "Mute"}</button></div>)}
        {state.mic ? <button type="button" onClick={() => client.current?.micOff()}>TURN MIC OFF</button>
          : <button type="button" disabled={state.pending} onClick={() => void client.current?.join()}>{state.pending ? "Waiting for microphone…" : "TURN MIC ON"}</button>}
        <button type="button" onClick={() => client.current?.leave()}>LEAVE VOICE</button>
      </>}
      {state.soundBlocked && <button type="button" onClick={() => void client.current?.resumeSound()}>ENABLE VOICE AUDIO</button>}
      {state.error && <p role="alert">{state.error}</p>}
    </div>}
  </aside>;
}
