// Prints a gun's outline as text, in millimetres, for placing hands on it (see game/client/dev/gripSolver.ts).
// Usage: npx tsx scripts/dev/grip-view.ts <weapon> side <y0> <y1> <z0> <z1> [step] [x] [halfWidth]
//        npx tsx scripts/dev/grip-view.ts <weapon> top <y> <x0> <x1> <z0> <z1> [step]
//        npx tsx scripts/dev/grip-view.ts hand    (the right hand's joints and skin in its own frame)
// Coordinates are weapon space in metres: grip at the origin, muzzle toward -Z, +X the gun's right.
import { chromium } from "playwright-core";

async function main() {
  const [weapon, view, ...rest] = process.argv.slice(2);
  const n = rest.map(Number);
  const base = process.env.WEB_BASE ?? "http://localhost:3107";
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.addInitScript("window.__name = (f) => f");
    await page.goto(`${base}/dev/rig?fpp=1`);
    await page.waitForFunction(() => !!(window as unknown as { __rigs?: unknown[] }).__rigs?.length, null, { timeout: 120000 });
    const text = await page.evaluate(async ([w, v, a]) => {
      const g = (window as unknown as { __grips: { hand(): Promise<unknown>; sideView(...args: unknown[]): Promise<string>; topView(...args: unknown[]): Promise<string> } }).__grips;
      if (w === "hand") return JSON.stringify(await g.hand(), null, 1).replace(/\[\s+(-?\d+),\s+(-?\d+),\s+(-?\d+)\s+\]/g, "[$1, $2, $3]");
      return v === "top" ? g.topView(w, a[0], [a[1], a[2]], [a[3], a[4]], a[5]) : g.sideView(w, [a[0], a[1]], [a[2], a[3]], a[4], a[5], a[6]);
    }, [weapon, view, n] as const);
    console.log(text);
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
