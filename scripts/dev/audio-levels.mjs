// Renders the game's synthesized sounds offline in headless Chrome and prints level and spectrum
// figures, for the engine at HEAD ("old") and the working tree ("new").
// Usage (from the project root, Chrome installed): node scripts/dev/audio-levels.mjs [filter]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const esbuild = require("esbuild");
const { chromium } = require("playwright-core");
const filter = process.argv[2] ?? "";

async function bundle(contents, name) {
  const out = await esbuild.build({
    stdin: { contents, resolveDir: path.join(root, "game/client/core"), loader: "ts", sourcefile: `${name}.ts` },
    bundle: true, write: false, format: "iife", globalName: name, platform: "browser", logLevel: "silent",
  });
  return out.outputFiles[0].text;
}

const oldSrc = execSync("git show HEAD:game/client/core/audio.ts", { cwd: root, maxBuffer: 1 << 26 }).toString();
const newSrc = readFileSync(path.join(root, "game/client/core/audio.ts"), "utf8");
const scripts = [await bundle(oldSrc, "OldAudio"), await bundle(newSrc, "NewAudio")];

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await page.goto("about:blank");
for (const s of scripts) await page.addScriptTag({ content: s });

const results = await page.evaluate(async (filter) => {
  const SR = 48000;
  const near = { x: 0, y: 0, z: -15 }, far = { x: 0, y: 0, z: -70 }, beside = { x: 1.2, y: 0, z: 0 }, step = { x: 0, y: 0, z: -6 };
  const sounds = {
    "shot ar (own)": [1.2, (a) => a.shot("ar", undefined, true)],
    "shot smg (own)": [1.2, (a) => a.shot("smg", undefined, true)],
    "shot shotgun (own)": [1.6, (a) => a.shot("shotgun", undefined, true)],
    "shot sniper (own)": [1.8, (a) => a.shot("sniper", undefined, true)],
    "shot pistol (own)": [1.6, (a) => a.shot("pistol", undefined, true)],
    "shot ar enemy 15 m": [1.2, (a) => a.shot("ar", near, false, "enemy")],
    "shot ar ally 15 m": [1.2, (a) => a.shot("ar", near, false, "ally")],
    "shot ar enemy 70 m": [1.4, (a) => a.shot("ar", far, false, "enemy")],
    "shot sniper enemy 70 m": [1.8, (a) => a.shot("sniper", far, false, "enemy")],
    "ar burst x6 (own)": [1.6, (a, ctx) => { for (let i = 0; i < 6; i++) setAt(ctx, a, i * 0.1, () => a.shot("ar", undefined, true)); }],
    "footstep stone (own run)": [0.4, (a) => a.footstep(true, undefined, 0.15, 0.5)],
    "footstep earth (own run)": [0.4, (a) => a.footstep(false, undefined, 0.15, 0.5)],
    "footstep stone (own sprint)": [0.4, (a) => a.footstep(true, undefined, 0.22, 1)],
    "footstep stone enemy 6 m": [0.4, (a) => a.footstep(true, step, 0.3, 1)],
    "footstep earth enemy 6 m": [0.4, (a) => a.footstep(false, step, 0.3, 1)],
    "land hard": [0.5, (a) => a.land(1)],
    "land soft": [0.5, (a) => a.land(0.4)],
    "hitmarker body": [0.3, (a) => a.hitmarker(false)],
    "hitmarker head": [0.4, (a) => a.hitmarker(true)],
    "hurt": [0.5, (a) => a.hurt()],
    "explosion 6 m": [3, (a) => a.explosion({ x: 0, y: 0, z: -6 })],
    "explosion 25 m": [3, (a) => a.explosion({ x: 0, y: 0, z: -25 })],
    "reload ar": [2.2, (a) => a.reload("ar", 1.9)],
    "switch weapon": [0.5, (a) => a.switchWeapon()],
    "dry fire": [0.3, (a) => a.dryFire()],
    "pump shotgun (own)": [0.6, (a) => a.cycle("shotgun")],
    "reload shotgun": [2.4, (a) => a.reload("shotgun", 2.25)],
    "grenade throw": [0.5, (a) => a.grenadeThrow()],
    "jump": [0.4, (a) => a.jump?.()],
    "slide (own)": [1.6, (a) => a.slide?.(true)],
    "slide enemy 6 m": [1.2, (a) => a.slideAt?.(step)],
    "impact wall 8 m": [0.6, (a) => a.impact?.({ x: 0, y: 0, z: -8 }, false)],
    "impact ground 8 m": [0.6, (a) => a.impact?.({ x: 0, y: 0, z: -8 }, true)],
    "whiz 1.2 m": [0.5, (a) => a.whiz?.(beside, 0.57)],
  };
  // Offline contexts render in one go: stagger repeats by constructing them at render time.
  function setAt(ctx, a, at, play) { if (at === 0) play(); else ctx.suspend(at).then(() => { play(); ctx.resume(); }); }

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k);
        const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
        re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr; im[i + k] += xi;
      }
    }
  }

  async function render(Engine, seconds, play) {
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
    const Real = window.AudioContext;
    window.AudioContext = function () { return ctx; };
    const a = new Engine.AudioEngine();
    a.unlock();
    window.AudioContext = Real;
    a.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const made = play(a, ctx);
    if (made === undefined && !a.voices.length) return null;
    const buf = await ctx.startRendering();
    const l = buf.getChannelData(0), r = buf.getChannelData(1);
    let peak = 0, first = -1, last = 0, bad = 0;
    for (let i = 0; i < l.length; i++) {
      const v = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      if (!Number.isFinite(v)) bad++;
      if (v > peak) peak = v;
      if (v > 0.003) { if (first < 0) first = i; last = i; }
    }
    // Loudest 50 ms window.
    const win = Math.round(SR * 0.05);
    let run = 0, loud = 0;
    for (let i = 0; i < l.length; i++) {
      run += (l[i] * l[i] + r[i] * r[i]) / 2;
      if (i >= win) run -= (l[i - win] * l[i - win] + r[i - win] * r[i - win]) / 2;
      if (run > loud) loud = run;
    }
    const n = 1 << 15, re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n && i < l.length; i++) re[i] = (l[i] + r[i]) / 2;
    fft(re, im);
    const edges = [0, 120, 500, 2000, 8000, 24000], bands = new Array(5).fill(0);
    let total = 0, centroid = 0;
    for (let k = 1; k < n / 2; k++) {
      const f = (k * SR) / n, e = re[k] * re[k] + im[k] * im[k];
      total += e; centroid += e * f;
      bands[edges.findIndex((edge, i) => f >= edge && f < edges[i + 1])] += e;
    }
    const db = (x) => (x > 0 ? (10 * Math.log10(x)).toFixed(1) : "-inf");
    return {
      peak: peak.toFixed(3), loud: db(loud / win), ms: first < 0 ? 0 : Math.round(((last - first) / SR) * 1000),
      centroid: total ? Math.round(centroid / total) : 0,
      bands: bands.map((b) => (total ? Math.round((100 * b) / total) : 0)).join("/"), bad,
    };
  }

  const out = [];
  for (const [name, [seconds, play]] of Object.entries(sounds)) {
    if (filter && !name.includes(filter)) continue;
    const row = { name };
    for (const [label, Engine] of [["old", window.OldAudio], ["new", window.NewAudio]]) {
      try { row[label] = await render(Engine, seconds, play); } catch (e) { row[label] = { error: String(e).slice(0, 120) }; }
    }
    out.push(row);
  }
  return out;
}, filter);

await browser.close();
const fmt = (r) => !r ? "(none)".padEnd(52) : r.error ? r.error : `pk ${r.peak} loud ${String(r.loud).padStart(6)} dB ${String(r.ms).padStart(5)} ms cen ${String(r.centroid).padStart(5)} Hz [${r.bands}]${r.bad ? " NaN!" : ""}`.padEnd(52);
console.log("bands: share of energy in <120 / 120-500 / 500-2k / 2k-8k / >8k Hz; loud: loudest 50 ms, dBFS");
for (const r of results) console.log(r.name.padEnd(28), "old", fmt(r.old), "| new", fmt(r.new));
