"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { canHearVoice, type VoiceChannel } from "../shared/voice";
import type { GameRoom } from "./net/session";
import { INITIAL_VOICE, VoiceClient, type VoiceSnapshot } from "./net/voice";
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

interface VoiceView { state: VoiceSnapshot; openMic: boolean; selected: VoiceChannel }

/**
 * Voice for one room, from the moment you join it: started in the waiting room and kept through
 * the match, so moving from one to the other never drops a conversation. Everyone listens from
 * the start (All and their team); talking is opt-in. Holding a talk source (a channel button, or
 * N / M) transmits on that channel; the open mic keeps transmitting on the selected one.
 */
export class VoiceSession {
  private voice: VoiceClient | null = null;
  private view: VoiceView;
  private listeners = new Set<() => void>();
  /** Held talk sources in press order; the latest one picks the channel. */
  private sources = new Map<string, VoiceChannel>();
  private cleanup: (() => void) | null = null;

  constructor(private room: GameRoom) {
    this.view = { state: INITIAL_VOICE, openMic: false, selected: "all" };
  }

  /** The voice connection while open. */
  get client() { return this.voice; }

  /** Joins voice (listening) and starts the push-to-talk keys; `close` undoes it, and it can open again. */
  open() {
    if (this.voice) return;
    // The room's state has arrived by now (see useVoiceSession), so its mode is known.
    this.set({ selected: this.room.state.mode === "tdm" ? "team" : "all" });
    this.voice = new VoiceClient(this.room, (next) => {
      // Turning the mic off (or losing it) closes the open mic, so it never comes back on by surprise.
      const openMic = this.view.state.mic && !next.mic ? false : this.view.openMic;
      this.set({ state: next, openMic });
    });
    this.voice.listen();
    const down = (e: KeyboardEvent) => {
      const to = TALK_KEYS[e.code];
      if (!to || e.repeat || e.altKey || e.metaKey || (e.target as HTMLElement).closest?.("input, select, textarea, [contenteditable=true]")) return;
      e.preventDefault(); this.start(e.code, to);
    };
    const up = (e: KeyboardEvent) => { if (TALK_KEYS[e.code]) this.stop(e.code); };
    // Losing focus drops held keys; an open mic stays open.
    const release = () => { this.sources.clear(); this.settle(); };
    const visibility = () => { if (document.hidden) release(); };
    document.addEventListener("keydown", down); document.addEventListener("keyup", up);
    window.addEventListener("blur", release); document.addEventListener("visibilitychange", visibility);
    this.cleanup = () => {
      document.removeEventListener("keydown", down); document.removeEventListener("keyup", up);
      window.removeEventListener("blur", release); document.removeEventListener("visibilitychange", visibility);
    };
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.view;

  start(source: string, to: VoiceChannel) { this.sources.delete(source); this.sources.set(source, to); this.ensureJoined(); }
  stop(source: string) { if (this.sources.delete(source)) this.settle(); }
  setOpenMic(open: boolean) { this.set({ openMic: open }); if (open) this.ensureJoined(); else this.settle(); }
  select(channel: VoiceChannel) { this.set({ selected: channel }); if (this.view.state.mic) this.settle(); }

  close() {
    this.sources.clear();
    this.cleanup?.(); this.cleanup = null;
    this.voice?.dispose(); this.voice = null;
    this.set({ state: INITIAL_VOICE, openMic: false });
  }

  private set(update: Partial<VoiceView>) { this.view = { ...this.view, ...update }; this.listeners.forEach((listener) => listener()); }
  private settle() {
    if (this.sources.size) this.voice?.talk(true, [...this.sources.values()].at(-1));
    else if (this.view.openMic) this.voice?.talk(true, this.view.selected);
    else this.voice?.talk(false);
  }
  private ensureJoined() {
    if (!this.voice) return;
    if (this.view.state.mic) this.settle();
    // Talk only if something still asks for it once the microphone opens.
    else if (!this.view.state.pending) void this.voice.join().then(() => {
      if (this.view.state.mic) this.settle();
      else if (this.view.openMic) this.set({ openMic: false });
    });
  }
}

/**
 * One voice session for as long as you are in the room (waiting room and match alike). It opens
 * once the room's first state has arrived (`ready`): until then there are no players to talk to.
 */
export function useVoiceSession(room: GameRoom, ready: boolean) {
  const session = useMemo(() => new VoiceSession(room), [room]);
  useEffect(() => {
    if (!ready) return;
    session.open();
    return () => session.close();
  }, [session, ready]);
  return session;
}

/** Press and hold to talk on a channel; it also becomes the open-mic channel. */
function ChannelButton({ channel, session, live, pressed, label, title, children }: {
  channel: VoiceChannel; session: VoiceSession; live: boolean; pressed: boolean; label: string; title: string; children: ReactNode;
}) {
  const source = `button-${channel}`;
  const begin = () => { session.select(channel); session.start(source, channel); };
  const end = () => session.stop(source);
  return <button type="button" className={live ? styles.live : ""} aria-label={label} title={title} aria-pressed={pressed}
    onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); begin(); }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onBlur={end}
    onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); begin(); } }}
    onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") end(); }}>{children}</button>;
}

