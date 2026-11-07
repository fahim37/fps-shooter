// Measures how well hits match what is drawn. Poses both character bodies through stances, aim
// pitches and animation phases, bakes the skinned mesh, and fires random rays at it from several
// sides. The part of the mesh each ray meets first (head / body / legs / nothing) is the truth;
// it is compared with the bone hit shapes (game/client/player/hitShapes.ts, what clients test)
// and the server's pose hitboxes (game/shared/hitboxes.ts, what the server checks claims against).
// Also prints where the head sits per stance, to fit the server model.
// Usage: npx tsx scripts/dev/hit-accuracy.ts [webBase] [--tune]   (web dev server must be running)
import { chromium } from "playwright-core";
import type * as Three from "three";
import type { CharacterRig, RigState } from "../../game/client/player/CharacterRig";
import type { HitShapes as HitShapesT, SHAPES as SHAPES_T } from "../../game/client/player/hitShapes";
import type { hitboxes as hitboxesT, rayVsPose as rayVsPoseT, HitPart } from "../../game/shared/hitboxes";

type V3 = [number, number, number];
interface Case { name: string; weapon: string; speed: number; crouch: boolean; ads: number; pitch: number; lean: number; sprint: number }

const STANCES: Omit<Case, "weapon" | "pitch">[] = [
  { name: "still", speed: 0, crouch: false, ads: 0, lean: 0, sprint: 0 },
  { name: "ads", speed: 0, crouch: false, ads: 1, lean: 0, sprint: 0 },
  { name: "walk", speed: 3, crouch: false, ads: 1, lean: 0, sprint: 0 },
  { name: "run", speed: 5.5, crouch: false, ads: 0, lean: 0, sprint: 0 },
  { name: "sprint", speed: 7.5, crouch: false, ads: 0, lean: 0, sprint: 1 },
  { name: "crouch", speed: 0, crouch: true, ads: 1, lean: 0, sprint: 0 },
  { name: "crouch walk", speed: 2, crouch: true, ads: 0, lean: 0, sprint: 0 },
  { name: "lean L", speed: 0, crouch: false, ads: 1, lean: -1, sprint: 0 },
  { name: "lean R", speed: 0, crouch: false, ads: 1, lean: 1, sprint: 0 },
  { name: "crouch lean R", speed: 0, crouch: true, ads: 1, lean: 1, sprint: 0 },
];
const PITCHES = [-1.4, -0.7, 0, 0.7, 1.4];
const WEAPONS = ["ar", "pistol"];
const YAW = 0.4;
const PHASES = 3;
const RAYS = 260;

