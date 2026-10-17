import { chromium } from "playwright-core";
import { Client, type Room } from "@colyseus/sdk";
import type { MatchState } from "../../game/shared/schema";
import type { Game } from "../../game/client/core/game";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 12000) {
  const started = Date.now();
  while (!check()) { if (Date.now() - started > timeout) throw new Error("Room state timed out"); await sleep(40); }
}

async function main() {
  const base = process.argv[2] || "http://localhost:3100";
  const client = new Client(process.argv[3] || "ws://localhost:2567");
  const rooms: Room<unknown, MatchState>[] = [];
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  try {
    const host = await client.create<MatchState>("match", { name: "Host", char: 0, queue: "rooms", create: { mode: "tdm", format: "custom", lobby: true, maxPlayers: 6, bots: 0, private: false, roomName: `Late join QA ${Date.now()}` } });
    rooms.push(host); host.onMessage("*", () => {});
    const peer = await client.joinById<MatchState>(host.roomId, { name: "Peer", char: 0, team: 2 });
    rooms.push(peer); peer.onMessage("*", () => {});
    await until(() => host.state?.players?.size === 2);
    host.send("ready", true); peer.send("ready", true);
    await until(() => [...host.state.players.values()].every((p) => p.ready));
    host.send("start", {}); await until(() => host.state.phase === "live");
    await page.addInitScript(() => localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false })));
    await page.goto(`${base}/?room=${host.roomId}`);
    await page.getByRole("combobox", { name: "Join team", exact: true }).selectOption("2");
    await page.getByRole("button", { name: /JOIN (THIS )?ROOM/ }).click();
    await page.getByRole("button", { name: /^ENTER MATCH/ }).waitFor({ timeout: 90000 });
    await until(() => [...host.state.players.values()].some((p) => p.name === "Ranger" && p.team === 2 && p.alive));
    await page.getByRole("button", { name: "RETURN TO LOBBY" }).click();
    await page.getByRole("combobox", { name: "Join team", exact: true }).selectOption("1");
    await page.getByRole("button", { name: /Refresh/ }).click();
    const row = page.locator(".room-row").filter({ hasText: host.state.roomName });
    await row.waitFor(); assert.match(await row.innerText(), /In progress/); assert.equal(await row.isEnabled(), true);
    await row.click();
    await page.getByRole("button", { name: /^ENTER MATCH/ }).waitFor({ timeout: 90000 });
    await until(() => [...host.state.players.values()].some((p) => p.name === "Ranger" && p.team === 1 && p.alive));
    await page.getByRole("button", { name: /^ENTER MATCH/ }).click();
    const health = page.getByRole("progressbar", { name: "Health", exact: true });
    await health.waitFor(); assert.equal(await health.getAttribute("aria-valuenow"), "100");
    await sleep(3500);
    // An authoritative fall-damage message exercises the same health path as combat.
    async function damage(land: number) {
      await page.locator(".hud-layer").evaluate((element, land) => {
        type Fiber = { memoizedProps?: { game?: Game }; return?: Fiber };
        const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
        let fiber = (element as unknown as Record<string, Fiber>)[key];
        while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return!;
        const game = fiber.memoizedProps!.game!, local = game.local!;
        game.room.send("pose", { x: local.ms.x, y: local.ms.y, z: local.ms.z, yaw: local.yaw, pitch: local.pitch, vx: 0, vy: 0, vz: 0, flags: 0, weapon: "ar", land });
      }, land);
    }
    await damage(20);
    await page.waitForFunction(() => document.querySelector('[role="progressbar"][aria-label="Health"]')?.getAttribute("aria-valuenow") === "23");
    await sleep(250);
    await mkdir("out/qa", { recursive: true });
    await page.screenshot({ path: "out/qa/health-critical-desktop.png" });
    await sleep(2200); await damage(13.2);
    await page.waitForFunction(() => document.querySelector('[role="progressbar"][aria-label="Health"]')?.getAttribute("aria-valuenow") === "21");
    await sleep(3000); assert.equal(await health.getAttribute("aria-valuenow"), "21", "A second hit restarts regeneration delay");
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('[data-health-state="healing"]').waitFor({ timeout: 5000 });
    await page.screenshot({ path: "out/qa/health-healing-mobile.png" });
    const bounds = await health.boundingBox();
    assert.ok(bounds && bounds.y > 220 && bounds.x > 0 && bounds.x + bounds.width < 844 && bounds.y + bounds.height < 390);
    await page.waitForFunction(() => document.querySelector('[role="progressbar"][aria-label="Health"]')?.getAttribute("aria-valuenow") === "100", undefined, { timeout: 7000 });
    assert.equal(await page.locator('[data-health-state="healing"]').count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["invite late join on Green", "public in-progress join on Blue", "protected alive spawn", "visible bottom health bar", "critical health color", "damage restarts five-second delay", "server regeneration to 100", "mobile healing layout"], errors }));
  } catch (error) {
    console.error(errors); console.error((await page.locator("body").innerText()).slice(0, 1800));
    await page.screenshot({ path: "out/qa/late-join-health-failure.png" }).catch(() => {}); throw error;
  } finally { await browser.close(); await Promise.all(rooms.map((r) => r.leave().catch(() => {}))); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
