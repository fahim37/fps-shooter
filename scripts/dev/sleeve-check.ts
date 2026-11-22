// The first-person arms are open at the shoulder end: a pose that brings that opening into view
// shows a sliver of sleeve edge at the bottom of the screen. This walks every blade clip with the
// rig viewer's &backfaces=1 (the inside of the arms painted magenta) and lists the moments magenta
// shows along the bottom of the screen. (Higher up it is only the inside of a glove cuff at the
// wrist, which reads as shadow.)
// Usage: npx tsx scripts/dev/sleeve-check.ts [webBase] [weapon,weapon] [draw|inspect|shot]
import { chromium } from "playwright-core";

interface Case { weapon: string; param: string; extra: string; to: number; step: number }

const CASES: Case[] = [
  { weapon: "knife", param: "draw", extra: "", to: 1.35, step: 0.05 },
  { weapon: "knife", param: "inspect", extra: "", to: 5.05, step: 0.1 },
  ...[0, 1, 2].map((n) => ({ weapon: "knife", param: "shot", extra: `swing=${n}`, to: 0.38, step: 0.03 })),
  { weapon: "knife", param: "shot", extra: "heavy=1", to: 2.1, step: 0.1 },
  { weapon: "katana", param: "draw", extra: "", to: 1.35, step: 0.05 },
  { weapon: "katana", param: "inspect", extra: "", to: 7.1, step: 0.1 },
  ...[0, 1, 2, 3].map((n) => ({ weapon: "katana", param: "shot", extra: `swing=${n}`, to: 0.62, step: 0.03 })),
  { weapon: "katana", param: "shot", extra: "heavy=1", to: 1.0, step: 0.05 },
];

/** Magenta pixels (at half size) that count as a visible opening. */
const ALLOWED = 4;

async function main() {
  const [base = "http://localhost:3107", only, param] = process.argv.slice(2);
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const hits: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript("window.__name = (f) => f");
    for (const c of CASES.filter((c) => (!only || only.split(",").includes(c.weapon)) && (!param || c.param === param))) {
      for (let t = 0; t <= c.to + 1e-6; t += c.step) {
        await page.goto(`${base}/dev/rig?fpp=1&backfaces=1&weapon=${c.weapon}&${c.param}=${t.toFixed(3)}&${c.extra}`);
        await page.waitForFunction(() => !!(window as unknown as { __rigs?: unknown[] }).__rigs?.length, null, { timeout: 120000 });
        await page.waitForTimeout(300);
        const magenta = await page.evaluate(() => {
          const canvas = document.querySelector("canvas")!;
          const w = canvas.width >> 1, h = canvas.height >> 1;
          const ctx = new OffscreenCanvas(w, h).getContext("2d")!;
          ctx.drawImage(canvas, 0, 0, w, h);
          // The open sleeve end can only come in at the bottom edge.
          const strip = Math.round(h * 0.15);
          const d = ctx.getImageData(0, h - strip, w, strip).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] > 190 && d[i + 1] < 90 && d[i + 2] > 190) n++;
          return n;
        });
        if (magenta > ALLOWED) hits.push(`${c.weapon} ${c.param} ${c.extra} t=${t.toFixed(2)}: ${magenta} px of open sleeve`);
      }
      console.log(`checked ${c.weapon} ${c.param} ${c.extra}`);
    }
  } finally { await browser.close(); }
  console.log(hits.length ? hits.join("\n") : "no open sleeve in view");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
