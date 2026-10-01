import { chromium } from "playwright-core";
import { Client, type Room } from "@colyseus/sdk";
import type { MatchState } from "../../game/shared/schema";
import type { ShotEvent } from "../../game/shared/messages";
import type { Game } from "../../game/client/core/game";
import assert from "node:assert/strict";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 15000) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error("Combat state timed out"); await sleep(100); }
}

/** Real browser + authoritative peer: enemy color, ADS scope, blood and hit confirmation. */
async function main() {
  const base = process.argv[2] || "http://localhost:3100";
  const client = new Client(process.argv[3] || "ws://localhost:2567");
  let room: Room<unknown, MatchState> | null = null;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  try {
    room = await client.create<MatchState>("match", { name: "Combat Target", char: 0, create: { mode: "tdm", maxPlayers: 2, bots: 0, private: true, roomName: "Aim verification" } });
    const shots: ShotEvent[] = [];
    room.onMessage("*", () => {});
    room.onMessage<ShotEvent>("shot", (ev) => shots.push(ev));
    await page.addInitScript(() => localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false })));
    await page.goto(`${base}/?room=${room.roomId}`);
    await page.getByRole("button", { name: /JOIN THIS ROOM/ }).click();
    await page.getByRole("button", { name: "ENTER MATCH" }).waitFor({ timeout: 90000 });
    await page.getByLabel("NEXT SPAWN LOADOUT").selectOption("sniper");
    await until(() => room!.state.phase === "live" && [...room!.state.players.values()].some((p) => p.primary === "sniper"));
    await page.getByRole("button", { name: "ENTER MATCH" }).click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    await sleep(3000);
    // A remote asset load can finish after the initial spawn. Loadout selection
    // applies on the next spawn, so use a real elimination when necessary.
    {
      const victim = [...room.state.players.entries()].find(([id]) => id !== room!.sessionId)!;
      if (victim[1].weapon !== "sniper") {
        const { x, y, z } = victim[1];
        room.send("pose", { x, y, z: z - 2, yaw: Math.PI, pitch: 0, vx: 0, vy: 0, vz: 0, flags: 0, weapon: "ar" });
        await sleep(500);
        for (let shot = 1; shot <= 6 && room.state.players.get(victim[0])?.alive; shot++) {
          room.send("fire", { weapon: "ar", shot, origin: [x, y + 1.64, z - 2], dirs: [[0, 0, 1]], viewTime: room.state.serverTime });
          await sleep(180);
        }
        await until(() => room!.state.players.get(victim[0])?.weapon === "sniper" && room!.state.players.get(victim[0])?.alive === true);
        await sleep(3000);
      }
    }
    // Keep the fixture level after pointer-lock/death camera transitions.
    console.log(await page.locator(".hud-layer").evaluate((element) => {
      type Fiber = { memoizedProps?: { game?: Game }; return?: Fiber };
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
      let fiber = (element as unknown as Record<string, Fiber>)[key];
      while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return!;
      const game = fiber.memoizedProps!.game!;
      game.input.consumeLook();
      game.local!.pitch = 0;
      game.local!.updateView();
      return { alive: game.local!.alive, pitch: game.local!.pitch, yaw: game.local!.yaw, weapon: game.local!.weapon };
    }));
    await sleep(300);
    const player = [...room.state.players.entries()].find(([id]) => id !== room!.sessionId)![1];
    const forwardX = -Math.sin(player.yaw), forwardZ = -Math.cos(player.yaw);
    const position = { x: player.x + forwardX * 2, y: player.y, z: player.z + forwardZ * 2 };
    const pose = (offset: number) => room!.send("pose", { ...position, x: position.x + Math.cos(player.yaw) * offset, z: position.z - Math.sin(player.yaw) * offset, yaw: player.yaw + Math.PI, pitch: 0, vx: 0, vy: 0, vz: 0, flags: 8, weapon: "ar" });
    pose(0);
    await page.locator(".crosshair.enemy-sighted").waitFor({ timeout: 10000 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".crosshair")!).color === "rgb(255, 69, 69)");
    const color = await page.locator(".crosshair").evaluate((el) => getComputedStyle(el).color);
    assert.equal(color, "rgb(255, 69, 69)");
    await page.screenshot({ path: ".next/combat-enemy.png" });
    await sleep(350);
    pose(2);
    await page.waitForFunction(() => !document.querySelector(".crosshair.enemy-sighted"));
    await sleep(350);
    pose(0);
    await page.locator(".crosshair.enemy-sighted").waitFor();
    await page.mouse.down({ button: "right" });
    await page.locator(".scope.enemy-sighted").waitFor();
    await sleep(450);
    assert.match(await page.locator(".scope-label").innerText(), /OPTIC/);
    await page.screenshot({ path: ".next/combat-scope.png" });
    await page.mouse.down({ button: "left" });
    await sleep(100);
    await page.mouse.up({ button: "left" });
    await page.locator(".hit-confirm").waitFor();
    const confirmation = await page.locator(".hit-confirm").innerText();
    assert.match(confirmation, /ELIMINATED/);
    await page.screenshot({ path: ".next/combat-hit.png" });
    await until(() => shots.some((shot) => shot.hits?.includes("head")));
    assert.equal(room.state.players.get(room.sessionId)?.alive, false);
    await page.mouse.up({ button: "right" });
    await page.waitForFunction(() => !document.querySelector(".scope"));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["enemy crosshair turns red", "target clears off ray", "sniper ADS reticle", "authoritative headshot and blood event", "scope releases"], errors }));
  } catch (error) {
    console.error("Browser errors:", errors);
    await page.screenshot({ path: ".next/combat-test-failure.png" }).catch(() => {});
    throw error;
  } finally { await browser.close(); await room?.leave(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
