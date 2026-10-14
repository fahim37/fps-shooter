// Prints the elbow bend of each held weapon pose, third and first person.
// Usage: npx tsx scripts/dev/arm-measure.ts [webBase]
import { chromium } from "playwright-core";
import type * as Three from "three";
import type { CharacterRig } from "../../game/client/player/CharacterRig";

const WEAPONS = ["ar", "smg", "shotgun", "sniper", "pistol"];

async function measure(page: import("playwright-core").Page) {
  return page.evaluate(() => {
    const { __rigs: rigs, THREE } = window as unknown as { __rigs: CharacterRig[]; THREE: typeof Three };
    const p = (r: CharacterRig, n: string) => new THREE.Vector3().setFromMatrixPosition(r.inst.bones.get(n)!.matrixWorld);
    return rigs.map((r) => {
      const out: Record<string, number> = {};
      for (const side of ["r", "l"]) {
        const a = p(r, `upperarm_${side}`), b = p(r, `lowerarm_${side}`), c = p(r, `hand_${side}`);
        const ab = b.clone().sub(a), bc = c.clone().sub(b);
        // Interior elbow angle: 180 = straight.
        out[`elbow_${side}`] = Math.round(180 - (ab.angleTo(bc) * 180) / Math.PI);
        out[`reach_${side}`] = Math.round((a.distanceTo(c) / (ab.length() + bc.length())) * 100);
        // How far the grip asks the wrist to go, as a share of the arm: over 100 cannot be reached.
        const rig = r as unknown as { handling: Record<string, unknown>; grip: Record<string, unknown>; body: Three.Object3D; handTarget(...args: unknown[]): Three.Matrix4 };
        const left = new THREE.Vector3(1, 0, 0).applyQuaternion(rig.body.quaternion);
        const target = new THREE.Vector3().setFromMatrixPosition(rig.handTarget(rig.handling[side === "r" ? "right" : "left"], rig.grip[side === "r" ? "right" : "left"], left));
        out[`want_${side}`] = Math.round((a.distanceTo(target) / (ab.length() + bc.length())) * 100);
      }
      return out;
    });
  });
}

async function main() {
  const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    // tsx wraps named functions in __name(), which the page does not define.
    await page.addInitScript("window.__name = (f) => f");
    const ready = () => page.waitForFunction(() => !!(window as unknown as { __rigs?: unknown[] }).__rigs?.length, null, { timeout: 120000 });
    for (const pitch of [0, 0.9, -0.9]) {
      await page.goto(`${base}/dev/rig?pitch=${pitch}`);
      await ready();
      await page.waitForTimeout(800);
      const rows = await measure(page);
      rows.forEach((row, i) => console.log(`tpp pitch=${pitch} ${WEAPONS[Math.floor(i / 2)]} ${i % 2 ? "female" : "male"}`, JSON.stringify(row)));
    }
    for (const w of WEAPONS) for (const ads of [0, 1]) {
      await page.goto(`${base}/dev/rig?fpp=1&weapon=${w}&ads=${ads}`);
      await ready();
      await page.waitForTimeout(800);
      console.log(`fpp ${w} ads=${ads}`, JSON.stringify((await measure(page))[0]));
    }
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
