// Browser check for map selection and every map in real matches (web + game server running).
// Usage: npx tsx scripts/dev/map-test.ts http://localhost:3000
import { chromium, type Page } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";

const OUT = "out/qa";

/** Frames per second over `ms` (a string, so the bundler adds no helpers to the page code). */
async function fps(page: Page, ms = 3000): Promise<number> {
  return page.evaluate(`new Promise((resolve) => {
    let frames = 0; const start = performance.now();
    const tick = () => { frames++; if (performance.now() - start < ${ms}) requestAnimationFrame(tick); else resolve(Math.round(frames * 1000 / (performance.now() - start))); };
    requestAnimationFrame(tick);
  })`);
}

async function scoreboard(page: Page) {
  await page.keyboard.down("Tab");
  await page.waitForTimeout(250);
  const rows = await page.locator(".scoreboard tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "")));
  await page.keyboard.up("Tab");
  return rows.map(([name, k, d]) => ({ name, kills: Number(k), deaths: Number(d) }));
}

async function enterMatch(page: Page) {
  await page.getByRole("button", { name: /ENTER MATCH/ }).first().waitFor({ timeout: 90000 });
  await page.getByRole("button", { name: /^ENTER MATCH/ }).click();
  await page.waitForFunction(() => !!document.pointerLockElement, { timeout: 10000 });
}

async function leave(page: Page) {
  await page.evaluate(() => document.exitPointerLock());
  await page.getByRole("button", { name: "RETURN TO LOBBY" }).click();
  await page.getByRole("button", { name: "QUICK PLAY" }).or(page.getByRole("tab", { name: "Quick play" })).first().waitFor();
}

async function main() {
  const url = process.argv[2] || "http://localhost:3000";
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const errors: string[] = [];
  const watch = (p: Page) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); }); };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page);
  const report: Record<string, unknown> = {};
  try {
    await page.goto(url);
    await page.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60000 });

    // 1. Quick play on Downtown: bots fill the match and fight on the city navmesh.
    await page.getByRole("tab", { name: "Quick play" }).click();
    assert.equal(await page.getByRole("radiogroup", { name: "Map" }).getByRole("radio").count(), 3, "every map is offered");
    await page.locator('[data-map="downtown"]').click();
    assert.equal(await page.locator('[data-map="downtown"]').getAttribute("aria-checked"), "true");
    await page.getByRole("button", { name: "QUICK PLAY" }).click();
    await enterMatch(page);
    await page.waitForTimeout(9000); // warmup respawn
    assert.match(await page.locator('[aria-label="Minimap"]').innerText(), /DOWNTOWN/);
    const startRows = await scoreboard(page);
    assert.ok(startRows.length >= 8, `quick play fills the match with bots (${startRows.length})`);
    // The public room lists its map in the browser.
    const viewer = await browser.newPage();
    watch(viewer);
    await viewer.goto(url);
    await viewer.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60000 });
    await viewer.getByRole("tab", { name: "Join room", exact: true }).click();
    await viewer.locator(".room-row", { hasText: "Downtown" }).first().waitFor({ timeout: 15000 });
    await viewer.close();
    // Move and shoot.
    await page.keyboard.down("KeyW"); await page.waitForTimeout(1500); await page.keyboard.up("KeyW");
    const ammo = page.locator(".ammo strong");
    const before = parseInt(await ammo.innerText());
    await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
    assert.ok(parseInt(await ammo.innerText()) < before, "firing works on Downtown");
    report.downtownFps = await fps(page);
    await page.screenshot({ path: `${OUT}/map-downtown.png` });
    // Bots must navigate the city and find fights.
    await page.waitForTimeout(40000);
    const rows = await scoreboard(page);
    const kills = rows.reduce((n, r) => n + (r.kills || 0), 0);
    report.downtownKillsIn50s = kills;
    assert.ok(kills > 0, "bots fight on Downtown");
    await leave(page);
    console.log("Downtown quick play passed", report);

    // 1b. Quick play on the Freight Yard: bots use its navmesh (and the trailer-top stairs).
    await page.getByRole("tab", { name: "Quick play" }).click();
    await page.locator('[data-map="industrial"]').click();
    await page.getByRole("button", { name: "QUICK PLAY" }).click();
    await enterMatch(page);
    await page.waitForTimeout(9000);
    assert.match(await page.locator('[aria-label="Minimap"]').innerText(), /FREIGHT YARD/);
    assert.ok((await scoreboard(page)).length >= 8, "bots fill the Freight Yard match");
    await page.keyboard.down("KeyW"); await page.waitForTimeout(1500); await page.keyboard.up("KeyW");
    const yardAmmo = parseInt(await ammo.innerText());
    await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
    assert.ok(parseInt(await ammo.innerText()) < yardAmmo, "firing works on the Freight Yard");
    report.freightYardFps = await fps(page);
    await page.screenshot({ path: `${OUT}/map-industrial.png` });
    await page.waitForTimeout(40000);
    const yardKills = (await scoreboard(page)).reduce((n, r) => n + (r.kills || 0), 0);
    report.freightYardKillsIn50s = yardKills;
    assert.ok(yardKills > 0, "bots fight on the Freight Yard");
    await leave(page);
    console.log("Freight Yard quick play passed", report);

    // 2. Custom room: host switches the map in the waiting room; a friend sees it; both load it.
    await page.getByRole("tab", { name: "With friends" }).click();
    await page.getByRole("button", { name: /Custom/ }).first().click();
    await page.locator('[data-map="village"]').click();
    await page.getByLabel("Private room").check();
    await page.getByRole("button", { name: /CREATE CUSTOM ROOM/ }).click();
    await page.locator(".room-heading", { hasText: "Village" }).waitFor({ timeout: 30000 });
    await page.locator('.room-map [data-map="downtown"]').click();
    await page.locator(".room-heading", { hasText: "Downtown" }).waitFor({ timeout: 10000 });
    const invite = await page.getByLabel("Invite link", { exact: true }).inputValue();
    const peer = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    watch(peer);
    await peer.goto(invite);
    await peer.getByLabel("CALLSIGN", { exact: true }).fill("Second Ranger");
    await peer.getByRole("button", { name: /JOIN ROOM/ }).click();
    await peer.locator(".room-heading", { hasText: "Downtown" }).waitFor({ timeout: 30000 });
    assert.ok(await peer.locator('.room-map [data-map="village"]').isDisabled(), "only the host can change the map");
    await page.locator('.room-map [data-map="village"]').click();
    await peer.locator(".room-heading", { hasText: "Village" }).waitFor({ timeout: 10000 });
    await page.locator('.room-map [data-map="downtown"]').click();
    await peer.locator(".room-heading", { hasText: "Downtown" }).waitFor({ timeout: 10000 });
    await peer.getByRole("button", { name: "READY UP" }).click();
    await page.getByRole("button", { name: "READY UP" }).click();
    // Custom TDM without bots needs even teams.
    const blue = page.locator(".team-blue .player-slot.occupied");
    if (await blue.count() !== 1) await page.locator(".team-blue").getByRole("button", { name: "Join team" }).click().catch(() => {});
    await page.getByRole("button", { name: /START MATCH/ }).click({ timeout: 15000 });
    await enterMatch(page);
    await enterMatch(peer);
    await page.waitForTimeout(3000);
    assert.match(await page.locator('[aria-label="Minimap"]').innerText(), /DOWNTOWN/);
    assert.match(await peer.locator('[aria-label="Minimap"]').innerText(), /DOWNTOWN/);
    await peer.close();
    await leave(page);
    console.log("Custom room map switch passed");

    // 3. The village still plays.
    await page.getByRole("tab", { name: "Quick play" }).click();
    await page.locator('[data-map="village"]').click();
    await page.getByRole("button", { name: "QUICK PLAY" }).click();
    await enterMatch(page);
    await page.waitForTimeout(3000);
    assert.match(await page.locator('[aria-label="Minimap"]').innerText(), /VILLAGE/);
    report.villageFps = await fps(page);
    await page.screenshot({ path: `${OUT}/map-village.png` });
    await leave(page);

    const unexpected = errors.filter((e) => !/WebGL|GPU stall|Clock: This module/i.test(e));
    assert.deepEqual(unexpected, [], "no browser errors");
    console.log(JSON.stringify({ passed: true, ...report }));
  } catch (error) {
    console.error("Browser errors:", errors);
    await page.screenshot({ path: `${OUT}/map-test-failure.png` }).catch(() => {});
    console.error("Visible UI:", (await page.locator("body").innerText().catch(() => "")).slice(0, 1500));
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
