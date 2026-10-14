import { canHearVoice, type VoiceChannel, type VoiceMember, type VoiceSignal } from "../../shared/voice";
import type { GameRoom } from "./session";

export interface VoiceSnapshot {
  enabled: boolean; pending: boolean; talking: boolean; channel: VoiceChannel;
  micMuted: boolean; deafened: boolean; volume: number; error: string; soundBlocked: boolean;
  members: VoiceMember[]; connected: number; mutedPeers: string[];
}
export const INITIAL_VOICE: VoiceSnapshot = {
  enabled: false, pending: false, talking: false, channel: "team", micMuted: false,
  deafened: false, volume: 0.8, error: "", soundBlocked: false, members: [], connected: 0, mutedPeers: [],
};
interface Peer {
  pc: RTCPeerConnection; track: MediaStreamTrack; audio: HTMLAudioElement;
  makingOffer: boolean; ignoreOffer: boolean; settingAnswer: boolean;
  candidates: RTCIceCandidateInit[]; queue: Promise<void>;
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

/** Audio goes directly to peers; Colyseus only carries membership and WebRTC signaling. */
export class VoiceClient {
  private state: VoiceSnapshot;
  private stream: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private unsubscribers: (() => void)[] = [];
  private generation = 0;
  private disposed = false;
  private config: RTCConfiguration = {};

  constructor(private room: GameRoom, private notify: (state: VoiceSnapshot) => void) {
    this.state = { ...INITIAL_VOICE, channel: room.state.mode === "tdm" ? "team" : "all" };
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
    const sync = () => this.syncPeers();
    const drop = () => { this.leave(false); this.patch({ error: "Voice disconnected. Rejoin voice after reconnecting." }); };
    room.onStateChange(sync); room.onDrop(drop); room.onLeave(drop);
    this.unsubscribers.push(() => room.onStateChange.remove(sync), () => room.onDrop.remove(drop), () => room.onLeave.remove(drop));
    this.patch({});
  }

  async join() {
    if (this.disposed || this.state.enabled || this.state.pending) return;
    const generation = ++this.generation;
    this.patch({ pending: true, error: "" });
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Voice needs HTTPS or localhost and a browser with microphone support.");
      this.config = { iceServers: iceServers() };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (this.disposed || generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      for (const track of stream.getAudioTracks()) {
        track.enabled = false;
        track.onended = () => { this.leave(); this.patch({ error: "Microphone disconnected. Rejoin voice to select a microphone." }); };
      }
      this.patch({ enabled: true, pending: false, talking: false, micMuted: false });
      this.publish();
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.leave(false);
      const name = error instanceof Error ? error.name : "";
      this.patch({ error: name === "NotAllowedError" ? "Microphone permission was denied. Allow it in your browser, then try again." : name === "NotFoundError" ? "No microphone found. Connect one and try again." : error instanceof Error ? error.message : "Unable to start voice." });
    }
  }

  leave(notifyServer = true) {
    ++this.generation;
    for (const [id] of this.peers) this.removePeer(id);
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = null;
    const wasEnabled = this.state.enabled;
    this.patch({ enabled: false, pending: false, talking: false, members: [], connected: 0, soundBlocked: false });
    if (notifyServer && wasEnabled) this.publish();
  }

  channel(channel: VoiceChannel) {
    this.patch({ channel: this.room.state.mode === "tdm" ? channel : "all", talking: false });
    this.syncPeers(); this.publish();
  }
  talk(talking: boolean) {
    talking = talking && this.state.enabled && !this.state.micMuted && !this.state.deafened;
    if (talking === this.state.talking) return;
    this.patch({ talking }); this.syncPeers(); this.publish();
  }
  muteMic() { this.talk(false); this.patch({ micMuted: !this.state.micMuted }); }
  deafen() { this.talk(false); this.patch({ deafened: !this.state.deafened }); this.syncPeers(); }
  volume(volume: number) { this.patch({ volume: Math.max(0, Math.min(1, volume)) }); this.syncPeers(); }
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
  private publish() { this.room.send("voice:state", { enabled: this.state.enabled, channel: this.state.channel, talking: this.state.talking }); }
  private signal(to: string, signal: VoiceSignal) {
    if (this.state.enabled && !this.disposed) this.room.send("voice:signal", { to, signal });
  }

  private syncPeers() {
    if (!this.state.enabled || !this.stream) return;
    // Other players' updates can arrive while our join is in flight. Our own membership
    // is the server's acknowledgement, sent after our temporary TURN configuration.
    if (!this.state.members.some((member) => member.id === this.room.sessionId)) return;
    const me = this.room.state.players.get(this.room.sessionId);
    const members = this.state.members.filter((m) => m.id !== this.room.sessionId && this.room.state.players.get(m.id)?.connected);
    for (const [id] of this.peers) if (!members.some((m) => m.id === id)) this.removePeer(id);
    for (const member of members) {
      const peer = this.peers.get(member.id) ?? this.createPeer(member.id);
      const team = this.room.state.players.get(member.id)?.team ?? 0;
      peer.track.enabled = this.state.talking && canHearVoice(this.state.channel, me?.team ?? 0, team, this.room.state.mode);
      peer.audio.muted = this.state.deafened || this.state.mutedPeers.includes(member.id) || !canHearVoice(member.channel, team, me?.team ?? 0, this.room.state.mode);
      peer.audio.volume = this.state.volume;
    }
  }

  private createPeer(id: string): Peer {
    const pc = new RTCPeerConnection(this.config);
    const track = this.stream!.getAudioTracks()[0].clone(); track.enabled = false;
    const audio = document.createElement("audio"); audio.autoplay = true;
    audio.dataset.voicePeer = id; audio.style.display = "none"; document.body.appendChild(audio);
    const peer: Peer = { pc, track, audio, makingOffer: false, ignoreOffer: false, settingAnswer: false, candidates: [], queue: Promise.resolve() };
    this.peers.set(id, peer);
    pc.onicecandidate = ({ candidate }) => { if (candidate && this.peers.get(id) === peer) this.signal(id, { candidate: candidate.toJSON() }); };
    pc.ontrack = ({ track: remote, streams }) => {
      audio.srcObject = streams[0] ?? new MediaStream([remote]);
      void audio.play().catch(() => { if (this.peers.get(id) === peer) this.patch({ soundBlocked: true }); });
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      this.patch({ connected: [...this.peers.values()].filter((p) => p.pc.connectionState === "connected").length });
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
    pc.addTrack(track, new MediaStream([track]));
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
    this.peers.delete(id); peer.pc.close(); peer.track.stop();
    peer.audio.pause(); peer.audio.srcObject = null; peer.audio.remove();
  }
}
