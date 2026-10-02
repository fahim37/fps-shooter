import { Client, type Room } from "@colyseus/sdk";
import assert from "node:assert/strict";
import type { MatchState } from "../../game/shared/schema";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error("Timed out waiting for room state"); await sleep(30); }
}
async function main() {
  const client = new Client(process.argv[2] || "ws://localhost:2567");
  const rooms: Room<unknown, MatchState>[] = [];
  function track(room: Room<unknown, MatchState>) { rooms.push(room); room.onMessage("*", () => {}); return room; }
  async function create(format: string, extra = {}) {
    const r = track(await client.create<MatchState>("match", { name: "Host", char: 0, mode: "tdm", queue: "rooms", create: { mode: "tdm", maxPlayers: 12, bots: 12, botSkill: 1, private: false, roomName: "Lobby test", format, lobby: true, ...extra } }));
    await until(() => !!r.state?.hostId); return r;
  }
  async function peer(room: Room<unknown, MatchState>, name: string) {
    const r = track(await client.joinById<MatchState>(room.roomId, { name, char: 0 }));
    await until(() => !!r.state?.players?.has(r.sessionId)); return r;
  }
  try {
    const a = await create("1v1");
    assert.equal(a.state.maxPlayers, 2); assert.equal(a.state.botFill, 0); assert.equal(a.state.mode, "tdm");
    a.send("ready", true); a.send("start", {}); await sleep(300);
    assert.equal(a.state.phase, "waiting", "Solo host cannot start a duel");
    // Quick matchmaking must never enter a user-created room.
    const quick = track(await client.joinOrCreate<MatchState>("match", { name: "Quick", char: 0, mode: "tdm", queue: "quick" }));
    assert.notEqual(quick.roomId, a.roomId);
    const b = await peer(a, "Guest");
    await until(() => a.state.players.size === 2);
    assert.equal(a.state.players.get(a.sessionId)?.ready, false, "Joining resets host readiness");
    assert.deepEqual([...a.state.players.values()].map((p) => p.team).sort(), [1, 2]);
    a.send("emote", "dance");
    await until(() => b.state.players.get(a.sessionId)?.emote === "dance");
    a.send("emote", "magic"); await sleep(100);
    assert.equal(b.state.players.get(a.sessionId)?.emote, "dance", "Showoffs are rate limited");
    await sleep(800);
    for (const invalid of ["death", "__proto__", null, { id: "dance" }, 1]) a.send("emote", invalid);
    await sleep(100);
    assert.equal(b.state.players.get(a.sessionId)?.emote, "dance", "Only lobby clips are allowed");
    a.send("emote", "talk"); await until(() => b.state.players.get(a.sessionId)?.emote === "talk");
    await assert.rejects(client.joinById(a.roomId, { name: "Extra", char: 0 }), /locked|full/);
    a.send("ready", true); b.send("ready", true);
    await until(() => [...a.state.players.values()].every((p) => p.ready));
    b.send("start", {}); await sleep(150);
    assert.equal(a.state.phase, "waiting", "Only host may start");
    a.send("start", {}); await until(() => a.state.phase === "warmup");
    assert.equal(a.state.players.get(a.sessionId)?.emote, "idle", "Starting clears cosmetic state");
    a.send("emote", "dance"); await sleep(100);
    assert.equal(a.state.players.get(a.sessionId)?.emote, "idle", "Match gameplay rejects lobby showoffs");
    await b.leave(); await until(() => a.state.phase === "waiting");
    assert.equal(a.state.players.size, 1); assert.equal(a.state.botFill, 0);
    const replacement = await peer(a, "Replacement");
    await a.leave(); await until(() => replacement.state.hostId === replacement.sessionId);
    assert.equal(replacement.state.phase, "waiting");

    const doubles = await create("2v2");
    doubles.send("emote", "dance"); await until(() => doubles.state.players.get(doubles.sessionId)?.emote === "dance");
    const p2 = await peer(doubles, "Two"); const p3 = await peer(doubles, "Three");
    await until(() => p2.state.players.get(doubles.sessionId)?.emote === "dance");
    for (const r of [doubles, p2, p3]) r.send("ready", true);
    doubles.send("start", {}); await sleep(200); assert.equal(doubles.state.phase, "waiting");
    const p4 = await peer(doubles, "Four");
    await until(() => doubles.state.players.size === 4);
    assert.equal(doubles.state.maxPlayers, 4); assert.equal(doubles.state.botFill, 0);
    p2.send("team", 1); await sleep(150);
    assert.equal(doubles.state.players.get(p2.sessionId)?.team, 2, "A team cannot exceed two players");
    for (const r of [doubles, p2, p3, p4]) r.send("ready", true);
    await until(() => [...doubles.state.players.values()].every((p) => p.ready));
    doubles.send("start", {}); await until(() => doubles.state.phase === "live", 10000);
    assert.equal(doubles.state.players.size, 4); assert.ok([...doubles.state.players.values()].every((p) => !p.bot));
    await assert.rejects(client.joinById(doubles.roomId, { name: "Late", char: 0 }), /locked|full/);

    const practice = await create("custom", { bots: 4, maxPlayers: 4, private: true });
    practice.send("ready", true); await until(() => practice.state.players.get(practice.sessionId)?.ready === true);
    practice.send("start", {}); await until(() => practice.state.phase === "warmup");
    assert.equal(practice.state.players.size, 4); assert.equal([...practice.state.players.values()].filter((p) => p.bot).length, 3);
    console.log(JSON.stringify({ passed: true, checks: ["shared showoffs", "showoff rate limit", "invalid showoff rejection", "match clears showoffs", "fixed seats", "server-enforced no bots", "ready gating", "host-only start", "queue isolation", "team capacity", "countdown cancellation", "host migration", "2v2 live match", "practice bots"] }));
  } finally { await Promise.all(rooms.map((r) => r.leave().catch(() => {}))); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
