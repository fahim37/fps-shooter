import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import type * as Three from "three";
import type { CharacterRig } from "../../game/client/player/CharacterRig";

async function main() {
  const base = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 850 } });
    await page.goto(`${base}/dev/rig?cam=4,2,6`);
    await page.waitForFunction(() => !!(window as unknown as { __rigs?: unknown[] }).__rigs?.length);
    const result = await page.evaluate(() => {
      const { __rigs: rigs, THREE } = window as unknown as { __rigs: CharacterRig[]; THREE: typeof Three };
      const problems: string[] = [];
      let checked = 0;
      for (const r of rigs) {
        for (const mode of ["idle", "run", "crouch", "aim-up", "aim-down", "reload", "dead", "respawn"]) {
          for (let i = 0; i < 90; i++) r.update(1 / 60, {
            x: 0, y: 0, z: 0, yaw: Math.PI / 2, pitch: mode === "aim-up" ? 1.45 : mode === "aim-down" ? -1.45 : 0,
            speed: mode === "run" ? 7 : mode === "crouch" ? 2 : 0, moveYaw: 0, crouch: mode === "crouch",
            grounded: true, alive: mode !== "dead", sprint: mode === "run" ? 1 : 0,
            ads: 1, reload: mode === "reload" ? i / 90 : -1, recoil: i % 10 / 10,
          });
          r.object.updateMatrixWorld(true);
          for (const mesh of r.inst.meshes) {
            if (!mesh.visible) continue;
            const pos = mesh.geometry.getAttribute("position");
            mesh.skeleton.update();
            const vertex = new THREE.Vector3();
            for (let i = 0; i < pos.count; i += 11) {
              mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
              if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite) || vertex.length() > 3.5) problems.push(`${mode}: ${mesh.name} has invalid or detached geometry`);
            }
          }
          checked++;
        }
      }
      return { checked, problems: [...new Set(problems)] };
    });
    assert.deepEqual(result.problems, []);
    console.log(JSON.stringify({ passed: true, ...result, checks: ["both character bodies", "five weapons", "locomotion", "crouch", "extreme aim", "reload", "death and respawn", "finite skinned vertices"] }));
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
