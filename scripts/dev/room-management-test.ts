import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    if (location.protocol === "http:" || location.protocol === "https:") localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false }));
  });
  const errors: string[] = [];
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  const host = await context.newPage();
  const url = process.argv[2] || "http://localhost:3001";
  mkdirSync("out/qa", { recursive: true });
  try {
    await host.goto(url);
    await host.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60000 });
    await host.getByLabel("CALLSIGN", { exact: true }).fill("Host");
    await host.getByRole("tab", { name: "With friends" }).click();
    await host.getByRole("button", { name: /^Custom/ }).click();
    await host.getByRole("button", { name: /CREATE.*ROOM/ }).click();
    await host.getByRole("button", { name: "READY UP", exact: true }).waitFor();
    const invite = await host.getByLabel("Invite link", { exact: true }).inputValue();
    async function join(name: string) {
      const page = await context.newPage();
      await page.goto(invite);
      await page.getByLabel("CALLSIGN", { exact: true }).fill(name);
      await page.getByRole("button", { name: "JOIN ROOM →", exact: true }).click();
      await page.getByRole("button", { name: "READY UP", exact: true }).waitFor();
      return page;
    }
    const guest = await join("Guest");
    const third = await join("Third");
    await host.getByRole("button", { name: "Manage Third", exact: true }).waitFor();
    assert.equal(await guest.getByRole("button", { name: "Room settings", exact: true }).count(), 0);
    assert.equal(await guest.getByRole("button", { name: /^Manage / }).count(), 0);
    const thirdSlot = host.locator(".player-slot.occupied").filter({ hasText: "Third" });
    await thirdSlot.dragTo(host.getByRole("region", { name: "Red team", exact: true }).locator(".team-heading"));
    await host.getByRole("region", { name: "Red team", exact: true }).getByRole("button", { name: "Manage Third" }).waitFor();
    await host.getByRole("button", { name: "Room settings", exact: true }).click();
    const settings = host.getByRole("dialog");
    await settings.getByLabel("Room size", { exact: true }).selectOption("4");
    await settings.getByLabel("Score to win", { exact: true }).selectOption("200");
    await settings.getByLabel("Room name", { exact: true }).fill("Managed room");
    await settings.getByRole("button", { name: "Save room settings" }).click();
    await guest.getByRole("heading", { name: "Managed room", exact: true }).waitFor();
    assert.match(await guest.locator(".room-heading").innerText(), /First to 200/);
    assert.equal(await guest.locator(".player-slot").count(), 4);
    await guest.getByRole("button", { name: "Edit your player" }).click();
    await guest.getByRole("dialog").getByLabel("Your name", { exact: true }).fill("Renamed");
    await guest.getByRole("button", { name: "Save name", exact: true }).click();
    await host.getByRole("button", { name: "Manage Renamed", exact: true }).waitFor();
    // The move control works without dragging, including on a narrow touch layout.
    await host.setViewportSize({ width: 390, height: 844 });
    await host.getByRole("button", { name: "Manage Third", exact: true }).click();
    await host.getByRole("button", { name: "Move to Blue team", exact: true }).click();
    await host.getByRole("region", { name: "Blue team", exact: true }).getByRole("button", { name: "Manage Third" }).waitFor();
    assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile room must fit horizontally");
    await host.screenshot({ path: "out/qa/room-management-mobile.png", fullPage: true });
    await host.setViewportSize({ width: 1440, height: 1000 });
    const fourth = await join("Fourth");
    await host.getByRole("button", { name: "Manage Fourth", exact: true }).waitFor();
    await host.locator(".player-slot.occupied").filter({ hasText: "Third" }).dragTo(host.locator(".player-slot.occupied").filter({ hasText: "Fourth" }));
    await host.getByRole("region", { name: "Red team", exact: true }).getByRole("button", { name: "Manage Third" }).waitFor();
    await host.getByRole("region", { name: "Blue team", exact: true }).getByRole("button", { name: "Manage Fourth" }).waitFor();
    await host.getByRole("button", { name: "Manage Renamed", exact: true }).click();
    await host.getByRole("button", { name: "Make room host", exact: true }).click();
    await host.getByRole("button", { name: "Transfer host", exact: true }).click();
    await guest.getByRole("button", { name: "Room settings", exact: true }).waitFor();
    await host.getByRole("button", { name: "Room settings", exact: true }).waitFor({ state: "detached" });
    await guest.getByRole("button", { name: "Manage Host", exact: true }).click();
    await guest.getByRole("button", { name: "Kick player", exact: true }).click();
    await guest.getByRole("button", { name: "Confirm kick", exact: true }).click();
    await host.getByText("You were removed from the room by the host.", { exact: true }).waitFor();
    await guest.getByRole("button", { name: "Manage Host", exact: true }).waitFor({ state: "detached" });
    await host.getByRole("button", { name: /Leave room/ }).click();
    await host.getByRole("tab", { name: "With friends" }).waitFor();
    await guest.screenshot({ path: "out/qa/room-management-desktop.png", fullPage: true });
    await guest.getByRole("button", { name: /Leave room/ }).click();
    await guest.getByRole("tab", { name: "With friends" }).waitFor();
    assert.equal(await guest.getByLabel("CALLSIGN", { exact: true }).inputValue(), "Renamed");
    await third.getByRole("button", { name: /Leave room/ }).click();
    await fourth.getByRole("button", { name: /Leave room/ }).click();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["host-only controls", "drag between teams", "full-team drag swap", "room resize", "200-point target", "rename replication and persistence", "mobile move button", "host transfer", "kick and exit"], errors }));
  } catch (error) {
    console.error(await host.locator("body").innerText());
    await host.screenshot({ path: "out/qa/room-management-failure.png", fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
