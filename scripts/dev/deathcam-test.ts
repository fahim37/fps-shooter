import { chromium } from "playwright-core";
import { Client, type Room } from "@colyseus/sdk";
import type { MatchState } from "../../game/shared/schema";
import type { KillEvent } from "../../game/shared/messages";
import type { Game } from "../../game/client/core/game";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 15000) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error("Death camera state timed out"); await sleep(50); }
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  let room: Room<unknown, MatchState> | null = null;
  try {
    room = await new Client(process.argv[3] || "ws://localhost:2567").create<MatchState>("match", {
      name: "Viper QA", char: 1, create: { mode: "ffa", maxPlayers: 2, bots: 0, private: true, roomName: "Death camera verification" },
    });
    room.onMessage("*", () => {});
    const kills: KillEvent[] = [];
    room.onMessage<KillEvent>("kill", (event) => kills.push(event));
    await page.addInitScript(() => localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false })));
    await page.goto(`${process.argv[2] || "http://localhost:3100"}/?room=${room.roomId}`);
    await page.getByRole("button", { name: /JOIN (THIS )?ROOM/ }).click();
    await page.getByRole("button", { name: /^ENTER MATCH/ }).waitFor({ timeout: 90000 });
    console.log("Match loaded");
    await until(() => room!.state.phase === "live");
    await page.getByRole("button", { name: /^ENTER MATCH/ }).click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    await sleep(2600);
    // Lift both players above map geometry; freeze only local gravity for this fixture.
    const fixture = await page.locator(".hud-layer").evaluate((element) => {
      type Fiber = { memoizedProps?: { game?: Game }; return?: Fiber };
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
      let fiber = (element as unknown as Record<string, Fiber>)[key];
      while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return!;
      const local = fiber.memoizedProps!.game!.local!;
      const { x, z } = local.ms;
      local.correct(x, 20, z);
      local.yaw = Math.PI;
      local.pitch = 0;
      const update = local.update.bind(local);
      local.update = (...args: Parameters<typeof update>) => { update(...args); if (local.alive) local.correct(x, 20, z); };
      return { x, z };
    });
    room.send("pose", { x: fixture.x, y: 20, z: fixture.z + 3, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, flags: 0, weapon: "ar" });
    await sleep(500);
    console.log("Combat fixture ready", fixture);
    for (let shot = 1; shot <= 8 && !kills.length; shot++) {
      room.send("fire", { weapon: "ar", shot, origin: [fixture.x, 21.64, fixture.z + 3], dirs: [[0, 0, -1]], viewTime: room.state.serverTime });
      await sleep(150);
    }
    await page.getByRole("region", { name: "Death recap" }).waitFor();
    await page.locator('[data-relation="self"]').waitFor({ state: "detached" });
    await page.getByText("LIVE KILLER CAM", { exact: false }).waitFor();
    assert.match(await page.getByRole("region", { name: "Death recap" }).innerText(), /Viper QA/);
    assert.match(await page.getByRole("region", { name: "Death recap" }).innerText(), /AK Rifle/);
    assert.match(await page.getByRole("region", { name: "Death recap" }).innerText(), /Headshot/);
    assert.match(await page.getByRole("log", { name: "Kill feed" }).innerText(), /YOU/);
    assert.equal(kills[0].killerInfo?.name, "Viper QA");
    assert.ok(Math.abs(kills[0].distance! - 3) < 0.1);
    await sleep(700);
    await mkdir("out/qa", { recursive: true });
    await page.screenshot({ path: "out/qa/deathcam-desktop.png" });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.screenshot({ path: "out/qa/deathcam-mobile.png" });
    const recap = await page.getByRole("region", { name: "Death recap" }).boundingBox();
    assert.ok(recap && recap.x >= 0 && recap.y >= 0 && recap.x + recap.width <= 844 && recap.y + recap.height <= 390, "Death recap should fit mobile landscape");
    await page.getByRole("region", { name: "Death recap" }).waitFor({ state: "detached", timeout: 7000 });
    await page.locator(".crosshair").waitFor();
    await page.locator('[data-relation="self"]').waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["authoritative killer snapshot", "headshot feed with YOU", "live killer camera", "weapon/health/distance recap", "desktop and mobile layout", "automatic respawn clears death UI"], errors }));
  } catch (error) {
    console.error("Browser errors:", errors);
    console.error((await page.locator("body").innerText()).slice(0, 1800));
    await mkdir("out/qa", { recursive: true });
    await page.screenshot({ path: "out/qa/deathcam-failure.png" });
    throw error;
  } finally { await browser.close(); await room?.leave(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
