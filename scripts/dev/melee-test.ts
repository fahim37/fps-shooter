import { chromium, type Page } from "playwright-core";
import { Client, type Room } from "@colyseus/sdk";
import type { MatchState } from "../../game/shared/schema";
import type { KillEvent, SwingEvent } from "../../game/shared/messages";
import type { Game } from "../../game/client/core/game";
import assert from "node:assert/strict";

// Real browser + authoritative peer: the blade in slot 3, a backstab kill, and changing blades.
// Usage: npx tsx scripts/dev/melee-test.ts [webBase] [gameServer]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 15000) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error("Melee state timed out"); await sleep(100); }
}

/** The page's Game, found through the HUD's React props. */
function game<T>(page: Page, read: (game: Game) => T) {
  return page.locator(".hud-layer").evaluate((element, body) => {
    type Fiber = { memoizedProps?: { game?: Game }; return?: Fiber };
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
    let fiber = (element as unknown as Record<string, Fiber>)[key];
    while (fiber && !fiber.memoizedProps?.game) fiber = fiber.return!;
    return new Function("game", `return (${body})(game)`)(fiber.memoizedProps!.game!);
  }, read.toString()) as Promise<T>;
}

async function main() {
  const base = process.argv[2] || "http://localhost:3107";
  const endpoint = new URL(process.argv[3] || "ws://localhost:2567");
  const client = new Client(endpoint.origin);
  // Both the web client and the test peer need to reach the same local server.
  const resolver = endpoint.hostname === "localhost" && endpoint.port !== "2567"
    ? [`--host-resolver-rules=MAP localhost:2567 127.0.0.1:${endpoint.port}`] : [];
  let room: Room<unknown, MatchState> | null = null;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: [...resolver, "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  try {
    room = await client.create<MatchState>("match", { name: "Blade Target", char: 0, create: { mode: "tdm", maxPlayers: 2, bots: 0, private: true, roomName: "Blade verification" } });
    const kills: KillEvent[] = [], swings: SwingEvent[] = [];
    room.onMessage("*", () => {});
    room.onMessage<KillEvent>("kill", (ev) => kills.push(ev));
    room.onMessage<SwingEvent>("swing", (ev) => swings.push(ev));
    await page.addInitScript(() => localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false })));
    await page.goto(`${base}/?room=${room.roomId}`);
    // The lobby shifts as it loads: let it settle so the click lands on Join, not the help button beside it.
    const join = page.getByRole("button", { name: /JOIN (THIS )?ROOM/ });
    await join.waitFor({ timeout: 90000 });
    await sleep(2500);
    if (await page.locator('[class*="HowToPlay"]').count()) await page.keyboard.press("Escape");
    await join.click();
    await page.getByRole("button", { name: "PLAY IN A WINDOW" }).waitFor({ timeout: 90000 });
    await until(() => room!.state.phase === "live", 30000);
    await page.getByRole("button", { name: "PLAY IN A WINDOW" }).click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    await sleep(2500);
    const me = () => [...room!.state.players.entries()].find(([id]) => id !== room!.sessionId)!;

    // Slot 3 brings out the butterfly knife, on the server too.
    await page.keyboard.press("Digit3");
    await until(() => me()[1].weapon === "knife");
    assert.equal(await game(page, (g) => g.local!.weapon), "knife");
    await page.locator(".ammo", { hasText: "Butterfly Knife" }).waitFor({ timeout: 3000 });
    await sleep(500);
    await page.screenshot({ path: ".next/melee-knife.png" });

    // Inspect plays without trouble.
    await page.keyboard.press("KeyT");
    await sleep(200);
    assert.ok(await game(page, (g) => g.local!.sinceInspect(performance.now()) >= 0 && !g.local!.emoteMenu));
    await page.screenshot({ path: ".next/melee-inspect.png" });

    // A second press is queued and plays once the first trick (the long showcase) is done.
    await page.keyboard.press("KeyT");
    await sleep(2400);
    assert.equal(await game(page, (g) => g.local!.trick), 1);

    // The peer stands just ahead, its back turned: one stab from behind kills through the shield.
    await sleep(1600);
    await game(page, (g) => { g.input.consumeLook(); g.local!.pitch = 0; g.local!.updateView(); });
    const player = me()[1];
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    room.send("pose", { x: player.x + fx * 1.4, y: player.y, z: player.z + fz * 1.4, yaw: player.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, flags: 8, weapon: "ar" });
    await sleep(700);
    await page.mouse.down({ button: "left" });
    await sleep(80);
    await page.mouse.up({ button: "left" });
    await page.getByText("YOU ELIMINATED").waitFor();
    assert.match(await page.locator(".announcement").innerText(), /BACKSTAB/);
    await page.screenshot({ path: ".next/melee-backstab.png" });
    await until(() => kills.some((k) => k.weapon === "knife" && k.victim === room!.sessionId));
    assert.ok(swings.some((s) => s.weapon === "knife" && s.hit === room!.sessionId && s.backstab), "the peer heard a backstab");

    // Choosing the katana in the loadout puts it straight in hand, and it is remembered.
    await page.keyboard.press("KeyB");
    await page.getByRole("button", { name: "Choose Katana" }).click();
    await until(() => me()[1].melee === "katana" && me()[1].weapon === "katana");
    assert.equal(await page.evaluate(() => localStorage.getItem("hollowmere.melee.v1")), "katana");
    await page.getByRole("button", { name: "Close loadout" }).click();
    await sleep(800);
    assert.equal(await game(page, (g) => g.local!.weapon), "katana");
    await page.screenshot({ path: ".next/melee-katana.png" });

    await page.keyboard.press("KeyT");
    await sleep(1050);
    const presented = await game(page, (g) => {
      const rig = g["fpp"]!;
      const tip = rig.muzzle.clone().project(g.camera);
      const pommel = rig.gunToWorld([0, 0, 0.234], rig.muzzle.clone()).project(g.camera);
      return {
        active: rig.object.visible && g.local!.sinceInspect(performance.now()) >= 0,
        inFrame: [tip, pommel].every((p) => Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1),
        width: Math.abs(tip.x - pommel.x) / 2,
      };
    });
    assert.ok(presented.active && presented.inFrame && presented.width > 0.34,
      `First-person katana presentation: ${JSON.stringify(presented)}`);
    await page.screenshot({ path: ".next/melee-katana-inspect.png" });

    await page.mouse.click(640, 400, { button: "right" });
    await until(() => swings.some((s) => s.weapon === "katana" && s.blow === "heavy"));
    assert.equal(await game(page, (g) => g.local!.heavy), true);

    // The wheel runs through all three slots.
    await page.mouse.wheel(0, 120);
    await sleep(200);
    assert.equal(await game(page, (g) => g.local!.weapon), "ar");

    await page.keyboard.press("KeyT");
    await sleep(100);
    assert.equal(await game(page, (g) => g.local!.emoteMenu), false);

    if (errors.length) console.error("Browser errors:", errors);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["slot 3 equips the knife", "T cycles knife tricks", "backstab kill credited to the knife", "katana chosen and remembered", "T inspects the katana in first person", "right-click heavy replicated", "wheel cycles to the primary"] }));
  } catch (error) {
    console.error("Browser errors:", errors);
    await page.screenshot({ path: ".next/melee-test-failure.png" }).catch(() => {});
    throw error;
  } finally { await browser.close(); await room?.leave(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
