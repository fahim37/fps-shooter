import { Client, type Room } from "@colyseus/sdk";
import type { MatchState } from "../../game/shared/schema";
import type { HitConfirm, SpawnEvent } from "../../game/shared/messages";
import assert from "node:assert/strict";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error("Timed out waiting for replicated state"); await sleep(50); }
}

async function main() {
  const client = new Client(process.argv[2] || "ws://localhost:2567");
  const rooms: Room<unknown, MatchState>[] = [];
  try {
    const a = await client.create<MatchState>("match", { name: "NetTest A", char: 0, create: { mode: "ffa", maxPlayers: 2, bots: 0, botSkill: 0, private: true, roomName: "Network verification" } });
    rooms.push(a);
    let spawns = 0;
    a.onMessage<SpawnEvent>("spawn", () => {});
    a.onMessage("*", () => {});
    const b = await client.joinById<MatchState>(a.roomId, { name: "NetTest B", char: 1 });
    rooms.push(b);
    b.onMessage<SpawnEvent>("spawn", () => { spawns++; });
    b.onMessage("*", () => {});
    const hits: HitConfirm[] = [];
    a.onMessage<HitConfirm>("hit", (hit) => hits.push(hit));
    await until(() => a.state?.phase === "live", 12000);
    await sleep(2700); // Spawn grace/protection has elapsed.
    // Place test players above the central plaza, clear of map geometry.
    const pose = (x: number, z: number, yaw: number) => ({ x, y: 8, z, yaw, pitch: 0, vx: 0, vy: 0, vz: 0, flags: 0, weapon: "ar" });
    a.send("pose", pose(0, 0, 0)); b.send("pose", pose(0, -3, Math.PI));
    await until(() => a.state.players.get(b.sessionId)?.z === -3);
    assert.equal(a.state.players.size, 2);
    for (let i = 0; i < 5; i++) {
      a.send("fire", { weapon: "ar", origin: [0, 9.62, 0], dirs: [[0, 0, -1]], viewTime: Date.now() });
      await sleep(130);
    }
    await until(() => a.state.players.get(a.sessionId)?.kills === 1);
    assert.ok(hits.some((h) => h.killed), "Server should confirm lethal damage");
    assert.equal(a.state.players.get(b.sessionId)?.alive, false);
    const before = spawns;
    await until(() => spawns > before && b.state.players.get(b.sessionId)?.alive === true, 6000);
    assert.equal(b.state.players.get(b.sessionId)?.hp, 100);
    console.log(JSON.stringify({ passed: true, players: 2, hitConfirmations: hits.length, checks: ["join by code", "replicated poses", "authoritative hits", "kill score", "death", "respawn"] }));
  } finally { await Promise.all(rooms.map((r) => r.leave())); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
