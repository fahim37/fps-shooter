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
    messages.get("voice:members")!([{ id: "peer", channel: "all", talking: false, mic: true }]);
    expect(configurations).toHaveLength(0);
    const servers = [{ urls: "turn:relay.example.com:3478", username: "temporary", credential: "temporary" }];
    messages.get("voice:config")!(servers);
    messages.get("voice:members")!([{ id: "me", channel: "team", talking: false }, { id: "peer", channel: "all", talking: false, mic: true }]);
    expect(configurations).toEqual([{ iceServers: servers }]);
  } finally { voice.dispose(); }
});

function fakeVoice(mode: "tdm" | "ffa") {
  const room = {
    sessionId: "me", state: { mode, players: new Map([["me", { team: mode === "tdm" ? 1 : 0, connected: true }]]) },
    onMessage: () => vi.fn(), onStateChange: Object.assign(vi.fn(), { remove: vi.fn() }),
    onDrop: Object.assign(vi.fn(), { remove: vi.fn() }), onLeave: Object.assign(vi.fn(), { remove: vi.fn() }), send: vi.fn(),
  } as unknown as GameRoom;
  const track = { enabled: true, onended: null, stop: vi.fn() };
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }) } });
  return { room, send: room.send as ReturnType<typeof vi.fn> };
}

it("switches the transmit channel for a push-to-talk press in the same voice update", async () => {
  const { room, send } = fakeVoice("tdm");
  const voice = new VoiceClient(room, vi.fn());
  try {
    voice.talk(true, "all");
    expect(send).not.toHaveBeenCalled(); // Not joined yet: nothing to transmit.
    await voice.join();
    send.mockClear();
    voice.talk(true, "all");
    voice.talk(true, "team");
    voice.talk(true, "team");
    voice.talk(false);
    expect(send.mock.calls).toEqual([
      ["voice:state", { enabled: true, channel: "all", talking: true, mic: true }],
      ["voice:state", { enabled: true, channel: "team", talking: true, mic: true }],
      ["voice:state", { enabled: true, channel: "team", talking: false, mic: true }],
    ]);
  } finally { voice.dispose(); }
});

it("sends team push-to-talk to All in Free for All", async () => {
  const { room, send } = fakeVoice("ffa");
  const voice = new VoiceClient(room, vi.fn());
  try {
    await voice.join();
    send.mockClear();
    voice.talk(true, "team");
    expect(send).toHaveBeenLastCalledWith("voice:state", { enabled: true, channel: "all", talking: true, mic: true });
  } finally { voice.dispose(); }
});

it("listens without a microphone, connecting only to members who have one", () => {
  const messages = new Map<string, (data: unknown) => void>();
  const signal = () => Object.assign(vi.fn(), { remove: vi.fn() });
  const players = new Map([["me", { team: 1, connected: true }], ["talker", { team: 2, connected: true }], ["listener", { team: 1, connected: true }]]);
  const room = {
    sessionId: "me", state: { mode: "tdm", players },
    onMessage: (type: string, callback: (data: unknown) => void) => { messages.set(type, callback); return vi.fn(); },
    onStateChange: signal(), onDrop: signal(), onLeave: signal(), send: vi.fn(),
  } as unknown as GameRoom;
  const getUserMedia = vi.fn();
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const audios: { muted: boolean; dataset: Record<string, string> }[] = [];
  vi.stubGlobal("document", {
    body: { appendChild: vi.fn() },
    createElement: () => { const audio = { dataset: {}, style: {}, muted: false, pause: vi.fn(), remove: vi.fn(), play: vi.fn().mockResolvedValue(undefined) }; audios.push(audio); return audio; },
  });
  vi.stubGlobal("MediaStream", class { constructor(public tracks: unknown[]) {} });
  vi.stubGlobal("AudioContext", class {
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{ enabled: true, stop: vi.fn() }] } }; }
    close() { return Promise.resolve(); }
  });
  const peers: string[] = [];
  vi.stubGlobal("RTCPeerConnection", class {
    connectionState = "new";
    constructor() { peers.push("peer"); }
    addTrack = vi.fn(); close = vi.fn(); setConfiguration = vi.fn(); restartIce = vi.fn(); getSenders = () => [];
  });
  const voice = new VoiceClient(room, vi.fn());
  try {
    voice.listen();
    expect(room.send).toHaveBeenLastCalledWith("voice:state", { enabled: true, channel: "team", talking: false, mic: false });
    expect(getUserMedia).not.toHaveBeenCalled();
    messages.get("voice:members")!([
      { id: "me", channel: "team", talking: false, mic: false },
      { id: "talker", channel: "all", talking: true, mic: true },
      { id: "listener", channel: "team", talking: false, mic: false },
    ]);
    // One connection, to the player with a microphone; their All voice plays by default.
    expect(peers).toHaveLength(1);
    expect(audios.map((a) => [a.dataset.voicePeer, a.muted])).toEqual([["talker", false]]);
    voice.hearAll(false);
    expect(audios[0].muted).toBe(true);
  } finally { voice.dispose(); }
});
