import { chromium } from "playwright-core";
import { Client, type Room } from "@colyseus/sdk";
import type { MatchState } from "../../game/shared/schema";
import type { Game } from "../../game/client/core/game";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const base = process.argv[2] || "http://localhost:3100";
  const client = new Client(process.argv[3] || "ws://localhost:2567");
  const peers: Room<unknown, MatchState>[] = [];
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  try {
    const enemy = await client.create<MatchState>("match", { name: "Enemy Scout", char: 1,
      create: { mode: "tdm", maxPlayers: 4, bots: 0, private: true, roomName: "Radar verification" } });
    enemy.onMessage("*", () => {}); peers.push(enemy);
    await page.addInitScript(() => localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false })));
    await page.goto(`${base}/?room=${enemy.roomId}`);
    await page.getByRole("button", { name: /JOIN (THIS )?ROOM/ }).click();
    await page.getByRole("button", { name: /^ENTER MATCH/ }).waitFor({ timeout: 90000 });
    for (const name of ["Enemy Two", "Ally Scout"]) {
      const peer = await client.joinById<MatchState>(enemy.roomId, { name, char: 0 });
      peer.onMessage("*", () => {}); peers.push(peer);
    }
    await page.getByRole("button", { name: /^ENTER MATCH/ }).click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    const map = page.getByRole("region", { name: "Minimap", exact: true });
    await map.locator('[data-relation="self"]').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-relation="enemy"]').length === 2 && document.querySelectorAll('[data-relation="ally"]').length === 1);
    await sleep(9000);
    const local = await page.locator(".hud-layer").evaluate((element) => {
      type Fiber = { memoizedProps?: { game?: Game }; return?: Fiber };
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
      let fiber = (element as unknown as Record<string, Fiber>)[key];
      while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return!;
      const game = fiber.memoizedProps!.game!;
      return { id: game.room.sessionId, x: game.local!.ms.x, y: game.local!.ms.y, z: game.local!.ms.z, yaw: game.local!.yaw };
    });
    const marker = map.locator(`[data-player-id="${enemy.sessionId}"]`);
    const before = await marker.getAttribute("transform");
    // The idle peer has ample movement allowance; put it on the player's clear spawn lane.
    const pose = { x: local.x - Math.sin(local.yaw) * 3, y: local.y, z: local.z - Math.cos(local.yaw) * 3,
      yaw: local.yaw + Math.PI, pitch: 0, vx: 0, vy: 0, vz: 0, flags: 8, weapon: "ar" };
    enemy.send("pose", pose);
    await page.waitForFunction(({ id, old }) => document.querySelector(`[data-player-id="${id}"]`)?.getAttribute("transform") !== old, { id: enemy.sessionId, old: before });
    await sleep(600);
    const materials = await page.locator(".hud-layer").evaluate((element) => {
      type Fiber = { memoizedProps?: { game?: Game }; return?: Fiber };
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
      let fiber = (element as unknown as Record<string, Fiber>)[key];
      while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return!;
      return [...fiber.memoizedProps!.game!.remotes.values()].map((remote) => ({ name: remote.name, materials: remote.rig!.inst.meshes.flatMap((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => ({ name: material.name, key: material.customProgramCacheKey() }))) }));
    });
    assert.ok(materials.find((remote) => remote.name === "Enemy Scout")!.materials.some((material) => material.key.includes("readability-v2")));
    assert.ok(materials.find((remote) => remote.name === "Ally Scout")!.materials.every((material) => !material.key.includes("readability")));
    assert.ok(materials.every((remote) => remote.materials.filter((material) => !/Ranger/i.test(material.name)).every((material) => !material.key.includes("readability"))));
    await mkdir("out/qa", { recursive: true });
    await page.screenshot({ path: "out/qa/minimap-desktop.png" });
    for (const [width, height] of [[844, 390], [640, 360], [568, 320]]) {
      await page.setViewportSize({ width, height });
      const bounds = await map.boundingBox();
      assert.ok(bounds && bounds.x >= width / 2 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height, "Minimap should fit top-right on mobile");
      await page.screenshot({ path: `out/qa/minimap-${width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator(".hud-layer").evaluate((element) => {
      type Fiber = { memoizedProps?: { game?: Game }; return?: Fiber };
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
      let fiber = (element as unknown as Record<string, Fiber>)[key];
      while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return!;
      const game = fiber.memoizedProps!.game!;
      const enemy = [...game.remotes.values()].find((remote) => remote.name === "Enemy Scout")!;
      game.input.consumeLook();
      // Resize can enqueue pointer-lock mouse deltas; maintain fixture aim while firing.
      const local = game.local!;
      const update = local.update.bind(local);
      local.update = (...args: Parameters<typeof update>) => {
        update(...args);
        const dx = enemy.pos.x - local.eye.x, dy = enemy.pos.y + 1.64 - local.eye.y, dz = enemy.pos.z - local.eye.z;
        local.yaw = Math.atan2(-dx, -dz);
        local.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      };
    });
    await page.locator(".crosshair.enemy-sighted").waitFor();
    await page.mouse.down();
    await page.getByRole("status", { name: "You eliminated Enemy Scout", exact: true }).waitFor();
    await page.mouse.up();
    await map.locator(`[data-player-id="${enemy.sessionId}"]`).waitFor({ state: "detached" });
    await page.screenshot({ path: "out/qa/elimination-desktop.png" });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.screenshot({ path: "out/qa/elimination-mobile.png" });
    await page.getByRole("status", { name: "You eliminated Enemy Scout", exact: true }).waitFor({ state: "detached", timeout: 5000 });
    const allyId = peers[2].sessionId;
    await peers[2].leave(); peers.pop();
    await map.locator(`[data-player-id="${allyId}"]`).waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["self/ally/enemy positions", "live remote movement", "death/disconnect clears marker", "clothing-only visibility accent", "natural skin and teammate materials", "desktop and three mobile layouts", "confirmed victim-name banner and expiry"], errors }));
  } catch (error) {
    console.error("Browser errors:", errors);
    console.error((await page.locator("body").innerText()).slice(0, 1800));
    await mkdir("out/qa", { recursive: true });
    await page.screenshot({ path: "out/qa/minimap-failure.png" });
    throw error;
  } finally { await browser.close(); await Promise.all(peers.map((peer) => peer.leave())); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
