// Usage: npx tsx scripts/dev/lineup-test.ts [webBase] [gameServer] [screenshotDir]
import { chromium, type Page } from "playwright-core";
import { Client, type Room } from "@colyseus/sdk";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Every name tag stays inside the stage and no two tags cover each other. */
async function checkTags(page: Page, count: number, label: string) {
  const report = await page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>("[data-stage-players] [data-mode]")!;
    // A squeezed stage (phone portrait) shows only the characters; the roster lists carry the names.
    if (getComputedStyle(layer).display === "none") return { count: layer.children.length, overlaps: [], outside: [], grouped: true, mode: "hidden" };
    const stage = document.querySelector("[data-stage-players]")!.getBoundingClientRect();
    const tags = [...document.querySelectorAll<HTMLElement>("[data-stage-players] [data-team]")].map((tag) => {
      const box = tag.querySelector("strong")!.getBoundingClientRect();
      return { team: Number(tag.dataset.team), name: tag.innerText, x: box.left + box.width / 2, box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom } };
    });
    const overlaps: string[] = [];
    tags.forEach((a, i) => tags.slice(i + 1).forEach((b) => {
      const w = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const h = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (w > 1 && h > 1) overlaps.push(`${a.name} / ${b.name}`);
    }));
    const outside = tags.filter(({ box }) => box.left < stage.left - 1 || box.right > stage.right + 1 || box.top < stage.top - 1 || box.bottom > stage.bottom + 1).map((t) => t.name);
    const blue = tags.filter((t) => t.team === 1).map((t) => t.x), red = tags.filter((t) => t.team === 2).map((t) => t.x);
    const grouped = !blue.length || !red.length || Math.max(...blue) < Math.min(...red);
    return { count: tags.length, overlaps, outside, grouped, mode: layer.dataset.mode };
  });
  assert.equal(report.count, count, `${label}: one tag per player`);
  assert.deepEqual(report.overlaps, [], `${label}: name tags do not overlap`);
  assert.deepEqual(report.outside, [], `${label}: name tags stay on the stage`);
  assert.ok(report.grouped, `${label}: Blue stands left of Red`);
  return report.mode;
}

async function main() {
  const shots = process.argv[4] || "out/qa";
  mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript("window.__name = (f) => f");
  const server = process.argv[3] || "ws://localhost:2567";
  const port = new URL(server).port;
  if (port && port !== "2567") {
    // The page always dials :2567 on its own host; send it to the server under test instead.
    const moved = (url: string) => url.replace(/:\/\/localhost:2567\//, `://localhost:${port}/`);
    await page.route(/:\/\/localhost:2567\//, async (route) => route.fulfill({ response: await route.fetch({ url: moved(route.request().url()) }) }));
    // routeWebSocket rejects the SDK's non-string protocols argument, so rewrite the socket URL in the page.
    await page.addInitScript(`{ const Native = WebSocket; window.WebSocket = new Proxy(Native, { construct: (target, [url, ...rest]) => new target(String(url).replace("://localhost:2567/", "://localhost:${port}/"), ...rest) }); }`);
  }
  const client = new Client(server);
  const peers: Room[] = [];
  const errors: string[] = [];
  const modes: Record<string, string | undefined> = {};
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") console.warn("[page]", message.text()); });
  const stage = page.getByRole("region", { name: "Lobby character stage", exact: true });
  const add = async (from: number, to: number) => {
    for (let i = from; i <= to; i++) {
      const peer = await client.joinById(code, { name: i === 7 ? "Commander Longcallsign" : `Ranger ${i}`, char: i % 2 });
      peer.onMessage("*", () => {}); peers.push(peer);
    }
  };
  const ready = async (players: number) => {
    await page.locator(`[data-stage-players="${players}"][data-stage-status="ready"]`).waitFor({ timeout: 60_000 });
    await page.locator(`[data-lineup-size="${players}"]`).waitFor();
    // Let newcomers instantiate and the tags settle after the last resize.
    await page.waitForTimeout(1200);
  };
  const fitsPhone = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight);
  let code = "";
  try {
    await page.goto(process.argv[2] || "http://localhost:3000");
    await page.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60_000 });
    await page.getByLabel("CALLSIGN", { exact: true }).fill("Lineup Host");
    await page.getByRole("tab", { name: "With friends" }).click();
    await page.getByRole("button", { name: /Custom Your rules/ }).click();
    await page.getByRole("radio", { name: "20 players", exact: true }).click();
    await page.getByRole("button", { name: "CREATE CUSTOM ROOM" }).click();
    const invite = await page.getByLabel("Invite link", { exact: true }).inputValue();
    code = new URL(invite).searchParams.get("room")!;

    await add(1, 5);
    await ready(6);
    for (let i = 1; i <= 5; i++) assert.ok((await stage.innerText()).toLowerCase().includes(`ranger ${i}`));
    assert.ok((await stage.innerText()).toLowerCase().includes("· you"), "The local player is marked");
    await page.screenshot({ path: join(shots, "lineup-6-desktop.png") });
    modes.six = await checkTags(page, 6, "six players");

    await add(6, 11);
    await ready(12);
    await page.screenshot({ path: join(shots, "lineup-12-desktop.png") });
    modes.twelve = await checkTags(page, 12, "twelve players");

    await add(12, 19);
    await ready(20);
    assert.equal(await page.getByRole("button", { name: /Next players|Previous players/ }).count(), 0, "No pager: everyone is on stage together");
    const text = (await stage.innerText()).toLowerCase();
    for (let i = 1; i <= 19; i++) if (i !== 7) assert.ok(text.includes(`ranger ${i}`), `Ranger ${i} is on stage`);
    assert.ok(text.includes("commander"), "Long callsigns are shortened, not dropped");
    await page.screenshot({ path: join(shots, "lineup-20-desktop.png") });
    await stage.screenshot({ path: join(shots, "lineup-20-desktop-stage.png") });
    modes.twentyDesktop = await checkTags(page, 20, "twenty players, desktop");

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, "lineup-20-phone-landscape.png") });
    await stage.screenshot({ path: join(shots, "lineup-20-phone-landscape-stage.png") });
    modes.twentyPhone = await checkTags(page, 20, "twenty players, phone landscape");
    assert.ok(await fitsPhone(), "Phone landscape has no page scroll");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, "lineup-20-phone-portrait.png") });
    modes.twentyPortrait = await checkTags(page, 20, "twenty players, phone portrait");
    assert.ok(await fitsPhone(), "Phone portrait has no page scroll");

    await page.setViewportSize({ width: 1600, height: 900 });
    for (const peer of peers.splice(5)) await peer.leave();
    await ready(6);
    modes.shrunk = await checkTags(page, 6, "roster shrinks back to six");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, modes, checks: ["six in one row", "twelve in two rows", "twenty together, no pager", "tags inside stage, no overlaps", "Blue left of Red", "phone landscape and portrait fit", "roster shrinks safely"] }));
  } catch (error) {
    await page.screenshot({ path: join(shots, "lineup-failure.png") }).catch(() => {});
    throw error;
  } finally { await Promise.all(peers.map((peer) => peer.leave().catch(() => {}))); await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