/**
 * Voice bar: under the scores in a match, in the header of the waiting room. Each button says
 * what it is: hold TEAM / ALL (or N / M) to talk on that channel, and MIC keeps the microphone
 * open on the selected channel instead. The gear opens a short settings panel.
 */
export function VoiceChat({ room, session, placement = "match" }: { room: GameRoom; session: VoiceSession; placement?: "match" | "room" }) {
  const teams = room.state?.mode === "tdm";
  const { state, openMic, selected } = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const [panel, setPanel] = useState(false);
  const client = session.client;
  if (!client) return null;

  // Rendered only once the voice session is open, which waits for the room's state; `players`
  // can still be briefly missing while a reconnect resyncs it.
  const players = room.state?.players;
  const me = players?.get(room.sessionId);
  const nameOf = (id: string) => players?.get(id)?.name ?? "Player";
  const speakers = state.enabled ? state.members.filter((m) => m.id !== room.sessionId && m.talking && !state.deafened && !state.mutedPeers.includes(m.id)
    && (state.hearAll || m.channel !== "all") && canHearVoice(m.channel, players?.get(m.id)?.team ?? 0, me?.team ?? 0, room.state.mode)) : [];
  const live = (channel: VoiceChannel) => state.talking && state.channel === channel;
  const open = openMic && state.mic;
  const to = (channel: VoiceChannel) => channel === "team" ? "your team" : "everyone";
  const status = !state.enabled ? "You left voice: you can't hear anyone."
    : state.pending ? "Allow the microphone in your browser…"
    : state.talking ? `Talking to ${to(state.channel)}`
    : open ? `Mic on: ${to(selected)} can hear you`
    : `Mic off: you can hear others${state.connected ? ` (${state.connected} in voice)` : ""}`;
  const others = state.members.filter((m) => m.id !== room.sessionId && m.mic);
  return <aside className={`${styles.voice} ${placement === "room" ? styles.room : ""}`} aria-label="Voice chat" data-voice={state.mic ? "on" : state.pending ? "pending" : "off"} data-talking={state.talking ? state.channel : ""} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
    <div className={styles.bar}>
      {teams && <ChannelButton channel="team" session={session} live={live("team")} pressed={open && selected === "team"} label="Team voice" title="Hold to talk to your team (or hold N)"><TeamIcon /><span>TEAM</span></ChannelButton>}
      <ChannelButton channel="all" session={session} live={live("all")} pressed={open && selected === "all"} label="All voice" title={`Hold to talk to everyone (or hold ${teams ? "M" : "N"})`}><AllIcon /><span>ALL</span></ChannelButton>
      <button type="button" className={`${styles.mic} ${open ? styles.open : ""}`} aria-label="Open mic" title={open ? "Mic on: click to turn it off" : "Click to keep your mic on (no key needed)"} aria-pressed={open} aria-busy={state.pending} disabled={state.pending}
        onClick={() => session.setOpenMic(!open)}><MicIcon open={open} /><span>{state.pending ? "…" : open ? "MIC ON" : "MIC OFF"}</span></button>
      <button type="button" className={styles.more} aria-label="Voice settings" title="Voice settings" aria-expanded={panel} onClick={() => setPanel(!panel)}><MoreIcon /></button>
    </div>
    {!panel && speakers.length > 0 && <p className={styles.speakers} aria-live="polite">{speakers.map((m) => <span key={m.id}>{nameOf(m.id)} ({m.channel === "team" ? "team" : "all"})</span>)}</p>}
    {!panel && state.error && <p className={styles.error} role="alert">{state.error}</p>}
    {panel && <div className={styles.panel} role="dialog" aria-label="Voice settings">
      <div className={styles.head}><strong>Voice chat</strong><button type="button" className={styles.close} aria-label="Close voice settings" onClick={() => setPanel(false)}>✕</button></div>
      <p className={styles.status} role="status" data-on={state.talking || open}>{status}</p>
      {!state.enabled ? <button type="button" className={styles.primary} onClick={() => client.listen()}>JOIN VOICE</button> : <>
        <div className={styles.keys}>
          {teams && <span><kbd>N</kbd> hold to talk to your team</span>}
          <span><kbd>{teams ? "M" : "N"}</kbd> hold to talk to everyone</span>
        </div>
        <Toggle label="Mic always on" hint="Talk without holding a key" on={open} disabled={state.pending} onChange={(on) => session.setOpenMic(on)} />
        {teams && open && <div className={styles.segment} role="radiogroup" aria-label="Mic talks to">
          {(["team", "all"] as const).map((c) => <button key={c} type="button" role="radio" aria-checked={selected === c} onClick={() => session.select(c)}>{c === "team" ? "My team" : "Everyone"}</button>)}
        </div>}
        {teams && <Toggle label="Hear everyone" hint={state.hearAll ? "Your team and the other team" : "Only your team"} on={state.hearAll} onChange={(on) => client.hearAll(on)} />}
        <Toggle label="Voice sound" hint={state.deafened ? "Muted: you hear no one" : "On"} on={!state.deafened} onChange={() => client.deafen()} />
        <label className={styles.volume}><span>Volume</span><input aria-label="Voice volume" type="range" min="0" max="1" step="0.05" value={state.volume} onChange={(e) => client.volume(Number(e.target.value))} /></label>
        {others.length > 0 && <div className={styles.members}>
          <span className={styles.label}>PLAYERS IN VOICE</span>
          {others.map((m) => <div className={styles.member} key={m.id}><span>{nameOf(m.id)}</span><button type="button" aria-label={`Mute ${nameOf(m.id)}`} aria-pressed={state.mutedPeers.includes(m.id)} onClick={() => client.mutePeer(m.id)}>{state.mutedPeers.includes(m.id) ? "Unmute" : "Mute"}</button></div>)}
        </div>}
        <button type="button" className={styles.leave} onClick={() => client.leave()}>Leave voice</button>
      </>}
      {state.soundBlocked && <button type="button" className={styles.primary} onClick={() => void client.resumeSound()}>ENABLE VOICE AUDIO</button>}
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
    </div>}
  </aside>;
}

/** An on / off row: the label and what the current setting means, with a switch. */
function Toggle({ label, hint, on, disabled, onChange }: { label: string; hint: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} className={styles.toggle} disabled={disabled} onClick={() => onChange(!on)}>
    <span><b>{label}</b><small>{hint}</small></span><i aria-hidden="true" />
  </button>;
}
