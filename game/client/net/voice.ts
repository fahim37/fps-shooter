import { canHearVoice, type VoiceChannel, type VoiceMember, type VoiceSignal } from "../../shared/voice";
import type { GameRoom } from "./session";

export interface VoiceSnapshot {
  /** In voice: hearing others (everyone joins to listen). `mic`: also transmitting when talking. */
  enabled: boolean; mic: boolean; pending: boolean; talking: boolean; channel: VoiceChannel;
  micMuted: boolean; deafened: boolean; volume: number; error: string; soundBlocked: boolean;
  /** Hear the All channel; switching it off leaves only your team's voice. */
  hearAll: boolean;
  members: VoiceMember[]; connected: number; mutedPeers: string[];
}
export const INITIAL_VOICE: VoiceSnapshot = {
  enabled: false, mic: false, pending: false, talking: false, channel: "team", micMuted: false,
  deafened: false, volume: 0.8, error: "", soundBlocked: false, hearAll: true, members: [], connected: 0, mutedPeers: [],
};
interface Peer {
  /** What this connection sends: a copy of the microphone, or nothing while the mic is off. */
  pc: RTCPeerConnection; sender: RTCRtpSender; track: MediaStreamTrack | null; audio: HTMLAudioElement;
  makingOffer: boolean; ignoreOffer: boolean; settingAnswer: boolean;
  candidates: RTCIceCandidateInit[]; queue: Promise<void>;
}

/** Speech needs little: a mono stream capped at this bitrate keeps encoding cheap on slow PCs. */
const MIC_BITRATE = 32_000;
/** Connections opened per step, and the pause between steps, so joining a full room doesn't stall a frame. */
const PEERS_PER_STEP = 2;
const PEER_STEP_MS = 80;

/** Listening preferences kept between matches. */
const PREFS_KEY = "voice-prefs";
function loadPrefs(): Partial<Pick<VoiceSnapshot, "hearAll" | "volume">> {
  try {
    const prefs: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    if (!prefs || typeof prefs !== "object") return {};
    const { hearAll, volume } = prefs as Record<string, unknown>;
    return {
      ...(typeof hearAll === "boolean" ? { hearAll } : {}),
      ...(typeof volume === "number" && volume >= 0 && volume <= 1 ? { volume } : {}),
    };
  } catch { return {}; }
}

