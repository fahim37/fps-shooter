import { chromium } from "playwright-core";
import assert from "node:assert/strict";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const url = process.argv[2] || "http://localhost:3000";
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator('[data-stage-status="ready"]').waitFor();
    const canvas = page.getByLabel(/^Animated character preview/);
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const still = await canvas.screenshot();
    await page.waitForTimeout(350);
    assert.ok(still.equals(await canvas.screenshot()), "Reduced motion freezes the rendered pose");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "Dance", exact: true }).click();
    await page.waitForTimeout(400);
    const dancing = await canvas.screenshot();
    await page.waitForTimeout(400);
    assert.ok(!dancing.equals(await canvas.screenshot()), "The real skeleton animates when motion is enabled");
    await page.getByRole("button", { name: "Pause motion", exact: true }).click();
    await page.waitForTimeout(100);
    const paused = await canvas.screenshot();
    await page.waitForTimeout(350);
    assert.ok(paused.equals(await canvas.screenshot()), "Pause motion stops rendering new poses");
    // Dragging turns the ranger around even while paused; double-click faces it forward again.
    // Compared below the stage heading, whose buttons change focus styling.
    const box = (await canvas.boundingBox())!;
    const stage = () => page.screenshot({ clip: { x: box.x, y: box.y + 48, width: box.width, height: box.height - 48 } });
    const front = await stage();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 260, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    assert.ok(!front.equals(await stage()), "Dragging turns the character");
    await page.screenshot({ path: "out/qa/showcase-turned.png" });
    await canvas.dblclick();
    await page.waitForTimeout(150);
    assert.ok(front.equals(await stage()), "Double-click faces the character forward again");
    await page.getByRole("button", { name: "Hide preview", exact: true }).click();
    assert.equal(await page.locator("canvas").count(), 0, "Hiding disposes the renderer");
    await page.getByRole("button", { name: "Show preview", exact: true }).click();
    await page.locator('[data-stage-status="ready"]').waitFor();
    assert.equal(await page.locator("canvas").count(), 1);
    // A fresh context cannot borrow a successful asset request from the first preview.
    const offlineContext = await browser.newContext();
    const offline = await offlineContext.newPage();
    await offline.route("**/models/char_*.glb", (route) => route.abort());
    await offline.goto(url);
    await offline.getByRole("button", { name: "Retry preview", exact: true }).waitFor();
    assert.ok(await offline.getByRole("button", { name: "CREATE 1V1 ROOM" }).isEnabled(), "Preview failures do not block room creation");
    await offline.unroute("**/models/char_*.glb");
    await offline.getByRole("button", { name: "Retry preview", exact: true }).click();
    await offline.locator('[data-stage-status="ready"]').waitFor();
    await offlineContext.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["reduced motion", "real skeletal animation", "pause", "hide/show cleanup", "failed asset fallback", "retry"] }));
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
