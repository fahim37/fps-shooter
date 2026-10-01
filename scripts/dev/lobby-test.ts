import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

async function main() {
  mkdirSync("out/qa", { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false })));
  const errors: string[] = [];
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  const host = await context.newPage();
  const url = process.argv[2] || "http://localhost:3000";
  try {
    await host.goto(url);
    await host.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60000 });
    await host.screenshot({ path: "out/qa/lobby-desktop.png", fullPage: true });
    await host.getByLabel("CALLSIGN", { exact: true }).fill("Host Ranger");
    await host.getByRole("button", { name: "CREATE 1V1 ROOM" }).click();
    await host.getByRole("button", { name: "READY UP", exact: true }).waitFor();
    assert.equal(await host.locator("canvas").count(), 0, "Staging must not load the 3D scene");
    assert.ok(await host.getByRole("button", { name: "START MATCH" }).isDisabled());
    const invite = await host.getByLabel("Invite link", { exact: true }).inputValue();
    await host.getByRole("button", { name: "READY UP", exact: true }).click();
    await host.getByRole("button", { name: "CANCEL READY", exact: true }).waitFor();
    const guest = await context.newPage();
    await guest.goto(invite);
    await guest.getByLabel("CALLSIGN", { exact: true }).fill("Guest Ranger");
    await guest.getByRole("button", { name: "JOIN ROOM →", exact: true }).click();
    await guest.getByRole("button", { name: "READY UP", exact: true }).waitFor();
    await host.getByRole("button", { name: "READY UP", exact: true }).waitFor();
    assert.equal(await host.locator(".player-slot.occupied").count(), 2);
    assert.equal(await guest.getByRole("button", { name: "START MATCH" }).count(), 0);
    await host.screenshot({ path: "out/qa/room-desktop.png", fullPage: true });
    await host.waitForTimeout(8500);
    assert.equal(await host.locator("canvas").count(), 0, "Waiting rooms must never auto-start");
    await guest.getByRole("button", { name: "READY UP", exact: true }).click();
    await host.getByRole("button", { name: "READY UP", exact: true }).click();
    await host.waitForFunction(() => !(document.querySelector(".room-start .primary-button:last-child") as HTMLButtonElement)?.disabled);
    await host.getByRole("button", { name: "START MATCH" }).click();
    await host.getByRole("button", { name: "ENTER MATCH" }).waitFor({ timeout: 90000 });
    await guest.getByRole("button", { name: "ENTER MATCH" }).waitFor({ timeout: 90000 });
    assert.match(await host.locator(".match-mode").innerText(), /Team Deathmatch/);
    await host.waitForFunction(() => document.querySelector(".match-mode small")?.textContent?.includes("LIVE"), undefined, { timeout: 20000 });
    await guest.getByRole("button", { name: "RETURN TO LOBBY" }).click();
    await host.getByRole("button", { name: "RETURN TO LOBBY" }).click();
    await host.getByRole("tab", { name: "With friends" }).waitFor();

    await host.getByRole("tab", { name: "Join room", exact: true }).click();
    await host.getByLabel("Room code", { exact: true }).fill("ZZZZZ");
    await host.getByRole("button", { name: "JOIN ROOM →", exact: true }).click();
    await host.locator(".error-text").waitFor();
    assert.match(await host.locator(".error-text").innerText(), /doesn't exist/);
    await host.getByRole("tab", { name: "With friends" }).click();
    await host.getByRole("button", { name: /2v2 Doubles/ }).click();
    await host.getByLabel("Private room").uncheck();
    await host.getByRole("button", { name: "CREATE 2V2 ROOM" }).click();
    await host.getByRole("button", { name: "READY UP", exact: true }).waitFor();
    await guest.getByRole("button", { name: "No bots", exact: true }).click();
    await guest.getByRole("button", { name: "Refresh", exact: false }).click();
    await guest.locator(".room-row").filter({ hasText: "Host Ranger's room" }).click();
    await guest.getByRole("button", { name: "READY UP", exact: true }).waitFor();
    assert.equal(await guest.locator(".player-slot").count(), 4);
    await guest.getByRole("button", { name: "Leave room", exact: false }).click();
    await host.getByRole("button", { name: "Leave room", exact: false }).click();

    await host.setViewportSize({ width: 390, height: 844 });
    await host.screenshot({ path: "out/qa/lobby-mobile.png", fullPage: true });
    assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile home should not overflow horizontally");
    await host.getByRole("button", { name: "CREATE 2V2 ROOM" }).click();
    await host.getByRole("button", { name: "READY UP", exact: true }).waitFor();
    await host.screenshot({ path: "out/qa/room-mobile.png", fullPage: true });
    assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile room should not overflow horizontally");
    await host.getByRole("button", { name: "Leave room", exact: false }).click();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["create duel", "invite join", "ready reset", "no auto-start", "host start", "enter game", "invalid code", "public 2v2 browser", "mobile layouts"], errors }));
  } catch (error) {
    console.error(await host.locator("body").innerText());
    await host.screenshot({ path: "out/qa/lobby-failure.png", fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
