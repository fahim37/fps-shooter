import { chromium, type Page } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

type TestWindow = Window & typeof globalThis & { voiceConnections: RTCPeerConnection[]; voiceStreams: MediaStream[] };
async function waitUntil(check: () => Promise<boolean>, timeout = 20_000) {
  const start = Date.now();
  while (!await check()) {
    if (Date.now() - start > timeout) throw new Error("Timed out waiting for voice");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function enabledTracks(page: Page) {
  return page.evaluate(() => (window as TestWindow).voiceConnections.filter((pc) => pc.connectionState !== "closed").flatMap((pc) => pc.getSenders()).filter((s) => s.track?.enabled).length);
}
async function receivedEnergy(page: Page) {
  return page.evaluate(async () => {
    const reports = await Promise.all((window as TestWindow).voiceConnections.filter((pc) => pc.connectionState === "connected").map((pc) => pc.getStats()));
    return reports.flatMap((report) => [...report.values()]).filter((entry) => entry.type === "inbound-rtp" && entry.kind === "audio").reduce((sum, entry) => sum + (entry.totalAudioEnergy ?? 0), 0);
  });
}

async function main() {
  mkdirSync("out/qa", { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["microphone"] });
  await context.addInitScript("window.__name = (f) => f");
  const gamePort = process.env.GAME_SERVER_PORT;
  // Point the page at a game server on another local port, e.g. a fresh server while another session holds 2567.
  if (gamePort) await context.addInitScript((port: string) => {
    const fix = (url: string) => url.replace(/:2567(?=\/|$)/, `:${port}`);
    const NativeSocket = WebSocket;
    window.WebSocket = class extends NativeSocket { constructor(url: string | URL, protocols?: string | string[]) { super(fix(String(url)), protocols); } };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => nativeFetch(typeof input === "string" || input instanceof URL ? fix(String(input)) : input, init);
    const open = XMLHttpRequest.prototype.open as (this: XMLHttpRequest, ...args: unknown[]) => void;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) { open.call(this, method, fix(String(url)), ...rest); } as typeof XMLHttpRequest.prototype.open;
  }, gamePort);
  await context.addInitScript((forceRelay: boolean) => {
    localStorage.setItem("hollowmere.settings.v1", JSON.stringify({ quality: "low", adaptiveResolution: false }));
    const w = window as TestWindow;
    w.voiceConnections = []; w.voiceStreams = [];
    const Native = RTCPeerConnection;
    w.RTCPeerConnection = class extends Native {
      constructor(config?: RTCConfiguration) { super({ ...config, ...(forceRelay ? { iceTransportPolicy: "relay" as const } : {}) }); w.voiceConnections.push(this); }
      setConfiguration(config: RTCConfiguration) { super.setConfiguration({ ...config, ...(forceRelay ? { iceTransportPolicy: "relay" as const } : {}) }); }
    };
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => { const stream = await getMedia(constraints); w.voiceStreams.push(stream); return stream; };
  }, process.env.VOICE_TEST_FORCE_RELAY === "1");
  const host = await context.newPage();
  const blue = await context.newPage();
  const red = await context.newPage();
  const pages = [host, blue, red];
  const errors: string[] = [];
  pages.forEach((page) => page.on("pageerror", (error) => errors.push(error.message)));
  try {
    await host.goto(process.argv[2] || "http://localhost:3000");
    await host.getByText("SERVER ONLINE", { exact: true }).waitFor({ timeout: 60_000 });
    await host.getByRole("button", { name: "How to play", exact: true }).click();
    const guide = host.getByRole("dialog", { name: "How to play" });
    for (const text of ["Team voice", "All voice"]) await guide.getByText(text).first().waitFor();
    await guide.screenshot({ path: "out/qa/how-to-play-voice.png" });
    await host.getByRole("button", { name: "Close how to play", exact: true }).click();
    await host.getByLabel("CALLSIGN", { exact: true }).fill("Voice Host");
    await host.getByRole("tab", { name: "With friends" }).click();
    await host.getByRole("button", { name: /Custom Your rules/ }).click();
    await host.getByRole("radio", { name: "20 players", exact: true }).click();
    await host.getByRole("radio", { name: /Downtown/ }).click();
    await host.getByRole("button", { name: "CREATE CUSTOM ROOM" }).click();
    await host.getByRole("button", { name: "READY UP", exact: true }).waitFor();
    assert.equal(await host.locator(".player-slot").count(), 20);
    const invite = await host.getByLabel("Invite link", { exact: true }).inputValue();
    for (const [page, name] of [[blue, "Voice Blue"], [red, "Voice Red"]] as const) {
      await page.goto(invite);
      await page.getByLabel("CALLSIGN", { exact: true }).fill(name);
      await page.getByRole("radio", { name: "Red team", exact: true }).click();
      await page.getByRole("button", { name: /JOIN ROOM/ }).click();
      await page.getByRole("button", { name: "READY UP", exact: true }).waitFor();
    }
    await blue.getByRole("button", { name: "READY UP", exact: true }).click();
    await blue.getByRole("region", { name: "Blue team", exact: true }).getByRole("button", { name: "Join team", exact: true }).click();
    await blue.locator(".team-blue .player-slot.is-me").waitFor();
    await blue.getByRole("button", { name: "CANCEL READY", exact: true }).waitFor();
    await blue.getByRole("button", { name: /Join Red team, open slot/ }).first().click();
    await blue.locator(".team-red .player-slot.is-me").waitFor();
    await blue.getByRole("button", { name: /Join Blue team, open slot/ }).first().focus();
    await blue.keyboard.press("Enter");
    await blue.locator(".team-blue .player-slot.is-me").waitFor();
    await blue.getByRole("button", { name: "CANCEL READY", exact: true }).waitFor();
    await host.getByRole("button", { name: "READY UP", exact: true }).click();
    await red.getByRole("button", { name: "READY UP", exact: true }).click();
    await waitUntil(() => host.getByRole("button", { name: "START MATCH" }).isEnabled());
    await host.screenshot({ path: "out/qa/room-20-players.png" });
    await host.getByRole("button", { name: "START MATCH" }).click();
    const bar = (page: Page) => page.getByRole("complementary", { name: "Voice chat" });
    const talking = (page: Page) => bar(page).getAttribute("data-talking");
    const voiceMode = (page: Page) => bar(page).getAttribute("data-voice");
    const icon = (page: Page, name: string) => bar(page).getByRole("button", { name, exact: true });
    for (const page of pages) {
      await bar(page).waitFor({ timeout: 90_000 });
      for (const name of ["Team voice", "All voice", "Open mic", "Voice settings"]) await icon(page, name).waitFor();
      assert.equal(await voiceMode(page), "off");
      assert.equal(await page.evaluate(() => (window as TestWindow).voiceStreams.length), 0, "Microphone is opt-in");
    }
    await host.screenshot({ path: "out/qa/voice-bar-off.png", clip: { x: 440, y: 0, width: 400, height: 170 } });
    // Holding N while voice is off enables it, then talks to the team once the microphone opens.
    await host.bringToFront();
    await host.keyboard.down("n");
    await waitUntil(async () => await talking(host) === "team");
    await host.keyboard.up("n");
    await waitUntil(async () => await talking(host) === "");
    // The mic button turns voice on with an open mic in one click; a second click goes back to push-to-talk.
    await icon(blue, "Open mic").click();
    await waitUntil(async () => await talking(blue) === "team");
    assert.equal(await icon(blue, "Open mic").getAttribute("aria-pressed"), "true");
    await icon(blue, "Open mic").click();
    await waitUntil(async () => await talking(blue) === "");
    // A tap of M enables voice but stays silent once the key is no longer held.
    await red.bringToFront();
    await red.keyboard.down("m");
    await red.keyboard.up("m");
    await waitUntil(async () => await voiceMode(red) === "on");
    assert.equal(await talking(red), "", "Released key does not transmit after joining");
    for (const page of pages) await waitUntil(() => page.evaluate(() => (window as TestWindow).voiceConnections.filter((pc) => pc.connectionState === "connected").length === 2), 45_000);
    assert.equal(await enabledTracks(host), 0, "Microphone starts silent");
    assert.equal(await enabledTracks(red), 0, "Tapped key leaves the microphone silent");
    await host.bringToFront();
    await host.keyboard.down("n");
    await waitUntil(async () => await enabledTracks(host) === 1);
    await blue.getByText("Voice Host (team)", { exact: true }).waitFor();
    assert.equal(await red.getByText("Voice Host (team)", { exact: true }).count(), 0, "Opponents do not see Team transmissions");
    await waitUntil(async () => await receivedEnergy(blue) > 0);
    assert.equal(await receivedEnergy(red), 0, "Team audio is silent for opponents");
    await host.keyboard.up("n");
    await waitUntil(async () => await enabledTracks(host) === 0);
    await host.keyboard.down("m");
    await waitUntil(async () => await enabledTracks(host) === 2);
    await red.getByText("Voice Host (all)", { exact: true }).waitFor();
    await waitUntil(async () => await receivedEnergy(red) > 0);
    await host.screenshot({ path: "out/qa/voice-bar-talking.png", clip: { x: 440, y: 0, width: 400, height: 170 } });
    // Pressing N while M is held narrows to Team; releasing N returns to All.
    await host.keyboard.down("n");
    await waitUntil(async () => await enabledTracks(host) === 1);
    await host.keyboard.up("n");
    await waitUntil(async () => await enabledTracks(host) === 2);
    await host.keyboard.up("m");
    await waitUntil(async () => await enabledTracks(host) === 0);
    // Holding the All icon talks to everyone; a cancelled touch releases it.
    const all = icon(host, "All voice");
    const allBounds = (await all.boundingBox())!;
    await host.mouse.move(allBounds.x + allBounds.width / 2, allBounds.y + allBounds.height / 2);
    await host.mouse.down();
    await waitUntil(async () => await enabledTracks(host) === 2);
    await all.dispatchEvent("pointercancel", { pointerId: 1 });
    await host.mouse.up();
    await waitUntil(async () => await enabledTracks(host) === 0);
    assert.equal(await all.getAttribute("aria-pressed"), "true", "The All icon becomes the selected channel");
    // Open mic transmits continuously on the selected channel; push-to-talk keys still override it.
    await icon(host, "Open mic").click();
    await waitUntil(async () => await enabledTracks(host) === 2);
    await host.keyboard.down("n");
    await waitUntil(async () => await enabledTracks(host) === 1);
    await host.keyboard.up("n");
    await waitUntil(async () => await enabledTracks(host) === 2);
    await host.screenshot({ path: "out/qa/voice-bar-open.png", clip: { x: 440, y: 0, width: 400, height: 170 } });
    await icon(host, "Team voice").click();
    await waitUntil(async () => await enabledTracks(host) === 1);
    assert.equal(await talking(host), "team", "Open mic follows the selected channel");
    await icon(host, "Open mic").click();
    await waitUntil(async () => await enabledTracks(host) === 0);
    await icon(host, "Voice settings").click();
    await host.getByRole("button", { name: "Mute Voice Red", exact: true }).click();
    assert.equal(await host.getByRole("button", { name: "Mute Voice Red", exact: true }).getAttribute("aria-pressed"), "true");
    await waitUntil(() => host.evaluate(async () => {
      const connected = (window as TestWindow).voiceConnections.filter((pc) => pc.connectionState === "connected");
      const stats = await Promise.all(connected.map((pc) => pc.getStats()));
      return stats.every((report) => [...report.values()].some((entry) => entry.type === "inbound-rtp" && entry.kind === "audio" && entry.packetsReceived > 0));
    }));
    await host.screenshot({ path: "out/qa/voice-chat.png" });
    await host.getByRole("button", { name: "LEAVE VOICE", exact: true }).click();
    assert.ok(await host.evaluate(() => (window as TestWindow).voiceStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended"))), "Leaving stops microphone capture");
    assert.equal(await host.locator("audio[data-voice-peer]").count(), 0);
    assert.equal(await icon(host, "Open mic").getAttribute("aria-pressed"), "false");
    await host.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { await new Promise((resolve) => setTimeout(resolve, 600)); throw new DOMException("Denied", "NotAllowedError"); }; });
    await icon(host, "Voice settings").click();
    await host.keyboard.press("n");
    await waitUntil(async () => await voiceMode(host) === "pending");
    assert.ok(await icon(host, "Open mic").isDisabled(), "Pending join cannot be repeated");
    await host.getByRole("alert").filter({ hasText: "Microphone permission was denied" }).waitFor();
    await waitUntil(async () => await voiceMode(host) === "off");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["20-slot lobby", "Join team transfer", "open slot pointer and keyboard transfer", "readiness preserved", "uneven 2v1 start", "microphone opt-in", "N enables and talks", "mic button enables open mic", "tapped key joins silently", "three-way WebRTC audio packets", "N Team routing", "M All routing", "N over M narrows to Team", "push-to-talk release", "icon hold and touch cancel", "open mic with key override", "open mic follows channel", "player mute", "microphone cleanup", "pending state", "permission denied"] }));
  } catch (error) {
    for (const page of pages) console.error(await page.evaluate(() => (window as TestWindow).voiceConnections.map((pc) => ({ connection: pc.connectionState, ice: pc.iceConnectionState, signaling: pc.signalingState, local: pc.localDescription?.type, remote: pc.remoteDescription?.type }))).catch((e: Error) => e.message));
    console.error(await host.locator("body").innerText());
    await host.screenshot({ path: "out/qa/voice-failure.png" }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
