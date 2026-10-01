import { chromium, type Locator } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import type { Game } from "../../game/client/core/game";

type TestWindow = Window & { __mobileTestGame?: Game; __mobileTestEvents?: { type: string; id: number; target: string | null }[] };
type Point = { x: number; y: number };

async function main() {
  const base = process.argv[2] || "http://localhost:3100";
  mkdirSync("out/qa", { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const contacts = new Map<number, Point>();
  const controls = page.getByLabel("Mobile game controls", { exact: true });
  const action = (name: string) => controls.getByRole("button", { name, exact: true });

  async function center(locator: Locator): Promise<Point> {
    const box = await locator.boundingBox();
    assert.ok(box, "The touch target must be visible");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  async function dispatch(type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel") {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: [...contacts].map(([id, point]) => ({ id, ...point, radiusX: 4, radiusY: 4, force: 1 })),
    });
  }
  async function down(id: number, point: Point) { contacts.set(id, point); await dispatch("touchStart"); }
  async function move(id: number, point: Point) { contacts.set(id, point); await dispatch("touchMove"); }
  async function up(id: number) {
    const point = contacts.get(id)!;
    // Modern Chromium's synthetic pointer backend releases the listed contact IDs.
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ id, ...point, radiusX: 4, radiusY: 4, force: 1 }] });
    contacts.delete(id);
  }
  async function cancel() { contacts.clear(); await dispatch("touchCancel"); }
  async function tap(locator: Locator) { await down(99, await center(locator)); await up(99); }

  async function state() {
    return page.evaluate(() => {
      const game = (window as TestWindow).__mobileTestGame!;
      const local = game.local!;
      return {
        alive: local.alive, touch: game.input.touch, enabled: game.input.enabled,
        fire: game.input.fire, adsHeld: game.input.ads, ads: local.ads,
        crouch: game.input.crouch, sprint: game.input.sprint, stick: game.input.stick,
        x: local.ms.x, y: local.ms.y, z: local.ms.z, yaw: local.yaw, pitch: local.pitch,
        mag: local.ammo[local.weapon].mag, grenades: local.grenades, reloading: local.reloading,
      };
    });
  }

  async function captureGame() {
    // Read the component's existing Game prop; no product debug hook is necessary.
    await controls.evaluate((element) => {
      type Fiber = { memoizedProps?: { game?: Game }; return?: Fiber };
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
      let fiber = (element as unknown as Record<string, Fiber>)[key];
      while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return!;
      (window as TestWindow).__mobileTestGame = fiber.memoizedProps!.game;
      (window as TestWindow).__mobileTestEvents = [];
      for (const type of ["pointerdown", "pointerup", "pointercancel", "lostpointercapture", "click"]) document.addEventListener(type, (event) => {
        const pointer = event as PointerEvent;
        (window as TestWindow).__mobileTestEvents!.push({ type, id: pointer.pointerId, target: (pointer.target as Element).closest("[aria-label]")?.getAttribute("aria-label") ?? null });
      }, true);
    });
  }

  async function createMatch() {
    await page.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60000 });
    await page.getByLabel("FILL MATCH TO").selectOption("0");
    await page.getByLabel("Private room", { exact: true }).check();
    await page.getByRole("button", { name: "CREATE TEAM DEATHMATCH", exact: true }).tap();
    await controls.waitFor({ timeout: 90000 });
    await captureGame();
  }

  async function inspectLayout() {
    const circles = await controls.evaluate((element) => [...element.querySelectorAll("button, [aria-label='Movement joystick']")].map((target) => {
      const rect = target.getBoundingClientRect();
      return { label: target.getAttribute("aria-label"), x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: getComputedStyle(target).borderRadius };
    }));
    const viewport = page.viewportSize()!;
    assert.ok(circles.length >= 13, "Both fire buttons, joystick and all utility buttons must be present");
    for (const circle of circles) {
      assert.ok(circle.x >= -1 && circle.y >= -1 && circle.x + circle.width <= viewport.width + 1 && circle.y + circle.height <= viewport.height + 1, `${circle.label} is outside the viewport`);
      assert.ok(Math.abs(circle.width - circle.height) < 1, `${circle.label} should be circular`);
      assert.ok(circle.radius === "50%" || parseFloat(circle.radius) >= circle.width / 2, `${circle.label} should have a round outline`);
    }
    return circles;
  }

  try {
    await page.goto(base);
    await page.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60000 });
    await page.getByLabel("FILL MATCH TO").selectOption("0");
    await page.getByLabel("Private room", { exact: true }).check();
    await page.locator(".lobby-panel .settings-details summary").tap();
    await page.getByLabel("QUALITY").selectOption("low");
    await page.getByRole("button", { name: "CREATE TEAM DEATHMATCH", exact: true }).tap();
    await controls.waitFor({ timeout: 90000 });
    await captureGame();
    await page.waitForFunction(() => (window as TestWindow).__mobileTestGame?.room.state.phase === "live", undefined, { timeout: 20000 });
    await page.waitForTimeout(400);
    assert.equal((await state()).touch, true, "Mobile emulation must activate touch controls");
    await inspectLayout();
    await page.screenshot({ path: "out/qa/mobile-landscape.png" });
    console.log("Landscape circles fit the screen");

    // Four simultaneous contacts exercise independent movement, look, ADS and fire ownership.
    const joystick = await center(controls.getByLabel("Movement joystick", { exact: true }));
    const look = { x: 422, y: 188 };
    const aim = await center(action("Aim"));
    const fire = await center(action("Fire / aim"));
    const before = await state();
    await down(1, joystick);
    await move(1, { x: joystick.x + 18, y: joystick.y - 35 });
    await down(2, look);
    await down(3, aim);
    await down(4, fire);
    await move(2, { x: look.x + 35, y: look.y - 8 });
    await page.waitForTimeout(450);
    const during = await state();
    assert.ok(during.stick && Math.hypot(during.stick.x, during.stick.y) > 0.5, "The movement thumb must stay active while aiming and firing");
    assert.ok(Math.hypot(during.x - before.x, during.z - before.z) > 0.1, "Dragging the joystick must move the character");
    assert.ok(Math.abs(during.yaw - before.yaw) > 0.03, "The other thumb must turn the view independently");
    assert.ok(during.adsHeld && during.ads > 0.9 && during.fire && during.mag < before.mag, "ADS and firing must work together");
    await up(3);
    await page.waitForTimeout(80);
    assert.equal((await state()).adsHeld, false, "Lifting ADS must release only ADS");
    assert.equal((await state()).fire, true, "Fire must remain held by its own contact");
    await up(4); await up(2); await up(1);
    await page.waitForTimeout(300);
    const released = await state();
    assert.equal(released.fire, false); assert.equal(released.stick, null); assert.equal(released.ads, 0);
    console.log("Simultaneous movement, view, ADS and fire released independently");

    // Both fire controls can be held without one release cancelling the other.
    await down(5, await center(action("Fire")));
    await down(6, fire);
    const dragStart = await state();
    await move(6, { x: fire.x - 32, y: fire.y + 9 });
    await page.waitForTimeout(100);
    assert.ok(Math.abs((await state()).yaw - dragStart.yaw) > 0.03, "The right fire thumb must also aim");
    await up(5);
    assert.equal((await state()).fire, true, "Lifting left fire must preserve right fire");
    await up(6);
    assert.equal((await state()).fire, false);
    await down(7, aim);
    const aimStart = await state();
    await move(7, { x: aim.x + 24, y: aim.y - 5 });
    await page.waitForTimeout(100);
    assert.ok(Math.abs((await state()).yaw - aimStart.yaw) > 0.02, "The ADS thumb must also aim");
    await cancel();
    assert.equal((await state()).adsHeld, false, "Touch cancellation must release ADS");

    await action("Reload").tap();
    await page.waitForTimeout(100);
    assert.equal((await state()).reloading, true);
    await page.waitForFunction(() => !(window as TestWindow).__mobileTestGame?.local?.reloading, undefined, { timeout: 5000 });
    assert.equal((await state()).mag, 30, "Touch reload must refill the rifle");
    await action("Crouch").tap();
    assert.equal((await state()).crouch, true);
    assert.equal(await action("Crouch").getAttribute("aria-pressed"), "true");
    await action("Sprint").tap();
    assert.equal((await state()).sprint, true); assert.equal((await state()).crouch, false);
    await action("Crouch").tap();
    assert.equal((await state()).crouch, true); assert.equal((await state()).sprint, false);
    await action("Crouch").tap();
    assert.equal((await state()).crouch, false);

    const grenadeCount = (await state()).grenades;
    await down(8, await center(action("Grenade")));
    await page.waitForTimeout(250);
    await up(8);
    await page.waitForTimeout(180);
    assert.equal((await state()).grenades, grenadeCount - 1, "Holding then releasing grenade must throw one grenade");
    console.log("Fire reference counting, aim drags, reload, toggles and grenade passed");

    await down(9, fire);
    await tap(action("Scores"));
    await page.locator(".scoreboard").waitFor();
    assert.equal((await state()).fire, false, "Opening scores must release shooting");
    assert.equal(await action("Close scores").count(), 1);
    assert.equal(await action("Pause").count(), 1);
    assert.equal(await action("Fire").count(), 0, "Gameplay buttons must stay hidden over scores");
    await up(9);
    await action("Close scores").tap();
    await page.locator(".scoreboard").waitFor({ state: "hidden" });
    await controls.getByLabel("Movement joystick", { exact: true }).waitFor();
    await down(10, fire);
    await tap(action("Pause"));
    await page.getByRole("button", { name: "ENTER MATCH" }).waitFor();
    assert.equal((await state()).fire, false); assert.equal((await state()).stick, null);
    await up(10);
    await page.getByRole("button", { name: "ENTER MATCH" }).tap();
    await controls.waitFor();
    await page.waitForTimeout(150);
    assert.equal((await state()).fire, false, "Resuming must not retain a finger held before pause");

    const graphics = page.getByRole("button", { name: "Change graphics quality", exact: true });
    const graphicsBefore = await graphics.innerText();
    await graphics.tap();
    await page.waitForTimeout(250);
    assert.notEqual(await graphics.innerText(), graphicsBefore, "Graphics must change live on touch");
    assert.equal(await page.locator(".modal-shade").count(), 0, "Changing graphics must keep the match running");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await inspectLayout();
    await page.screenshot({ path: "out/qa/mobile-portrait.png" });
    console.log("Scores, pause release, live graphics and portrait circles passed");

    const portraitDefault = await center(controls.getByLabel("Movement joystick", { exact: true }));
    const editor = page.getByLabel("Control layout editor", { exact: true });
    await action("Customize controls").tap();
    await editor.waitFor();
    await page.waitForTimeout(150);
    const editingState = await state();
    assert.equal(editingState.enabled, false, "Control editing must pause gameplay input");
    const editorStick = controls.locator('[data-control-id="joystick"]');
    const editStart = await center(editorStick);
    assert.ok(Math.abs(editStart.x - portraitDefault.x) < 1 && Math.abs(editStart.y - portraitDefault.y) < 1, "The editor must preview the same default positions used during gameplay");
    await tap(editor.getByRole("button", { name: "Collapse editor", exact: true }));
    await down(20, editStart);
    await move(20, { x: editStart.x + 35, y: editStart.y - 25 });
    await up(20);
    const movedStick = await center(editorStick);
    assert.ok(movedStick.x - editStart.x > 25 && editStart.y - movedStick.y > 15, "Dragging in edit mode must reposition the joystick");
    assert.equal((await state()).stick, null, "Moving a control in the editor must not move the player");
    await tap(editor.getByRole("button", { name: "Expand editor", exact: true }));
    const size = editor.getByLabel("Selected control size", { exact: true });
    await size.waitFor({ timeout: 3000 });
    await size.press("End");
    await editor.getByLabel("Control opacity", { exact: true }).press("Home");
    const editFire = controls.locator('[data-control-id="rightFire"]');
    const fireStart = await center(editFire);
    await down(21, fireStart);
    await move(21, { x: fireStart.x - 30, y: fireStart.y - 18 });
    await up(21);
    await size.press("ArrowRight"); await size.press("ArrowRight");
    assert.equal((await state()).fire, false, "Dragging fire in the editor must not shoot");
    await page.screenshot({ path: "out/qa/mobile-control-editor.png" });
    await editor.getByRole("button", { name: "Save & play", exact: true }).tap();
    await editor.waitFor({ state: "hidden" });
    await page.waitForTimeout(200);
    const savedText = await page.evaluate(() => localStorage.getItem("hollowmere.mobile-controls.v1"));
    assert.ok(savedText, "Save & play must write device storage");
    const saved = JSON.parse(savedText);
    assert.equal(saved.version, 1);
    assert.equal(saved.opacity, 0.25);
    assert.equal(saved.controls.portrait.joystick.size, 1.4);
    assert.ok(saved.controls.portrait.rightFire.size > 1);
    assert.deepEqual(saved.controls.landscape, {}, "Portrait edits must keep landscape placement independent");
    const savedStick = await center(controls.getByLabel("Movement joystick", { exact: true }));
    assert.ok(Math.abs(savedStick.x - movedStick.x) < 2 && Math.abs(savedStick.y - movedStick.y) < 2);
    assert.equal((await state()).enabled, true, "Save & play must resume input");
    console.log("Control positions, individual size and opacity saved on device");

    await page.reload();
    await createMatch();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => localStorage.getItem("hollowmere.mobile-controls.v1")), savedText, "The saved layout must survive a fresh page load");
    const restoredStick = await center(controls.getByLabel("Movement joystick", { exact: true }));
    assert.ok(Math.abs(restoredStick.x - savedStick.x) < 2 && Math.abs(restoredStick.y - savedStick.y) < 2, "A new match must render the saved joystick position");
    const restoredBox = await controls.getByLabel("Movement joystick", { exact: true }).boundingBox();
    assert.ok(restoredBox && restoredBox.width > 160, "The saved joystick size must be restored");
    await action("Customize controls").tap();
    await editor.waitFor();
    await editor.getByRole("button", { name: "Reset layout", exact: true }).tap();
    await editor.getByRole("button", { name: "Save & play", exact: true }).tap();
    await editor.waitFor({ state: "hidden" });
    const resetStick = await center(controls.getByLabel("Movement joystick", { exact: true }));
    assert.ok(Math.abs(resetStick.x - portraitDefault.x) < 2 && Math.abs(resetStick.y - portraitDefault.y) < 2, "Reset must restore the default portrait placement");
    const resetText = await page.evaluate(() => localStorage.getItem("hollowmere.mobile-controls.v1"));
    assert.deepEqual(JSON.parse(resetText!).controls.portrait, {});
    await action("Customize controls").tap();
    await editor.waitFor();
    const previewDefault = await center(controls.getByLabel("Movement joystick", { exact: true }));
    assert.ok(Math.abs(previewDefault.x - resetStick.x) < 1 && Math.abs(previewDefault.y - resetStick.y) < 1);
    await editor.getByLabel("Selected control size", { exact: true }).press("End");
    const previewSized = await controls.getByLabel("Movement joystick", { exact: true }).boundingBox();
    assert.ok(previewSized);
    await editor.getByRole("button", { name: "Save & play", exact: true }).tap();
    await editor.waitFor({ state: "hidden" });
    const liveSized = await controls.getByLabel("Movement joystick", { exact: true }).boundingBox();
    assert.ok(liveSized);
    assert.ok(Math.abs(liveSized.x - previewSized.x) < 1 && Math.abs(liveSized.y - previewSized.y) < 1 && Math.abs(liveSized.width - previewSized.width) < 1, "Saving size alone must keep preview and live control geometry identical");
    const resizedText = await page.evaluate(() => localStorage.getItem("hollowmere.mobile-controls.v1"));
    await action("Customize controls").tap();
    await editor.waitFor();
    await editor.getByLabel("Control opacity", { exact: true }).press("End");
    await editor.getByRole("button", { name: "Cancel changes", exact: true }).tap();
    await editor.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => localStorage.getItem("hollowmere.mobile-controls.v1")), resizedText, "Cancelling edits must preserve the saved layout");
    console.log("Reload persistence, reset and cancel changes passed");

    // Oversized edge placements must stay reachable when the same orientation shrinks.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(200);
    await action("Customize controls").tap();
    await editor.waitFor();
    const edgeStick = await center(controls.locator('[data-control-id="joystick"]'));
    await down(22, edgeStick); await move(22, { x: 2, y: 2 }); await up(22);
    await editor.getByLabel("Selected control size", { exact: true }).press("End");
    const edgeFire = await center(controls.locator('[data-control-id="rightFire"]'));
    await down(23, edgeFire); await move(23, { x: 842, y: 388 }); await up(23);
    await editor.getByLabel("Selected control size", { exact: true }).press("End");
    await editor.getByRole("button", { name: "Save & play", exact: true }).tap();
    await editor.waitFor({ state: "hidden" });
    for (const viewport of [{ width: 844, height: 390 }, { width: 640, height: 360 }, { width: 568, height: 320 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(180);
      await inspectLayout();
    }
    await page.screenshot({ path: "out/qa/mobile-compact-landscape.png" });
    console.log("Large edge controls stay in bounds at 844, 640 and 568 pixel widths");
    assert.deepEqual(errors, []);
    await action("Pause").tap();
    await page.getByRole("button", { name: "RETURN TO LOBBY" }).tap();
    console.log(JSON.stringify({ passed: true, checks: ["mobile landscape and portrait bounds", "four-contact movement / look / ADS / fire", "independent release", "both fire reference count", "right-fire and ADS drag aim", "touch cancel", "reload", "crouch / sprint", "grenade", "scores close", "pause reset", "live graphics", "control drag / size / opacity", "editing pauses gameplay", "save on device and restore after reload", "orientation independence", "reset and cancel", "editor preview equals live geometry", "collapsible editor", "large edge controls at 844 / 640 / 568 widths"], errors }));
  } catch (error) {
    console.error("Mobile browser errors:", errors);
    console.error("Pointer events:", await page.evaluate(() => (window as TestWindow).__mobileTestEvents?.slice(-35)).catch(() => []));
    console.error("Visible UI:", await page.locator("body").innerText().catch(() => "unavailable"));
    await page.screenshot({ path: "out/qa/mobile-test-failure.png" }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
