import { chromium, type Page } from "playwright-core";
import { Client, type Room } from "@colyseus/sdk";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import type { Game } from "../../game/client/core/game";

type TestWindow = Window & { __loadoutGame?: Game };

async function capture(page: Page) {
  await page.getByRole("navigation", { name: "Quick weapons" }).evaluate((element) => {
    type Fiber = { memoizedProps?: { game?: Game }; return?: Fiber };
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
    let fiber = (element as unknown as Record<string, Fiber>)[key];
    while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return!;
    (window as TestWindow).__loadoutGame = fiber.memoizedProps!.game;
  });
}

async function main() {
  mkdirSync("out/qa", { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const base = process.argv[2] || "http://localhost:3000";
  let peer: Room | undefined;
  let activePage: Page | undefined;
  try {
    for (const mobile of [true, false]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      activePage = page;
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base);
      await page.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60000 });
      await page.locator(".lobby-panel .settings-details summary").click();
      await page.getByLabel("QUALITY").selectOption("low");
      await page.getByRole("button", { name: /CREATE 1V1 ROOM/ }).click();
      const invite = await page.getByLabel("Invite link", { exact: true }).inputValue();
      peer = await new Client("ws://localhost:2567").joinById(new URL(invite).searchParams.get("room")!, { name: "Loadout QA peer" });
      peer.onMessage("*", () => {});
      peer.send("ready", true);
      await page.getByRole("button", { name: "READY UP", exact: true }).click();
      await page.getByRole("button", { name: /START MATCH/ }).click();
      if (!mobile) await page.getByRole("button", { name: /ENTER MATCH/ }).click({ timeout: 90000 });
      await page.getByRole("navigation", { name: "Quick weapons" }).waitFor({ timeout: 90000 });
      await capture(page);
      await page.waitForFunction(() => (window as TestWindow).__loadoutGame?.room.state.phase === "live", undefined, { timeout: 30000 });
      await page.waitForFunction(() => (window as TestWindow).__loadoutGame?.input.enabled);
      if (mobile) await page.getByRole("button", { name: "Open loadout and scopes" }).tap();
      else await page.keyboard.press("b");
      const panel = page.getByRole("dialog", { name: "Your gun. Your sights." });
      await panel.waitFor();
      assert.equal(await page.locator(".modal-shade").count(), 0, "Loadout must not stack the pause menu");
      assert.equal(await page.evaluate(() => (window as TestWindow).__loadoutGame!.input.fire), false);
      await panel.getByRole("button", { name: "Choose Vector SMG", exact: true }).click();
      await page.waitForFunction(() => {
        const game = (window as TestWindow).__loadoutGame!;
        return game.local?.weapon === "smg" && game.room.state.players.get(game.room.sessionId)?.primary === "smg";
      });
      await panel.getByRole("button", { name: "Attach 2× scope to Vector SMG", exact: true }).click();
      assert.equal(await panel.getByRole("button", { name: "Attach 2× scope to Vector SMG", exact: true }).getAttribute("aria-pressed"), "true");
      await page.screenshot({ path: `out/qa/loadout-${mobile ? "mobile" : "desktop"}.png` });
      await panel.getByRole("button", { name: /BACK TO MATCH/ }).click();
      await page.waitForFunction(() => (window as TestWindow).__loadoutGame!.input.enabled);
      if (mobile) {
        await page.getByRole("button", { name: "Equip Sidearm", exact: true }).tap();
        await page.waitForFunction(() => (window as TestWindow).__loadoutGame!.local!.weapon === "pistol");
        await page.getByRole("button", { name: "Equip Vector SMG", exact: true }).tap();
      } else {
        await page.keyboard.press("2");
        await page.waitForFunction(() => (window as TestWindow).__loadoutGame!.local!.weapon === "pistol");
        await page.keyboard.press("1");
      }
      await page.waitForFunction(() => (window as TestWindow).__loadoutGame!.local!.weapon === "smg");
      await page.waitForTimeout(400);
      // Exercise actual predicted fire and server ammo acknowledgments without moving the view.
      await page.evaluate(() => { const game = (window as TestWindow).__loadoutGame!; game.input.setAction("ads", true); game.input.setAction("fire", true); });
      await page.waitForTimeout(450);
      await page.evaluate(() => (window as TestWindow).__loadoutGame!.input.setAction("fire", false));
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => (window as TestWindow).__loadoutGame!.local!.scoped), true);
      const ammo = await page.evaluate(() => (window as TestWindow).__loadoutGame!.local!.ammo.smg.mag);
      assert.ok(ammo < 32 && ammo > 0, "Firing the newly equipped gun must consume ammo");
      await page.screenshot({ path: `out/qa/scope-${mobile ? "mobile" : "desktop"}.png` });
      if (mobile) await page.getByRole("button", { name: "Open loadout and scopes" }).tap();
      else await page.keyboard.press("b");
      await panel.getByRole("button", { name: "Choose AK Rifle", exact: true }).click();
      await page.waitForFunction(() => (window as TestWindow).__loadoutGame!.local!.primary === "ar");
      await panel.getByRole("button", { name: "Choose Vector SMG", exact: true }).click();
      await page.waitForFunction(() => (window as TestWindow).__loadoutGame!.local!.primary === "smg");
      assert.equal(await page.evaluate(() => (window as TestWindow).__loadoutGame!.local!.ammo.smg.mag), ammo, "Swapping guns must not refill ammunition");
      await panel.getByRole("button", { name: "Choose Hunter Sniper", exact: true }).click();
      await page.waitForFunction(() => (window as TestWindow).__loadoutGame!.local!.primary === "sniper");
      await panel.getByRole("button", { name: "Attach 4× scope to Hunter Sniper", exact: true }).click();
      await panel.getByRole("button", { name: /BACK TO MATCH/ }).click();
      if (mobile) {
        await page.evaluate(() => { const game = (window as TestWindow).__loadoutGame!; game.input.setAction("fire", true); game.input.setAction("ads", true); });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("dialog", { name: "Landscape required" }).waitFor();
        await page.waitForFunction(() => {
          const input = (window as TestWindow).__loadoutGame!.input;
          return !input.enabled && !input.fire && !input.ads;
        });
        assert.equal(await page.getByLabel("Mobile game controls", { exact: true }).count(), 0);
        await page.screenshot({ path: "out/qa/mobile-rotate-prompt.png" });
        for (const viewport of [{ width: 844, height: 390 }, { width: 568, height: 320 }, { width: 640, height: 360 }]) {
          await page.setViewportSize(viewport);
          await page.waitForTimeout(180);
          await page.waitForFunction(() => (window as TestWindow).__loadoutGame!.input.enabled);
          assert.equal(await page.getByRole("dialog", { name: "Landscape required" }).count(), 0);
          const bounds = await page.getByRole("navigation", { name: "Quick weapons" }).evaluate((nav) => {
            const bar = nav.getBoundingClientRect();
            const other = [...document.querySelectorAll('[aria-label="Mobile game controls"] button, [aria-label="Change graphics quality"]')].map((button) => ({ label: button.getAttribute("aria-label"), rect: button.getBoundingClientRect() }));
            return { inside: bar.left >= 0 && bar.right <= innerWidth && bar.top >= 0 && bar.bottom <= innerHeight,
              overlaps: other.filter(({ rect }) => rect.left < bar.right && rect.right > bar.left && rect.top < bar.bottom && rect.bottom > bar.top).map(({ label }) => label) };
          });
          assert.ok(bounds.inside);
          assert.deepEqual(bounds.overlaps, [], `Weapon bar must not cover touch actions at ${viewport.width}px`);
        }
        await page.screenshot({ path: "out/qa/loadout-compact-hud.png" });
      } else {
        await page.waitForFunction(() => (window as TestWindow).__loadoutGame!.input.enabled);
        await page.keyboard.press("b");
        await panel.waitFor();
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "hidden" });
      }
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("hollowmere.optics.v1")!));
      assert.equal(saved.smg, "2x");
      assert.equal(saved.sniper, "4x");
      assert.deepEqual(errors, []);
      console.log(`${mobile ? "Mobile" : "Desktop"}: immediate gun swaps, quick slots, scope ADS, ammo preservation, saved optics and layout passed`);
      await peer.leave(); peer = undefined;
      await context.close();
    }
  } catch (error) {
    await activePage?.screenshot({ path: "out/qa/loadout-failure.png" }).catch(() => {});
    throw error;
  } finally { await peer?.leave(); await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
