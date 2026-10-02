import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import type * as Three from "three";
import type { CharacterRig, RigState } from "../../game/client/player/CharacterRig";

/** Isolate CPU animation work using both shipped bodies and all five weapons. */
async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    // tsx preserves nested function names with this helper when serializing evaluate.
    await page.addInitScript("window.__name = (value) => value;");
    await page.goto(`${(process.argv[2] || "http://localhost:3000").replace(/\/$/, "")}/dev/rig`);
    await page.waitForFunction(() => !!(window as unknown as { __rigs?: unknown[] }).__rigs?.length);
    const result = await page.evaluate(() => {
      const { __rigs: rigs, THREE } = window as unknown as { __rigs: CharacterRig[]; THREE: typeof Three };
      const state: RigState = {
        x: 0, y: 0, z: 0, yaw: 0.4, pitch: 0.3, speed: 5, moveYaw: 1.3,
        crouch: false, grounded: true, alive: true, sprint: 0, ads: 0.5, reload: -1, recoil: 0.4,
      };
      const tick = (frame: number) => {
        state.pitch = Math.sin(frame * 0.03) * 0.8;
        state.recoil = (frame % 8) / 8;
        state.reload = frame % 240 > 180 ? (frame % 240 - 180) / 60 : -1;
        for (const rig of rigs) rig.update(1 / 60, state);
      };
      for (let frame = 0; frame < 120; frame++) tick(frame);
      // Count redundant transform propagation separately, so instrumentation does
      // not distort the timed samples below.
      let localMatrices = 0, parentWalks = 0, subtreeWalks = 0;
      const proto = THREE.Object3D.prototype;
      const original = { matrix: proto.updateMatrix, parents: proto.updateWorldMatrix, subtree: proto.updateMatrixWorld };
      proto.updateMatrix = function () { localMatrices++; return original.matrix.call(this); };
      proto.updateWorldMatrix = function (parents, children) { parentWalks++; return original.parents.call(this, parents, children); };
      proto.updateMatrixWorld = function (force) { subtreeWalks++; return original.subtree.call(this, force); };
      try { tick(121); }
      finally {
        proto.updateMatrix = original.matrix;
        proto.updateWorldMatrix = original.parents;
        proto.updateMatrixWorld = original.subtree;
      }
      const batchMs: number[] = [];
      for (let batch = 0; batch < 7; batch++) {
        const start = performance.now();
        for (let frame = 0; frame < 180; frame++) tick(frame);
        batchMs.push((performance.now() - start) / 180);
      }
      const sorted = [...batchMs].sort((a, b) => a - b);
      return { rigs: rigs.length, framesPerBatch: 180, batchMs, medianMs: sorted[3],
        transformCallsPerFrame: { localMatrices, parentWalks, subtreeWalks } };
    });
    const label = (process.argv[3] || "latest").replace(/[^a-z0-9_-]/gi, "");
    mkdirSync("out/qa", { recursive: true });
    writeFileSync(`out/qa/rig-benchmark-${label}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
