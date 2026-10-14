import { afterEach, expect, it, vi } from "vitest";
import { VoiceClient } from "./voice";
import type { GameRoom } from "./session";

afterEach(() => vi.unstubAllGlobals());

it("waits for its own membership acknowledgement before creating peers with TURN settings", async () => {
  const messages = new Map<string, (data: unknown) => void>();
  const signal = () => Object.assign(vi.fn(), { remove: vi.fn() });
  const room = {
    sessionId: "me", state: { mode: "tdm", players: new Map([["me", { team: 1, connected: true }], ["peer", { team: 2, connected: true }]]) },
    onMessage: (type: string, callback: (data: unknown) => void) => { messages.set(type, callback); return vi.fn(); },
    onStateChange: signal(), onDrop: signal(), onLeave: signal(), send: vi.fn(),
  } as unknown as GameRoom;
  const track = { enabled: true, onended: null, stop: vi.fn(), clone: () => ({ enabled: true, stop: vi.fn() }) };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
  vi.stubGlobal("document", {
    body: { appendChild: vi.fn() },
    createElement: () => ({ dataset: {}, style: {}, pause: vi.fn(), remove: vi.fn(), play: vi.fn().mockResolvedValue(undefined) }),
  });
  vi.stubGlobal("MediaStream", class { constructor(public tracks: unknown[]) {} });
  const configurations: RTCConfiguration[] = [];
  vi.stubGlobal("RTCPeerConnection", class {
    connectionState = "new";
    constructor(config: RTCConfiguration) { configurations.push(config); }
    addTrack = vi.fn(); close = vi.fn(); setConfiguration = vi.fn(); restartIce = vi.fn();
  });
  const voice = new VoiceClient(room, vi.fn());
  try {
    await voice.join();
    // Another player's presence update can precede the response to our own join.
    messages.get("voice:members")!([{ id: "peer", channel: "all", talking: false }]);
    expect(configurations).toHaveLength(0);
    const servers = [{ urls: "turn:relay.example.com:3478", username: "temporary", credential: "temporary" }];
    messages.get("voice:config")!(servers);
    messages.get("voice:members")!([{ id: "me", channel: "team", talking: false }, { id: "peer", channel: "all", talking: false }]);
    expect(configurations).toEqual([{ iceServers: servers }]);
  } finally { voice.dispose(); }
});
