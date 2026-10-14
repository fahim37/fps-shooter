import { isVoiceSignal, isVoiceState, type VoiceMember } from "../game/shared/voice";
import { createHmac } from "node:crypto";

interface Transport {
  available(id: string): boolean;
  mode(): string;
  send(id: string, type: string, data: unknown): void;
  broadcast(type: string, data: unknown): void;
  iceServers?(id: string): RTCIceServer[] | undefined;
}

/** Only opted-in humans in this match can exchange WebRTC signaling. No audio is stored. */
export class VoiceRelay {
  private members = new Map<string, VoiceMember>();
  private rates = new Map<string, { since: number; count: number }>();
  private configuredAt = new Map<string, number>();
  constructor(private transport: Transport) {}

  state(id: string, value: unknown) {
    if (!isVoiceState(value)) return;
    if (!value.enabled) { this.remove(id); return; }
    if (!this.transport.available(id) || !this.allow(id)) return;
    const member: VoiceMember = { id, channel: this.transport.mode() === "tdm" ? value.channel : "all", talking: value.talking };
    this.members.set(id, member);
    this.publish();
  }

  signal(id: string, value: unknown) {
    if (!this.members.has(id) || !this.transport.available(id) || !value || typeof value !== "object" || !this.allow(id)) return;
    const { to, signal } = value as { to?: unknown; signal?: unknown };
    if (typeof to !== "string" || to === id || !this.members.has(to) || !this.transport.available(to) || !isVoiceSignal(signal)) return;
    this.transport.send(to, "voice:signal", { from: id, signal });
  }

  remove(id: string) {
    this.rates.delete(id);
    this.configuredAt.delete(id);
    if (this.members.delete(id)) this.publish();
  }

  private publish() {
    for (const id of this.members.keys()) {
      if (Date.now() - (this.configuredAt.get(id) ?? 0) < 30 * 60_000) continue;
      const servers = this.transport.iceServers?.(id);
      if (servers) this.transport.send(id, "voice:config", servers);
      this.configuredAt.set(id, Date.now());
    }
    this.transport.broadcast("voice:members", [...this.members.values()]);
  }
  private allow(id: string) {
    const now = Date.now();
    let rate = this.rates.get(id);
    if (!rate || now - rate.since >= 10_000) { rate = { since: now, count: 0 }; this.rates.set(id, rate); }
    return ++rate.count <= 500;
  }
}

/** Coturn REST credentials expire after one hour. The shared secret stays on the server. */
export function voiceIceServers(id: string, at = Date.now()): RTCIceServer[] | undefined {
  const secret = process.env.VOICE_TURN_SECRET;
  const urls = process.env.VOICE_TURN_URLS?.split(",").map((url) => url.trim()).filter(Boolean);
  if (!secret || !urls?.length) return undefined;
  const username = `${Math.floor(at / 1000) + 3600}:${id}`;
  return [{ urls: "stun:stun.l.google.com:19302" }, { urls, username, credential: createHmac("sha1", secret).update(username).digest("base64") }];
}
