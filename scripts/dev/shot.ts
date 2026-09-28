// Screenshots a page with the locally installed Chrome (GPU WebGL).
// Usage: npx tsx scripts/dev/shot.ts <url> <out.png> [waitMs] [width] [height] [--eval "js"]
import { chromium } from "playwright-core";

async function main() {
  const [url, out, wait = "6000", w = "1600", h = "900"] = process.argv.slice(2).filter((a, i, arr) => a !== "--eval" && arr[i - 1] !== "--eval");
  const evalIdx = process.argv.indexOf("--eval");
  const evalJs = evalIdx > 0 ? process.argv[evalIdx + 1] : null;
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
  const logs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text()}`); });
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(Number(wait));
  if (evalJs) {
    console.log("eval:", await page.evaluate(evalJs));
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: out });
  await browser.close();
  if (logs.length) console.log(logs.slice(0, 30).join("\n"));
  console.log("saved", out);
}

main().catch((e) => { console.error(e); process.exit(1); });
