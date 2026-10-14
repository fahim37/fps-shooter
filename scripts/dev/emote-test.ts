// In-match emotes (T, then a number) and the C grenade, in a real browser against a live server.
// A second player watches through the replicated state to confirm others see the emote.
// Usage: npx tsx scripts/dev/emote-test.ts [webBase] [gameServer]
import { chromium } from "playwright-core";
import { Client } from "@colyseus/sdk";
import type { MatchState } from "../../game/shared/schema";
import assert from "node:assert/strict";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!check()) { if (Date.now() > end) throw new Error(`Timed out: ${label}`); await sleep(50); }
}

async function main() {
  const base = process.argv[2] || "http://localhost:3100";
  const client = new Client(process.argv[3] || "ws://localhost:2567");
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const watcher = await client.create<MatchState>("match", { name: "Watcher", char: 1,
    create: { mode: "tdm", maxPlayers: 4, bots: 0, private: true, roomName: "Emote verification" } });
  watcher.onMessage("*", () => {});
  /** The browser player's emote as every other client sees it. */
  const seen = () => [...watcher.state.players.entries()].find(([id]) => id !== watcher.sessionId)?.[1].emote;
  try {
    await page.goto(`${base}/?room=${watcher.roomId}`);
    await page.getByRole("button", { name: /JOIN (THIS )?ROOM/ }).click();
    await page.getByRole("button", { name: /^ENTER MATCH/ }).waitFor({ timeout: 90000 });
    await page.getByRole("button", { name: /^ENTER MATCH/ }).click();
    await page.waitForFunction(() => !!document.pointerLockElement, { timeout: 10000 });
    await sleep(9000); // Let warmup respawn finish.

    const menu = page.getByRole("menu", { name: "Emotes" });
    const hint = page.getByRole("status").filter({ hasText: "MOVE OR SHOOT TO STOP" });
    await page.keyboard.press("KeyT");
    await menu.waitFor({ timeout: 2000 });
    await page.screenshot({ path: ".next/emote-menu.png" });
    await page.keyboard.press("Digit1");
    await hint.waitFor({ timeout: 2000 });
    assert.equal(await menu.count(), 0, "Picking an emote closes the menu");
    assert.match(await hint.innerText(), /DANCE/);
    await until(() => seen() === "dance", "other players see the dance");
    await sleep(1200);
    await page.screenshot({ path: ".next/emote-dance.png" });

    // Moving ends it for everyone.
    await page.keyboard.down("KeyW"); await sleep(300); await page.keyboard.up("KeyW");
    await hint.waitFor({ state: "detached", timeout: 2000 });
    await until(() => seen() === "idle", "the dance ends for other players");

    // T twice closes the menu without emoting; numbers switch weapons again.
    await page.keyboard.press("KeyT"); await menu.waitFor({ timeout: 2000 });
    await page.keyboard.press("KeyT"); await menu.waitFor({ state: "detached", timeout: 2000 });
    await page.keyboard.press("Digit2"); await sleep(650);
    assert.match(await page.locator(".ammo").innerText(), /Sidearm/i);

    // The click that ends an emote brings the gun up instead of firing it.
    await page.keyboard.press("KeyT"); await page.keyboard.press("Digit3");
    await hint.waitFor({ timeout: 2000 });
    await until(() => seen() === "magic", "other players see the spell stance");
    const ammo = page.locator(".ammo strong");
    const before = parseInt(await ammo.innerText());
    await page.mouse.down(); await sleep(60); await page.mouse.up();
    await hint.waitFor({ state: "detached", timeout: 2000 });
    assert.equal(parseInt(await ammo.innerText()), before, "The click that ends an emote does not fire");

    // C throws a grenade and no longer crouches.
    await page.keyboard.down("KeyC"); await sleep(400); await page.keyboard.up("KeyC");
    await sleep(350);
    assert.match(await page.locator(".ammo").innerText(), /1 GRENADES/);

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["T opens the menu", "1 dances", "others see it", "moving ends it for everyone", "T closes", "digits switch weapons again", "click ends without firing", "C throws a grenade"] }));
  } catch (error) {
    console.error("Browser errors:", errors);
    await page.screenshot({ path: ".next/emote-test-failure.png" }).catch(() => {});
    throw error;
  } finally {
    await watcher.leave().catch(() => {});
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
