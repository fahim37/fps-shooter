// First-person frames through a blade clip, for comparing timing against reference footage.
// Usage: npx tsx scripts/dev/clip-frames.ts <outDir> <weapon> <param> <from> <to> <step> [webBase] [extra query]
//   e.g. clip-frames.ts out knife inspect 0 5 0.1   (param: inspect | draw | shot)
// Writes <outDir>/f0000.png ... one per step, at 1280x720 like a capture.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const [outDir, weapon, param, from, to, step, base = "http://localhost:3107", extra = ""] = process.argv.slice(2);
  if (!outDir || !weapon || !param) throw new Error("usage: clip-frames.ts <outDir> <weapon> <param> <from> <to> <step> [webBase] [query]");
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript("window.__name = (f) => f");
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    const a = Number(from), b = Number(to), d = Number(step);
    for (let i = 0, t = a; t <= b + 1e-6; i++, t = a + i * d) {
      // `solo=1` in the extra query views the third-person rig instead.
      await page.goto(`${base}/dev/rig?${extra.includes("solo=1") ? "" : "fpp=1&"}weapon=${weapon}&${param}=${t.toFixed(3)}&${extra}`);
      await page.waitForFunction(() => !!(window as unknown as { __rigs?: unknown[] }).__rigs?.length, null, { timeout: 120000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(outDir, `f${String(i).padStart(4, "0")}.png`) });
    }
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
