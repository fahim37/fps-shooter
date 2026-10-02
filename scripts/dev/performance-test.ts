import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { Client } from "@colyseus/sdk";
import type { RootState } from "@react-three/fiber";
import type { Game } from "../../game/client/core/game";

/** Full private bot match: frame pacing, CPU update cost, draw calls and resource counts. */
async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const fixture = await new Client(process.argv[3] || "ws://localhost:2567").create("match", {
    name: "Performance fixture", create: { mode: "tdm", maxPlayers: 12, bots: 12, private: true, roomName: "Performance verification" },
  });
  fixture.onMessage("*", () => {});
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false })));
    await page.addInitScript("window.__name = (value) => value;");
    await page.goto(`${(process.argv[2] || "http://localhost:3000").replace(/\/$/, "")}/?room=${fixture.roomId}`);
    await page.getByRole("button", { name: /JOIN ROOM/ }).click();
    await page.getByRole("button", { name: "ENTER MATCH" }).click({ timeout: 90000 });
    await page.waitForFunction(() => !!document.pointerLockElement);
    await page.waitForTimeout(10000);
    const samples = [];
    for (const quality of ["low", "medium", "high"] as const) {
      if (quality !== "low") await page.keyboard.press("F6");
      await page.waitForTimeout(4000);
      const metrics = await page.locator(".hud-layer").evaluate(async (element) => {
        type Fiber = { memoizedProps?: { game?: Game }; return?: Fiber };
        const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
        let fiber = (element as unknown as Record<string, Fiber>)[key];
        while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return!;
        const game = fiber.memoizedProps!.game!;
        const root = (game.scene as typeof game.scene & { __r3f: { root: { getState(): RootState } } }).__r3f.root;
        const gl = root.getState().gl;
        const ctx = gl.getContext();
        const debug = ctx.getExtension("WEBGL_debug_renderer_info");
        const renderer = debug ? ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string : "unavailable";
        const originalUpdate = game.update;
        const originalAutoReset = gl.info.autoReset;
        const cpuMs: number[] = [], frameMs: number[] = [], calls: number[] = [], triangles: number[] = [];
        game.update = function (...args) {
          const start = performance.now();
          originalUpdate.apply(this, args);
          cpuMs.push(performance.now() - start);
        };
        gl.info.autoReset = false;
        gl.info.reset();
        let previous = performance.now();
        const deadline = previous + 8000;
        try {
          while (performance.now() < deadline) {
            await new Promise(requestAnimationFrame);
            const now = performance.now();
            frameMs.push(now - previous); previous = now;
            calls.push(gl.info.render.calls); triangles.push(gl.info.render.triangles);
            gl.info.reset();
          }
        } finally { game.update = originalUpdate; gl.info.autoReset = originalAutoReset; }
        const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
        let objects = 0, meshes = 0;
        game.scene.traverse((object) => { objects++; if ((object as unknown as { isMesh?: boolean }).isMesh) meshes++; });
        return { renderer, players: game.room.state.players.size, frames: frameMs.length, medianFrameMs: percentile(frameMs, 0.5), p95FrameMs: percentile(frameMs, 0.95),
          medianUpdateMs: percentile(cpuMs, 0.5), p95UpdateMs: percentile(cpuMs, 0.95), medianDrawCalls: percentile(calls, 0.5), medianTriangles: percentile(triangles, 0.5),
          geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length, dpr: gl.getPixelRatio(), objects, meshes };
      });
      samples.push({ quality, ...metrics });
      console.log(JSON.stringify(samples.at(-1)));
    }
    assert.deepEqual(errors, []);
    mkdirSync("out/qa", { recursive: true });
    writeFileSync("out/qa/performance.json", JSON.stringify({ samples, errors }, null, 2));
  } finally { await fixture.leave(); await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
