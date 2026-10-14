import { chromium } from "playwright-core";
import { Client, type Room } from "@colyseus/sdk";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

async function main() {
  mkdirSync("out/qa", { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const client = new Client(process.argv[3] || "ws://localhost:2567");
  const peers: Room[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(process.argv[2] || "http://localhost:3000");
    await page.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60_000 });
    await page.getByLabel("CALLSIGN", { exact: true }).fill("Lineup Host");
    await page.getByRole("button", { name: /Custom Your rules/ }).click();
    await page.getByRole("combobox", { name: /ROOM SIZE/ }).selectOption("20");
    await page.getByRole("button", { name: "CREATE CUSTOM ROOM" }).click();
    const invite = await page.getByLabel("Invite link", { exact: true }).inputValue();
    const code = new URL(invite).searchParams.get("room")!;
    for (let i = 1; i <= 5; i++) {
      const peer = await client.joinById(code, { name: `Ranger ${i}`, char: i % 2 });
      peer.onMessage("*", () => {}); peers.push(peer);
    }
    await page.locator('[data-stage-players="6"][data-stage-status="ready"]').waitFor({ timeout: 60_000 });
    assert.equal(await page.getByRole("button", { name: "Next players", exact: true }).count(), 0, "Six players appear together without paging");
    const stage = page.getByRole("region", { name: "Lobby character stage", exact: true });
    for (let i = 1; i <= 5; i++) assert.ok((await stage.innerText()).toLowerCase().includes(`ranger ${i}`));
    await page.screenshot({ path: "out/qa/lineup-six-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: "out/qa/lineup-six-mobile.png" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
    await page.setViewportSize({ width: 1440, height: 1000 });
    const seventh = await client.joinById(code, { name: "Seventh Ranger", char: 0 });
    seventh.onMessage("*", () => {}); peers.push(seventh);
    await page.getByRole("button", { name: "Next players", exact: true }).click();
    await page.locator('[data-stage-players="1"][data-stage-status="ready"]').waitFor();
    assert.ok((await stage.innerText()).toLowerCase().includes("seventh ranger"));
    await seventh.leave();
    await page.locator('[data-stage-players="6"][data-stage-status="ready"]').waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["six characters together", "all six names", "mobile fits", "larger-room pagination", "roster shrinks safely"] }));
  } finally { await Promise.all(peers.map((peer) => peer.leave().catch(() => {}))); await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
