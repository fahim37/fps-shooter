// In-match emotes (T, then a number) and the C grenade, in a real browser against a live server.
// Usage: npx tsx scripts/dev/emote-test.ts [webBase]
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

async function main() {
  const url = process.argv[2] || "http://localhost:3000";
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  try {
    await page.goto(url);
    await page.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60000 });
    await page.getByLabel("FILL MATCH TO").selectOption("0");
    await page.getByLabel("Private room").check();
    await page.getByRole("button", { name: "CREATE TEAM DEATHMATCH" }).click();
    await page.getByRole("button", { name: "ENTER MATCH" }).waitFor({ timeout: 90000 });
    await page.getByRole("button", { name: "ENTER MATCH" }).click();
    await page.waitForFunction(() => !!document.pointerLockElement, { timeout: 10000 });
    await page.waitForTimeout(9000); // Let warmup respawn finish.

    const menu = page.getByRole("menu", { name: "Emotes" });
    const hint = page.getByRole("status").filter({ hasText: "MOVE OR SHOOT TO STOP" });
    await page.keyboard.press("KeyT");
    await menu.waitFor({ timeout: 2000 });
    await page.screenshot({ path: ".next/emote-menu.png" });
    await page.keyboard.press("Digit1");
    await hint.waitFor({ timeout: 2000 });
    assert.equal(await menu.count(), 0, "Picking an emote closes the menu");
    assert.match(await hint.innerText(), /DANCE/);
    assert.match(await page.locator(".ammo").innerText(), /Assault|AK|Rifle/i, "Picking an emote must not switch weapons");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: ".next/emote-dance.png" });

    // Moving ends it and the gun comes back.
    await page.keyboard.down("KeyW"); await page.waitForTimeout(300); await page.keyboard.up("KeyW");
    await hint.waitFor({ state: "detached", timeout: 2000 });

    // T then T closes the menu without emoting; numbers switch weapons again.
    await page.keyboard.press("KeyT"); await menu.waitFor({ timeout: 2000 });
    await page.keyboard.press("KeyT"); await menu.waitFor({ state: "detached", timeout: 2000 });
    await page.keyboard.press("Digit2"); await page.waitForTimeout(650);
    assert.match(await page.locator(".ammo").innerText(), /Sidearm/i);

    // Firing ends an emote without firing a shot while the gun is put away.
    await page.keyboard.press("KeyT"); await page.keyboard.press("Digit3");
    await hint.waitFor({ timeout: 2000 });
    const ammo = page.locator(".ammo strong");
    const before = parseInt(await ammo.innerText());
    await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
    await hint.waitFor({ state: "detached", timeout: 2000 });
    assert.equal(parseInt(await ammo.innerText()), before, "The click that ends an emote does not fire");

    // C throws a grenade and no longer crouches.
    await page.keyboard.down("KeyC"); await page.waitForTimeout(400); await page.keyboard.up("KeyC");
    await page.waitForTimeout(350);
    assert.match(await page.locator(".ammo").innerText(), /1 GRENADES/);

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["T opens the menu", "1 dances", "moving ends it", "T closes", "digits switch weapons again", "click ends without firing", "C throws a grenade"] }));
  } catch (error) {
    console.error("Browser errors:", errors);
    await page.screenshot({ path: ".next/emote-test-failure.png" }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
