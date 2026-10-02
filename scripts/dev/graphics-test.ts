import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { Client } from "@colyseus/sdk";
import type { Game } from "../../game/client/core/game";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const samples: { quality: string; dpr: number; ammo: string }[] = [];
  const fixture = await new Client(process.argv[3] || "ws://localhost:2567").create("match", {
    name: "Graphics fixture", create: { mode: "tdm", maxPlayers: 2, bots: 0, private: true, roomName: "Graphics verification" },
  });
  fixture.onMessage("*", () => {});
  try {
    await page.addInitScript(() => localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false })));
    await page.goto(`${process.argv[2] || "http://localhost:3000"}/?room=${fixture.roomId}`);
    await page.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60000 });
    await page.getByRole("button", { name: /JOIN ROOM/ }).click();
    await page.getByRole("button", { name: "ENTER MATCH" }).waitFor({ timeout: 90000 });
    await page.getByRole("button", { name: "ENTER MATCH" }).click();
    await page.waitForFunction(() => !!document.pointerLockElement, { timeout: 10000 });
    await page.waitForTimeout(9000);
    const match = await page.locator(".match-mode small").innerText();
    const code = match.split(/\s/)[0];
    await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
    await page.waitForTimeout(800);
    const ammo = await page.locator(".ammo strong").innerText();
    assert.ok(parseInt(ammo) < 30, "Test must change ammunition before switching quality");

    await page.keyboard.down("KeyD");
    const movement = await page.locator(".hud-layer").evaluate(async (element) => {
      type Fiber = { memoizedProps?: { game?: Game }; return?: Fiber };
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
      let fiber = (element as unknown as Record<string, Fiber>)[key];
      while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return!;
      const game = fiber.memoizedProps!.game!;
      const start = game.local!.eye.clone();
      let maxCameraError = 0, maxPhysicsGap = 0;
      for (let frame = 0; frame < 30; frame++) {
        await new Promise(requestAnimationFrame);
        maxCameraError = Math.max(maxCameraError, game.camera.position.distanceTo(game.local!.viewEye));
        maxPhysicsGap = Math.max(maxPhysicsGap, game.local!.eye.distanceTo(game.local!.viewEye));
      }
      return { distance: start.distanceTo(game.local!.eye), maxCameraError, maxPhysicsGap };
    });
    await page.keyboard.up("KeyD");
    assert.ok(movement.distance > 0.1, "Movement must change the actual physical position");
    assert.ok(movement.maxCameraError < 0.001, "Camera and viewmodel must share the interpolated eye");
    assert.ok(movement.maxPhysicsGap < 0.1, "Rendering must stay within one small physics step of the player");

    for (const [quality, dpr] of [["medium", 1], ["high", 1.25], ["ultra", 2], ["low", 0.8]] as const) {
      await page.keyboard.press("F6");
      await page.waitForFunction((wanted) => {
        const canvas = document.querySelector("canvas");
        const select = document.getElementById("match-graphics-quality") as HTMLSelectElement | null;
        return canvas && select?.value === wanted.quality && Math.abs(canvas.width / canvas.clientWidth - wanted.dpr) < 0.02;
      }, { quality, dpr }, { timeout: 45000 });
      await page.waitForTimeout(1600);
      assert.ok(await page.evaluate(() => !!document.pointerLockElement), "Quality changes must preserve pointer lock");
      assert.equal((await page.locator(".match-mode small").innerText()).split(/\s/)[0], code, "Quality changes must keep the same room");
      assert.equal(await page.locator(".ammo strong").innerText(), ammo, "Quality changes must preserve local weapon state");
      assert.equal(await page.getByRole("button", { name: "ENTER MATCH" }).count(), 0, "Quality changes must keep the running match mounted");
      const actualDpr = await page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width / canvas.clientWidth);
      samples.push({ quality, dpr: actualDpr, ammo });
      if (quality === "low" || quality === "high") await page.screenshot({ path: `.next/graphics-${quality}.png` });
    }

    await page.evaluate(() => document.exitPointerLock());
    await page.getByRole("button", { name: "ENTER MATCH" }).waitFor();
    await page.getByLabel("In-match graphics quality", { exact: true }).selectOption("medium");
    await page.getByLabel("Adaptive resolution", { exact: true }).check();
    await page.locator(".settings-details summary").click();
    const clearView = page.getByLabel("Clearer combat view", { exact: true });
    assert.ok(await clearView.isChecked(), "Clear view should be enabled by default");
    await clearView.uncheck();
    await page.getByRole("button", { name: "ENTER MATCH" }).click();
    await page.locator(".crosshair").waitFor();
    await page.mouse.down({ button: "right" });
    await page.locator(".ads-vignette").waitFor();
    await page.mouse.up({ button: "right" });
    await page.evaluate(() => document.exitPointerLock());
    await page.getByRole("button", { name: "ENTER MATCH" }).waitFor();
    await page.locator(".settings-details summary").click();
    await clearView.check();
    await page.getByRole("button", { name: "ENTER MATCH" }).click();
    await page.locator(".crosshair").waitFor();
    await page.mouse.down({ button: "right" });
    await page.locator(".crosshair.aiming").waitFor();
    assert.equal(await page.locator(".ads-vignette").count(), 0, "Clear view keeps aiming edges visible");
    await page.screenshot({ path: ".next/graphics-clear-view.png" });
    await page.mouse.up({ button: "right" });
    await page.evaluate(() => document.exitPointerLock());
    await page.getByRole("button", { name: "ENTER MATCH" }).waitFor();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("hollowmere.settings.v1") || "{}"));
    assert.equal(stored.quality, "medium");
    assert.equal(stored.adaptiveResolution, true);
    assert.equal(stored.clearView, true);
    await page.getByRole("button", { name: "RETURN TO LOBBY" }).click();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, samples, movement, checks: ["interpolated camera", "live F6 quality", "render resolution", "pointer lock", "same room", "preserved ammunition", "paused select", "clear view toggle", "saved settings"], errors }));
  } catch (error) {
    console.error("Browser errors:", errors);
    console.error("Visible UI:", await page.locator("body").innerText().catch(() => "unavailable"));
    await page.screenshot({ path: ".next/graphics-test-failure.png" }).catch(() => {});
    throw error;
  } finally { await fixture.leave(); await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
