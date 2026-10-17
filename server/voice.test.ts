import { describe, expect, it, vi } from "vitest";
import { VoiceRelay, voiceIceServers } from "./voice";
import { createHmac } from "node:crypto";
import { canHearVoice, isVoiceSignal } from "../game/shared/voice";

function fixture(mode = "tdm") {
  const available = new Set(["blue", "green"]);
  const transport = { available: (id: string) => available.has(id), mode: () => mode, send: vi.fn(), broadcast: vi.fn() };
  const relay = new VoiceRelay(transport);
  const join = (id: string) => relay.state(id, { enabled: true, channel: "team", talking: false });
  return { relay, transport, join, available };
}
const offer = { description: { type: "offer", sdp: "audio offer" } };

describe("voice membership and signaling", () => {
  it("relays only between opted-in players in the same match, stamping the sender", () => {
    const { relay, join, transport } = fixture();
    join("blue");
    relay.signal("blue", { to: "green", signal: offer });
    expect(transport.send).not.toHaveBeenCalled();
    join("green");
    relay.signal("blue", { to: "green", from: "spoof", signal: offer });
    expect(transport.send).toHaveBeenCalledWith("green", "voice:signal", { from: "blue", signal: offer });
    transport.send.mockClear();
    relay.signal("blue", { to: "outside-room", signal: offer });
    relay.signal("outside-room", { to: "blue", signal: offer });
    relay.signal("blue", { to: "blue", signal: offer });
    expect(transport.send).not.toHaveBeenCalled();
  });
  it("removes disconnected players and ignores malformed or oversized messages", () => {
    const { relay, join, transport, available } = fixture();
    join("blue"); join("green");
    relay.state("outsider", { enabled: true, channel: "all", talking: true });
    relay.state("blue", { enabled: true, channel: "unknown", talking: true });
    expect(transport.broadcast).toHaveBeenLastCalledWith("voice:members", [
      { id: "blue", channel: "team", talking: false }, { id: "green", channel: "team", talking: false },
    ]);
    for (const signal of [null, {}, { description: { type: "offer", sdp: "x".repeat(16_001) } }, { candidate: { candidate: "ice", sdpMLineIndex: -1 } }]) relay.signal("blue", { to: "green", signal });
    available.delete("green");
    relay.signal("blue", { to: "green", signal: offer });
    expect(transport.send).not.toHaveBeenCalled();
    relay.remove("green");
    expect(transport.broadcast).toHaveBeenLastCalledWith("voice:members", [{ id: "blue", channel: "team", talking: false }]);
    relay.state("blue", { enabled: false, channel: "team", talking: false });
    expect(transport.broadcast).toHaveBeenLastCalledWith("voice:members", []);
  });
  it("uses All for free-for-all and bounds signaling traffic", () => {
    const { relay, join, transport } = fixture("ffa");
    join("blue"); join("green");
    expect(transport.broadcast).toHaveBeenLastCalledWith("voice:members", [
      { id: "blue", channel: "all", talking: false }, { id: "green", channel: "all", talking: false },
    ]);
    for (let i = 0; i < 600; i++) relay.signal("blue", { to: "green", signal: offer });
    expect(transport.send.mock.calls.length).toBeLessThanOrEqual(500);
  });
});

describe("voice audio routing", () => {
  it("keeps Team audio on the sender's team while All reaches either team", () => {
    expect(canHearVoice("team", 1, 1, "tdm")).toBe(true);
    expect(canHearVoice("team", 1, 2, "tdm")).toBe(false);
    expect(canHearVoice("team", 0, 0, "ffa")).toBe(false);
    expect(canHearVoice("all", 1, 2, "tdm")).toBe(true);
    expect(canHearVoice("all", 0, 0, "ffa")).toBe(true);
  });
  it("accepts audio descriptions and ICE candidates", () => {
    expect(isVoiceSignal(offer)).toBe(true);
    expect(isVoiceSignal({ candidate: { candidate: "candidate:ice", sdpMid: "0", sdpMLineIndex: 0 } })).toBe(true);
  });
});

describe("TURN credentials", () => {
  it("generates expiring credentials without exposing the server secret", () => {
    vi.stubEnv("VOICE_TURN_SECRET", "test-server-secret");
    vi.stubEnv("VOICE_TURN_URLS", "turn:relay.example.com:3478?transport=udp,turn:relay.example.com:3478?transport=tcp");
    try {
      const servers = voiceIceServers("player", 1_000_000)!;
      expect(servers[1].username).toBe("4600:player");
      expect(servers[1].credential).toBe(createHmac("sha1", "test-server-secret").update("4600:player").digest("base64"));
      expect(JSON.stringify(servers)).not.toContain("test-server-secret");
    } finally { vi.unstubAllEnvs(); }
  });
});
