// Solves how every gun is held against the real meshes (game/client/dev/gripSolver.ts) and writes
// the poses to game/shared/generated/grips.json. Needs the web dev server running.
// Usage: npx tsx scripts/dev/grip-bake.ts [webBase] [weapon,weapon...]
// Prints, per hand pose, the share of the hand's inner skin lying on the gun and how close each
// part of it ends up (mm, negative is inside the gun).
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BakeResult } from "../../game/client/dev/gripSolver";

const WEAPONS = ["ar", "smg", "shotgun", "sniper", "pistol"];
const OUT = join(process.cwd(), "game/shared/generated/grips.json");

async function main() {
  const [base = "http://localhost:3107", list] = process.argv.slice(2);
  const weapons = list ? list.split(",") : WEAPONS;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.addInitScript("window.__name = (f) => f");
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.goto(`${base.replace(/\/$/, "")}/dev/rig?fpp=1`);
    await page.waitForFunction(() => !!(window as unknown as { __rigs?: unknown[] }).__rigs?.length, null, { timeout: 120000 });
    const grips = JSON.parse(readFileSync(OUT, "utf8")) as Record<string, unknown>;
    for (const weapon of weapons) {
      const result = await page.evaluate((w) => (window as unknown as { __grips: { bake(w: string): Promise<BakeResult> } }).__grips.bake(w), weapon);
      grips[weapon] = result.grip;
      console.log(`${weapon} (${result.ms} ms)`);
      for (const [pose, r] of Object.entries(result.report)) {
        const fingers = Object.entries(r.fingers).map(([name, gaps]) => `${name} ${gaps.join("/")}`).join("  ");
        console.log(`  ${pose.padEnd(14)} ${String(r.on).padStart(3)}% on  palm ${String(r.palm).padStart(5)}  ${fingers}${r.trigger === undefined ? "" : `  trigger off ${r.trigger}`}  deepest ${r.deepest}  moved ${r.fit.join("/")}`);
        if (process.env.GRIP_AT) console.log(`  ${"".padEnd(14)} ${Object.entries(r.at).map(([k, v]) => `${k} ${v.join(",")}`).join("  ")}`);
      }
    }
    // One hand pose per line: the file stays readable in a diff.
    const text = JSON.stringify(grips, null, 1).replace(/\[\s+([^\[\]{}]+?)\s+\]/g, (_, items: string) => `[${items.replace(/\s+/g, " ")}]`);
    writeFileSync(OUT, `${text}\n`);
    console.log("wrote", OUT);
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
