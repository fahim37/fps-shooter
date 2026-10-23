export type VoiceChannel = "team" | "all";
/** `mic` false: listening only. Two listeners never connect; anyone with a mic connects to everyone. */
export interface VoiceMember { id: string; channel: VoiceChannel; talking: boolean; mic: boolean }
export interface VoiceState { enabled: boolean; channel: VoiceChannel; talking: boolean; mic?: boolean }
export type VoiceSignal = { description: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit };

/** Team is a transmit channel; everyone can still hear All and their own teammates. */
export function canHearVoice(channel: VoiceChannel, senderTeam: number, listenerTeam: number, mode: string): boolean {
  return channel === "all" || (mode === "tdm" && senderTeam > 0 && senderTeam === listenerTeam);
}

export function isVoiceState(value: unknown): value is VoiceState {
  if (!value || typeof value !== "object") return false;
  const v = value as VoiceState;
  return typeof v.enabled === "boolean" && typeof v.talking === "boolean" && (v.channel === "team" || v.channel === "all")
    && (v.mic === undefined || typeof v.mic === "boolean");
}

export function isVoiceSignal(value: unknown): value is VoiceSignal {
  if (!value || typeof value !== "object") return false;
  if ("description" in value) {
    const d = value.description as RTCSessionDescriptionInit | null;
    return !!d && (d.type === "offer" || d.type === "answer") && typeof d.sdp === "string" && d.sdp.length <= 16_000;
  }
  if ("candidate" in value) {
    const c = value.candidate as RTCIceCandidateInit | null;
    return !!c && typeof c.candidate === "string" && c.candidate.length <= 2000 &&
      (c.sdpMid == null || (typeof c.sdpMid === "string" && c.sdpMid.length <= 100)) &&
      (c.sdpMLineIndex == null || (Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex < 32));
  }
  return false;
}
