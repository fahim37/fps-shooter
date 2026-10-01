import assert from "node:assert/strict";
import { chromium } from "playwright-core";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const samples: { quality: string; dpr: number; ammo: string }[] = [];
  try {
    await page.addInitScript(() => localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false })));
    await page.goto(process.argv[2] || "http://localhost:3100");
    await page.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60000 });
    await page.getByLabel("FILL MATCH TO").selectOption("0");
    await page.getByLabel("Private room").check();
    await page.getByRole("button", { name: "CREATE TEAM DEATHMATCH" }).click();
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
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("hollowmere.settings.v1") || "{}"));
    assert.equal(stored.quality, "medium");
    assert.equal(stored.adaptiveResolution, true);
    await page.getByRole("button", { name: "RETURN TO LOBBY" }).click();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, samples, checks: ["live F6 quality", "render resolution", "pointer lock", "same room", "preserved ammunition", "paused select", "saved adaptive setting"], errors }));
  } catch (error) {
    console.error("Browser errors:", errors);
    console.error("Visible UI:", await page.locator("body").innerText().catch(() => "unavailable"));
    await page.screenshot({ path: ".next/graphics-test-failure.png" }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
