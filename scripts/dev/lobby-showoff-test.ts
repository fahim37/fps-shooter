// The blade inspects among the lobby showoffs: the operator on the lineup takes the blade up and
// inspects it in third person, and the clip showoffs still work after.
// Usage: npx tsx scripts/dev/lobby-showoff-test.ts [webBase] [outDir]
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const url = process.argv[2] || "http://localhost:3107";
  const out = process.argv[3] || "out/qa/lobby-showoffs";
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    // The flowing backdrop and the drifting watermark show through the stage; freeze them for the shots.
    await page.addStyleTag({ content: "canvas[data-backdrop] { visibility: hidden !important; } *, *::before, *::after { animation: none !important; transition: none !important; }" });
    await page.locator('[data-stage-status="ready"]').waitFor({ timeout: 120000 });
    const canvas = page.getByLabel(/^Animated character preview/);
    const box = (await canvas.boundingBox())!;
    const shoot = (name: string) => page.screenshot({ path: join(out, `${name}.png`), clip: { x: box.x, y: box.y + 48, width: box.width, height: box.height - 48 } });
    const atEase = await shoot("at-ease");

    for (const [button, blade, seconds] of [["Knife inspect", "knife", 7] as const, ["Katana inspect", "katana", 9] as const]) {
      await page.getByRole("button", { name: button, exact: true }).click();
      assert.equal(await page.getByRole("button", { name: button, exact: true }).getAttribute("aria-pressed"), "true");
      await page.getByText(`Operator · ${button}`).waitFor();
      // The models load on first use; then the equip, then the inspect, every second or so.
      const frames: Buffer[] = [];
      for (let i = 0; i < seconds; i++) {
        await page.waitForTimeout(1000);
        frames.push(await shoot(`${blade}-${i}`));
      }
      assert.ok(frames.some((f) => !f.equals(atEase)), `${button} changes the operator on stage`);
      assert.ok(new Set(frames.map((f) => f.toString("base64"))).size > 3, `${button} keeps moving`);
    }

    await page.getByRole("button", { name: "Dance", exact: true }).click();
    await page.getByText("Operator · Dance").waitFor();
    await page.waitForTimeout(800);
    await shoot("dance");
    await page.screenshot({ path: join(out, "lobby.png") });
    assert.equal(await page.locator("canvas:not([data-backdrop])").count(), 1, "Still one renderer for the lineup");
    assert.deepEqual(errors, []);
    console.log("lobby showoffs ok");
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