function iceServers(): RTCIceServer[] {
  // TURN credentials here are visible to browsers; use short-lived credentials in production.
  const configured = process.env.NEXT_PUBLIC_VOICE_ICE_SERVERS;
  if (configured) {
    const servers: unknown = JSON.parse(configured);
    if (!Array.isArray(servers)) throw new Error("Voice ICE servers must be a JSON array.");
    return servers as RTCIceServer[];
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

/**
 * Audio goes directly to peers; Colyseus only carries membership and WebRTC signaling. Everyone
 * listens by default; the microphone is opt-in. A peer connection exists between two members
 * when either has a microphone, and turning yours on swaps it into the existing connections.
 * Kept light for low-end PCs: no audio graph of its own, connections opened a few at a time,
 * and peer settings only revisited when the roster changes.
 */
export class VoiceClient {
  private state: VoiceSnapshot;
  private stream: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  /** Who is connected and on which team, as last applied to the peers (see syncPeers). */
  private roster = "";
  private peerStep: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: (() => void)[] = [];
  private generation = 0;
  private disposed = false;
  private config: RTCConfiguration = {};

  constructor(private room: GameRoom, private notify: (state: VoiceSnapshot) => void) {
    this.state = { ...INITIAL_VOICE, ...loadPrefs(), channel: room.state.mode === "tdm" ? "team" : "all" };
    this.unsubscribers.push(room.onMessage<VoiceMember[]>("voice:members", (members) => {
      this.patch({ members }); this.syncPeers();
    }), room.onMessage<{ from: string; signal: VoiceSignal }>("voice:signal", ({ from, signal }) => {
      const peer = this.peers.get(from);
      if (!peer || !this.state.enabled) return;
      peer.queue = peer.queue.then(() => this.receive(from, peer, signal)).catch(() => {
        if (this.peers.get(from) === peer) this.patch({ error: "A voice connection failed. Leave voice and rejoin to retry." });
      });
    }), room.onMessage<RTCIceServer[]>("voice:config", (servers) => {
      this.config = { iceServers: servers };
      for (const peer of this.peers.values()) {
        peer.pc.setConfiguration(this.config);
        if (peer.pc.connectionState === "new" || peer.pc.connectionState === "failed") peer.pc.restartIce();
      }
    }));
    // Game state arrives many times a second; voice only cares when players come, go or switch teams.
    const sync = () => { if (this.rosterKey() !== this.roster) this.syncPeers(); };
    const drop = () => { this.leave(false); this.patch({ error: "Voice disconnected. Rejoin voice after reconnecting." }); };
    room.onStateChange(sync); room.onDrop(drop); room.onLeave(drop);
    this.unsubscribers.push(() => room.onStateChange.remove(sync), () => room.onDrop.remove(drop), () => room.onLeave.remove(drop));
    // Browsers hold back sound until the page is used; the next click or key lets voices play.
    if (typeof document !== "undefined" && document.addEventListener) {
      const unblock = () => { if (this.state.soundBlocked) void this.resumeSound(); };
      document.addEventListener("pointerdown", unblock); document.addEventListener("keydown", unblock);
      this.unsubscribers.push(() => { document.removeEventListener("pointerdown", unblock); document.removeEventListener("keydown", unblock); });
    }
    this.patch({});
  }

  /** Joins voice to listen, without a microphone. */
  listen() {
    if (this.disposed || this.state.enabled || typeof RTCPeerConnection === "undefined") return;
    try { this.config = { iceServers: iceServers() }; } catch (error) { this.patch({ error: error instanceof Error ? error.message : "Unable to start voice." }); return; }
    this.patch({ enabled: true, error: "" });
    this.publish();
  }

  /** Turns the microphone on (joining voice first if needed). */
  async join() {
    if (this.disposed || this.state.mic || this.state.pending) return;
    const generation = ++this.generation;
    this.patch({ pending: true, error: "" });
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Voice needs HTTPS or localhost and a browser with microphone support.");
      if (!this.state.enabled) this.config = { iceServers: iceServers() };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (this.disposed || generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      for (const track of stream.getAudioTracks()) {
        track.enabled = false;
        track.onended = () => { this.micOff(); this.patch({ error: "Microphone disconnected. Turn the mic on again to select one." }); };
      }
      for (const peer of this.peers.values()) this.sendTrack(peer, stream.getAudioTracks()[0].clone());
      this.patch({ enabled: true, mic: true, pending: false, talking: false, micMuted: false });
      this.publish(); this.syncPeers();
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.patch({ pending: false });
      const name = error instanceof Error ? error.name : "";
      this.patch({ error: name === "NotAllowedError" ? "Microphone permission was denied. Allow it in your browser, then try again." : name === "NotFoundError" ? "No microphone found. Connect one and try again." : error instanceof Error ? error.message : "Unable to start voice." });
    }
  }

  /** Turns the microphone off; you keep hearing everyone. */
  micOff() {
    ++this.generation;
    const had = this.state.mic || this.state.pending;
    this.stopStream();
    if (!had) return;
    for (const peer of this.peers.values()) this.sendTrack(peer, null);
    this.patch({ mic: false, pending: false, talking: false });
    if (this.state.enabled) { this.publish(); this.syncPeers(); }
  }

  /** Leaves voice entirely: no microphone and no sound from others. */
  leave(notifyServer = true) {
    ++this.generation;
    for (const [id] of this.peers) this.removePeer(id);
    this.stopStream();
    if (this.peerStep) clearTimeout(this.peerStep);
    this.peerStep = null;
    this.roster = "";
    const wasEnabled = this.state.enabled;
    this.patch({ enabled: false, mic: false, pending: false, talking: false, members: [], connected: 0, soundBlocked: false });
    if (notifyServer && wasEnabled) this.publish();
  }

  channel(channel: VoiceChannel) {
    this.patch({ channel: this.room.state.mode === "tdm" ? channel : "all", talking: false });
    this.syncPeers(); this.publish();
  }
  /** Push-to-talk. A channel switches where this transmission goes; it becomes the selected channel. */
  talk(talking: boolean, channel?: VoiceChannel) {
    talking = talking && this.state.mic && !this.state.micMuted && !this.state.deafened;
    const next = talking && channel ? (this.room.state.mode === "tdm" ? channel : "all") : this.state.channel;
    if (talking === this.state.talking && next === this.state.channel) return;
    this.patch({ talking, channel: next }); this.syncPeers(); this.publish();
  }
  muteMic() { this.talk(false); this.patch({ micMuted: !this.state.micMuted }); }
  deafen() { this.talk(false); this.patch({ deafened: !this.state.deafened }); this.syncPeers(); }
  volume(volume: number) { this.patch({ volume: Math.max(0, Math.min(1, volume)) }); this.savePrefs(); this.syncPeers(); }
  hearAll(hear: boolean) { this.patch({ hearAll: hear }); this.savePrefs(); this.syncPeers(); }
  mutePeer(id: string) {
    const muted = new Set(this.state.mutedPeers);
    if (muted.has(id)) muted.delete(id); else muted.add(id);
    this.patch({ mutedPeers: [...muted] }); this.syncPeers();
  }
  async resumeSound() {
    try { await Promise.all([...this.peers.values()].map((p) => p.audio.play())); this.patch({ soundBlocked: false }); }
    catch { this.patch({ soundBlocked: true }); }
  }
  dispose() { this.leave(); this.disposed = true; this.unsubscribers.forEach((unsubscribe) => unsubscribe()); }

  private patch(update: Partial<VoiceSnapshot>) { this.state = { ...this.state, ...update }; if (!this.disposed) this.notify(this.state); }
  private savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ hearAll: this.state.hearAll, volume: this.state.volume })); } catch { /* storage unavailable */ }
  }
  private publish() { this.room.send("voice:state", { enabled: this.state.enabled, channel: this.state.channel, talking: this.state.talking, mic: this.state.mic }); }
  private signal(to: string, signal: VoiceSignal) {
    if (this.state.enabled && !this.disposed) this.room.send("voice:signal", { to, signal });
  }

  private stopStream() {
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = null;
  }

  /** Swaps what a peer connection sends (the microphone, or nothing), without renegotiating. */
  private sendTrack(peer: Peer, track: MediaStreamTrack | null) {
    if (track) track.enabled = false;
    const old = peer.track;
    peer.track = track;
    void peer.sender.replaceTrack(track).catch(() => {}).finally(() => old?.stop());
  }

  /** Players' connection and team, which decide who is linked and who is heard. */
  private rosterKey() {
    let key = "";
    this.room.state.players.forEach((p, id) => { key += `${id}:${p.connected ? 1 : 0}:${p.team};`; });
    return key;
  }

  private syncPeers() {
    if (!this.state.enabled) return;
    // Other players' updates can arrive while our join is in flight. Our own membership
    // is the server's acknowledgement, sent after our temporary TURN configuration.
    if (!this.state.members.some((member) => member.id === this.room.sessionId)) return;
    this.roster = this.rosterKey();
    const me = this.room.state.players.get(this.room.sessionId);
    // Two listeners have nothing to send each other.
    const members = this.state.members.filter((m) => m.id !== this.room.sessionId && this.room.state.players.get(m.id)?.connected && (m.mic !== false || this.state.mic));
    for (const [id] of this.peers) if (!members.some((m) => m.id === id)) this.removePeer(id);
    let opened = 0, waiting = false;
    for (const member of members) {
      let peer = this.peers.get(member.id);
      if (!peer) {
        // A few new connections at a time; the rest follow shortly.
        if (opened >= PEERS_PER_STEP) { waiting = true; continue; }
        peer = this.createPeer(member.id); opened++;
      }
      const team = this.room.state.players.get(member.id)?.team ?? 0;
      if (peer.track) peer.track.enabled = this.state.mic && this.state.talking && canHearVoice(this.state.channel, me?.team ?? 0, team, this.room.state.mode);
      const muted = this.state.deafened || this.state.mutedPeers.includes(member.id) || !canHearVoice(member.channel, team, me?.team ?? 0, this.room.state.mode)
        || (member.channel === "all" && !this.state.hearAll);
      if (peer.audio.muted !== muted) peer.audio.muted = muted;
      if (peer.audio.volume !== this.state.volume) peer.audio.volume = this.state.volume;
    }
    if (waiting && !this.peerStep) this.peerStep = setTimeout(() => { this.peerStep = null; this.syncPeers(); }, PEER_STEP_MS);
  }

  private createPeer(id: string): Peer {
    const pc = new RTCPeerConnection(this.config);
    const track = this.stream ? this.stream.getAudioTracks()[0].clone() : null;
    if (track) track.enabled = false;
    // An audio slot both ways from the start; a listener's stays empty until the mic fills it.
    const { sender } = pc.addTransceiver(track ?? "audio", { direction: "sendrecv", streams: [new MediaStream()] });
    const audio = document.createElement("audio"); audio.autoplay = true;
    audio.dataset.voicePeer = id; audio.style.display = "none"; document.body.appendChild(audio);
    const peer: Peer = { pc, sender, track, audio, makingOffer: false, ignoreOffer: false, settingAnswer: false, candidates: [], queue: Promise.resolve() };
    this.peers.set(id, peer);
    pc.onicecandidate = ({ candidate }) => { if (candidate && this.peers.get(id) === peer) this.signal(id, { candidate: candidate.toJSON() }); };
    pc.ontrack = ({ track: remote, streams }) => {
      audio.srcObject = streams[0] ?? new MediaStream([remote]);
      void audio.play().catch(() => { if (this.peers.get(id) === peer) this.patch({ soundBlocked: true }); });
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      this.patch({ connected: [...this.peers.values()].filter((p) => p.pc.connectionState === "connected").length });
      if (pc.connectionState === "connected") void limitBitrate(sender);
      if (pc.connectionState === "failed") this.patch({ error: "A voice connection failed. Rejoin voice to retry. Some networks need a TURN relay." });
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (this.peers.get(id) === peer) this.signal(id, { description: pc.localDescription!.toJSON() });
      } catch { if (this.peers.get(id) === peer) this.patch({ error: "Unable to connect voice. Leave voice and rejoin to retry." }); }
      finally { peer.makingOffer = false; }
    };
    return peer;
  }

  private async receive(id: string, peer: Peer, signal: VoiceSignal) {
    if (this.peers.get(id) !== peer) return;
    const pc = peer.pc;
    if ("description" in signal) {
      const description = signal.description;
      const ready = !peer.makingOffer && (pc.signalingState === "stable" || peer.settingAnswer);
      const collision = description.type === "offer" && !ready;
      peer.ignoreOffer = this.room.sessionId < id && collision;
      if (peer.ignoreOffer) return;
      peer.settingAnswer = description.type === "answer";
      await pc.setRemoteDescription(description);
      peer.settingAnswer = false;
      for (const candidate of peer.candidates.splice(0)) await pc.addIceCandidate(candidate);
      if (description.type === "offer") {
        await pc.setLocalDescription();
        if (this.peers.get(id) === peer) this.signal(id, { description: pc.localDescription!.toJSON() });
      }
    } else if (!peer.ignoreOffer) {
      if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
      else peer.candidates.push(signal.candidate);
    }
  }

  private removePeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id); peer.pc.close(); peer.track?.stop();
    peer.audio.pause(); peer.audio.srcObject = null; peer.audio.remove();
  }
}

/** Caps what a sender encodes at MIC_BITRATE; its encodings exist once the connection is up. */
async function limitBitrate(sender: RTCRtpSender) {
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    for (const encoding of params.encodings) encoding.maxBitrate = MIC_BITRATE;
    await sender.setParameters(params);
  } catch { /* best effort: the browser picks its own bitrate */ }
}