async function main() {
  const args = process.argv.slice(2);
  const tune = args.includes("--tune");
  const base = (args.find((a) => !a.startsWith("--")) || "http://localhost:3107").replace(/\/$/, "");
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
    await page.addInitScript("window.__name = (f) => f");
    page.on("console", (m) => { if (m.type() === "log") console.log(m.text()); });
    await page.goto(`${base}/dev/rig`);
    await page.waitForFunction(() => !!(window as unknown as { __rigs?: unknown[]; __hit?: unknown }).__rigs?.length && !!(window as unknown as { __hit?: unknown }).__hit, null, { timeout: 180000 });
    const cases: Case[] = WEAPONS.flatMap((weapon) => STANCES.flatMap((s) => PITCHES.map((pitch) => ({ ...s, weapon, pitch }))));
    const report = await page.evaluate(({ cases, yaw, phases, rays, tune }) => {
      const w = window as unknown as {
        __rigs: CharacterRig[]; THREE: typeof Three;
        __hit: { HitShapes: typeof HitShapesT; SHAPES: typeof SHAPES_T; rayVsPose: typeof rayVsPoseT; hitboxes: typeof hitboxesT };
      };
      const { THREE } = w;
      const { HitShapes, SHAPES, rayVsPose, hitboxes } = w.__hit;
      const rigs = w.__rigs.slice(0, 2);
      for (const r of w.__rigs.slice(2)) r.object.visible = false;
      const PART = (name: string): HitPart => name === "Head" || name === "neck_01" ? "head"
        : /^(thigh|calf|foot|ball)/.test(name) ? "legs" : "body";
      let seed = 12345;
      const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

      interface PoseData { bones: Map<string, { matrixWorld: Three.Matrix4 }>; rays: { o: V3; d: V3; truth: HitPart | null }[]; pose: Parameters<typeof rayVsPose>[3]; c: Case; rig: number }
      const poses: PoseData[] = [];
      const fwd: V3 = [-Math.sin(yaw), 0, -Math.cos(yaw)], right: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const headTable: Record<string, number[][]> = {};

      rigs.forEach((r, ri) => {
        // Per vertex, which part its dominant bone belongs to.
        const parts = r.inst.meshes.map((mesh) => {
          const si = mesh.geometry.getAttribute("skinIndex"), sw = mesh.geometry.getAttribute("skinWeight");
          const out: HitPart[] = [];
          for (let i = 0; i < si.count; i++) {
            let best = 0, bw = -1;
            for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) { bw = sw.getComponent(i, k); best = si.getComponent(i, k); }
            out.push(PART(mesh.skeleton.bones[best].name));
          }
          return out;
        });
        for (const c of cases) {
          r.setWeapon(c.weapon as never);
          const state = (): RigState => ({
            x: 0, y: 0, z: 0, yaw, pitch: c.pitch, lean: c.lean, speed: c.speed, moveYaw: yaw, crouch: c.crouch,
            grounded: true, alive: true, sprint: c.sprint, ads: c.ads, reload: -1, recoil: 0, sinceShot: 5, sinceDraw: 5,
          });
          for (let i = 0; i < 50; i++) r.update(1 / 60, state());
          for (let ph = 0; ph < phases; ph++) {
            for (let i = 0; i < 17; i++) r.update(1 / 60, state());
            r.object.updateMatrixWorld(true);
            // Bake the skinned mesh as drawn.
            const baked: Three.Mesh[] = [];
            const vpart: HitPart[][] = [];
            const box = new THREE.Box3();
            r.inst.meshes.forEach((mesh, mi) => {
              if (!mesh.visible) return;
              mesh.skeleton.update();
              const src = mesh.geometry.getAttribute("position");
              const pos = new Float32Array(src.count * 3), v = new THREE.Vector3();
              for (let i = 0; i < src.count; i++) {
                mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
                pos.set([v.x, v.y, v.z], i * 3);
                box.expandByPoint(v);
              }
              const g = new THREE.BufferGeometry();
              g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
              if (mesh.geometry.index) g.setIndex(mesh.geometry.index);
              g.computeBoundingSphere(); g.computeBoundingBox();
              const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
              m.userData.parts = parts[mi];
              baked.push(m);
              vpart.push(parts[mi]);
            });
            box.expandByScalar(0.12);
            const raycaster = new THREE.Raycaster();
            const list: PoseData["rays"] = [];
            for (let k = 0; k < rays; k++) {
              const ang = rand() * Math.PI * 2, dist = 8 + rand() * 30;
              const o: V3 = [Math.sin(ang) * dist, 1.0 + rand() * 1.2, Math.cos(ang) * dist];
              const t = new THREE.Vector3(box.min.x + rand() * (box.max.x - box.min.x), box.min.y + rand() * (box.max.y - box.min.y), box.min.z + rand() * (box.max.z - box.min.z));
              const d = t.sub(new THREE.Vector3(...o)).normalize();
              raycaster.set(new THREE.Vector3(...o), d);
              raycaster.far = 60;
              const hit = raycaster.intersectObjects(baked, false)[0];
              let truth: HitPart | null = null;
              if (hit?.face) {
                const ps = hit.object.userData.parts as HitPart[];
                const f = [ps[hit.face.a], ps[hit.face.b], ps[hit.face.c]];
                truth = f[1] === f[2] ? f[1] : f[0];
              }
              list.push({ o, d: [d.x, d.y, d.z], truth });
            }
            const bones = new Map<string, { matrixWorld: Three.Matrix4 }>();
            for (const [n, b] of r.inst.bones) bones.set(n, { matrixWorld: b.matrixWorld.clone() });
            poses.push({ bones, rays: list, c, rig: ri, pose: { x: 0, y: 0, z: 0, crouch: c.crouch, yaw, lean: c.lean, pitch: c.pitch, moving: c.speed > 0.5 ? 1 : 0 } as never });
            // Where the head sphere sits, in the body frame.
            const head = SHAPES[0];
            const hp = new THREE.Vector3(...head.at!).applyMatrix4(r.inst.bones.get("Head")!.matrixWorld);
            const key = `${c.name}|${c.pitch}`;
            (headTable[key] ??= []).push([hp.x * fwd[0] + hp.z * fwd[2], hp.x * right[0] + hp.z * right[2], hp.y]);
            for (const m of baked) m.geometry.dispose();
          }
        }
      });

      type Defs = typeof SHAPES;
      const score = (defs: Defs) => {
        const m: Record<string, number> = {};
        let ok = 0, n = 0;
        for (const p of poses) {
          const hs = new HitShapes(p.bones as never, defs);
          for (const ray of p.rays) {
            const got = hs.raycast(ray.o, ray.d, 80)?.part ?? null;
            const key = `${ray.truth ?? "miss"}>${got ?? "miss"}`;
            m[key] = (m[key] ?? 0) + 1;
            n++; if (got === ray.truth) ok++;
          }
        }
        return { ok: ok / n, m };
      };
      const serverScore = () => {
        const m: Record<string, number> = {};
        let ok = 0, n = 0;
        for (const p of poses) for (const ray of p.rays) {
          const got = rayVsPose(ray.o, ray.d, 80, p.pose)?.part ?? null;
          const key = `${ray.truth ?? "miss"}>${got ?? "miss"}`;
          m[key] = (m[key] ?? 0) + 1;
          n++; if (got === ray.truth) ok++;
        }
        return { ok: ok / n, m };
      };

      let defs: Defs = SHAPES.map((s) => ({ ...s, at: s.at ? [...s.at] as V3 : undefined }));
      if (tune) {
        // Coordinate descent on radii and the head sphere's offset.
        let best = score(defs).ok;
        for (let pass = 0; pass < 3; pass++) {
          for (let i = 0; i < defs.length; i++) {
            const knobs: [() => number, (v: number) => void][] = [[() => defs[i].r, (v) => { defs[i].r = v; }]];
            if (defs[i].at) for (let k = 0; k < 3; k++) knobs.push([() => defs[i].at![k], (v) => { defs[i].at![k] = v; }]);
            for (const [get, set] of knobs) {
              for (const step of [0.02, -0.02, 0.01, -0.01, 0.005, -0.005]) {
                for (;;) {
                  const was = get();
                  set(Math.round((was + step) * 1000) / 1000);
                  if (defs[i].r < 0.02) { set(was); break; }
                  const s = score(defs).ok;
                  if (s > best + 1e-5) best = s; else { set(was); break; }
                }
              }
            }
          }
          console.log(`tune pass ${pass}: ${(best * 100).toFixed(2)}%`);
        }
      }

      const head: Record<string, string> = {};
      for (const [k, rows] of Object.entries(headTable)) {
        const mean = [0, 1, 2].map((i) => rows.reduce((a, r) => a + r[i], 0) / rows.length);
        const spread = [0, 2].map((i) => Math.max(...rows.map((r) => r[i])) - Math.min(...rows.map((r) => r[i])));
        head[k] = `fwd ${mean[0].toFixed(2)} right ${mean[1].toFixed(2)} up ${mean[2].toFixed(2)}  spread fwd ${spread[0].toFixed(2)} up ${spread[1].toFixed(2)}`;
      }
      return { poses: poses.length, rays: poses.length * rays, shapes: score(defs), server: serverScore(), defs: tune ? defs : null, head };
    }, { cases, yaw: YAW, phases: PHASES, rays: RAYS, tune });

    const show = (label: string, r: { ok: number; m: Record<string, number> }) => {
      const parts = ["head", "body", "legs", "miss"];
      console.log(`\n${label}: ${(r.ok * 100).toFixed(1)}% of rays land on the part they visibly hit`);
      console.log("  drawn \\ scored   " + parts.map((p) => p.padStart(7)).join(""));
      for (const t of parts) {
        const total = parts.reduce((a, g) => a + (r.m[`${t}>${g}`] ?? 0), 0);
        console.log(`  ${t.padEnd(16)} ` + parts.map((g) => `${total ? ((r.m[`${t}>${g}`] ?? 0) / total * 100).toFixed(1) : "-"}%`.padStart(7)).join("") + `   (${total} rays)`);
      }
    };
    console.log(`${report.poses} poses, ${report.rays} rays`);
    show("Bone hit shapes (client)", report.shapes);
    show("Pose hitboxes (server)", report.server);
    if (args.includes("--head")) for (const [k, v] of Object.entries(report.head)) console.log(`${k.padEnd(20)} ${v}`);
    if (report.defs) console.log("\ntuned:\n" + report.defs.map((d) => JSON.stringify(d)).join(",\n"));
  } finally { await browser.close(); }
}

main().catch((e) => { console.error(e); process.exit(1); });
