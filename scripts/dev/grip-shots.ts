// Close-up screenshots of how each gun is held, from outside the first-person arms.
// Usage: npx tsx scripts/dev/grip-shots.ts <outDir> [webBase] [weapon,weapon...] [extra query, e.g. "reload=0.2"]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const WEAPONS = ["ar", "smg", "shotgun", "sniper", "pistol"];

/** Camera offsets from the hand being looked at (m), in the rig viewer's world (the gun points along -Z). */
const VIEWS: Record<string, [number, number, number]> = {
  left: [-0.3, 0.06, 0.02],
  high: [-0.22, 0.2, 0.05],
  right: [0.3, 0.06, 0.02],
  below: [-0.05, -0.3, 0.06],
  above: [0.03, 0.3, 0.08],
  front: [-0.08, 0.02, -0.3],
  back: [0.06, 0.05, 0.3],
};

/** The first-person eye in the rig viewer. */
const EYE = [0, 1.62, 0];

async function main() {
  const [outDir, base = "http://localhost:3107", list, extra = ""] = process.argv.slice(2);
  if (!outDir) throw new Error("usage: grip-shots.ts <outDir> [webBase] [weapons] [query]");
  mkdirSync(outDir, { recursive: true });
  const weapons = list ? list.split(",") : WEAPONS;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.addInitScript("window.__name = (f) => f");
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    for (const w of weapons) {
      // First-person view as the player sees it.
      await page.goto(`${base}/dev/rig?fpp=1&weapon=${w}&${extra}`);
      await page.waitForFunction(() => !!(window as unknown as { __rigs?: unknown[] }).__rigs?.length, null, { timeout: 120000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(outDir, `${w}-fpp.png`) });
      const hands = await page.evaluate(() => {
        const { __rigs: rigs } = window as unknown as { __rigs: { inst: { bones: Map<string, { matrixWorld: { elements: number[] } }> } }[] };
        const at = (n: string) => { const e = rigs[0].inst.bones.get(n)!.matrixWorld.elements; return [e[12], e[13], e[14]]; };
        // Look at the knuckles rather than the wrist.
        const mid = (a: number[], b: number[]) => a.map((v, i) => (v + b[i]) / 2);
        return { r: mid(at("hand_r"), at("middle_02_r")), l: mid(at("hand_l"), at("middle_02_l")) };
      });
      for (const side of ["r", "l"] as const) for (const [view, off] of Object.entries({ ...VIEWS, eye: null })) {
        const t = hands[side];
        // "eye": from where the player looks, moved in close along the same line of sight.
        const toEye = [EYE[0] - t[0], EYE[1] - t[1], EYE[2] - t[2]];
        const far = Math.hypot(...toEye);
        const cam = t.map((v, i) => (v + (off ? off[i] : (toEye[i] / far) * 0.3)).toFixed(3)).join(",");
        await page.goto(`${base}/dev/rig?fpp=1&orbit=1&weapon=${w}&cam=${cam}&target=${t.map((v) => v.toFixed(3)).join(",")}&${extra}`);
        await page.waitForFunction(() => !!(window as unknown as { __rigs?: unknown[] }).__rigs?.length, null, { timeout: 120000 });
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(outDir, `${w}-${side}-${view}.png`) });
      }
      console.log("shot", w);
    }
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
