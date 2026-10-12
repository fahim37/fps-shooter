import { chromium } from "playwright-core";
import { Client } from "@colyseus/sdk";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import ts from "typescript";

async function main() {
  const base = process.argv[2] || "http://localhost:3100";
  const client = new Client(process.argv[3] || "ws://localhost:2567");
  const host = await client.create("match", { name: "Presentation QA", create: { map: "downtown", mode: "tdm", maxPlayers: 4, bots: 0, private: true } });
  host.onMessage("*", () => {});
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await mkdir("out/qa", { recursive: true });
    await page.addInitScript(() => {
      localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false }));
      localStorage.setItem("hollowmere.optics.v1", JSON.stringify({ ar: "4x" }));
    });
    await page.goto(base);
    assert.equal(await page.title(), "Hollowmere — Village & City Combat");
    await page.locator(".wordmark img").waitFor();
    await page.screenshot({ path: "out/qa/brand-desktop.png" });
    await page.setViewportSize({ width: 320, height: 800 });
    const brand = await page.locator(".wordmark").boundingBox();
    const status = await page.locator(".lobby-top .status").boundingBox();
    assert.ok(brand && status && brand.x + brand.width <= status.x && status.x + status.width <= 320, "Brand and server status must fit mobile");
    await page.screenshot({ path: "out/qa/brand-mobile.png" });
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const link of await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href))) {
      assert.equal((await page.request.get(link)).status(), 200);
    }
    await page.goto(`${base}/?room=${host.roomId}`);
    await page.getByRole("button", { name: /JOIN (THIS )?ROOM/ }).click();
    await page.getByRole("button", { name: /^ENTER MATCH/ }).waitFor({ timeout: 90000 });
    await page.getByRole("button", { name: /^ENTER MATCH/ }).click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    // Let the warmup respawn finish before checking ADS presentation.
    await page.waitForTimeout(9000);
    // Expose the running game only in this QA page, using React's existing game prop.
    await page.locator(".hud-layer").evaluate((element) => {
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let fiber = (element as any)[key];
      while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__presentationGame = fiber.memoizedProps.game;
    });
    await page.mouse.down({ button: "right" });
    const chevron = page.locator('[data-reticle="4x-chevron"]');
    await chevron.waitFor();
    await page.waitForTimeout(700);
    const box = await chevron.boundingBox();
    assert.ok(box && box.width < 22 && box.height < 17, "4x marker must leave the target clear");
    await page.screenshot({ path: "out/qa/scope-small-chevron.png" });
    await page.mouse.up({ button: "right" });
    await page.keyboard.press("KeyB");
    await page.getByRole("button", { name: "Attach Red dot to AK Rifle" }).click();
    await page.getByRole("button", { name: "Close loadout" }).click();
    await page.waitForFunction(() => {
      // Wait for the game's input loop as well as the browser's pointer lock.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return !!document.pointerLockElement && (window as any).__presentationGame.input.enabled;
    });
    await page.waitForTimeout(150);
    await page.mouse.down({ button: "right" });
    await page.getByLabel("Red dot sight", { exact: true }).waitFor();
    await page.waitForTimeout(700);
    assert.equal(await page.locator(".red-dot-sight svg").count(), 0, "Sight housing must be on the 3D gun");
    await page.screenshot({ path: "out/qa/red-dot-mounted.png" });
    const mounted = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).__presentationGame;
      const sight = g.fpp.object.getObjectByName("rail-mounted-red-dot");
      return { visible: sight.visible, parent: !!sight.parent, parts: sight.children.length };
    });
    assert.ok(mounted.visible && mounted.parent && mounted.parts >= 6);
    await page.mouse.up({ button: "right" });
    // Isolate local collision/input from server correction after a test-only teleport.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).__presentationGame;
      g.local.sendPose = () => {};
      g.local.correct(29.3, 0.21, 38); g.local.yaw = -Math.PI / 2; g.local.pitch = 0;
    });
    await page.waitForTimeout(250);
    await page.keyboard.down("KeyW");
    await page.waitForFunction(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__presentationGame.local.ms;
      return s.y > 3.1 && s.x > 36.4;
    }, undefined, { timeout: 15000 });
    await page.keyboard.up("KeyW");
    await page.screenshot({ path: "out/qa/stairs-rooftop.png" });
    assert.deepEqual(errors, []);

    // Render the real procedural cue through the browser's Web Audio implementation.
    const source = await readFile("game/client/core/audio.ts", "utf8");
    await page.addScriptTag({ content: "window.__name = (value) => value;\n" + ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText.replace(/export /g, "") + "\nwindow.QAAudioEngine = AudioEngine;" });
    const audio = await page.evaluate(async () => {
      const render = async (head: boolean, volume: number) => {
        const ctx = new OfflineAudioContext(1, 24000, 48000);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const engine = new (window as any).QAAudioEngine();
        const master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
        const noise = ctx.createBuffer(1, 96000, 48000);
        const values = noise.getChannelData(0);
        for (let i = 0; i < values.length; i++) values[i] = Math.random() * 2 - 1;
        Object.assign(engine, { ctx, master, sfx: master, noise });
        engine.elimination(head);
        const data = (await ctx.startRendering()).getChannelData(0);
        return { peak: Math.max(...data.map(Math.abs)), tail: Math.max(...data.slice(18000).map(Math.abs)), finite: data.every(Number.isFinite) };
      };
      return { body: await render(false, 0.8), head: await render(true, 0.8), muted: await render(false, 0) };
    });
    for (const cue of [audio.body, audio.head]) assert.ok(cue.finite && cue.peak > 0.05 && cue.peak < 0.5 && cue.tail === 0);
    assert.equal(audio.muted.peak, 0);
    console.log(JSON.stringify({ passed: true, checks: ["title and brand", "favicon and touch icon", "small 4x chevron", "3D rail-mounted reflex", "keyboard stair ascent", "body/headshot audio renders without clipping", "volume mute"], mounted, chevron: box, audio, errors }));
  } catch (error) {
    await page.screenshot({ path: "out/qa/presentation-failure.png" });
    console.error((await page.locator("body").innerText()).slice(0, 1400));
    throw error;
  } finally { await browser.close(); await host.leave(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
