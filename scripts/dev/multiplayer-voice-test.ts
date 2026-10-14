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
    await host.getByLabel("CALLSIGN", { exact: true }).fill("Voice Host");
    await host.getByRole("button", { name: /Custom Your rules/ }).click();
    await host.getByRole("combobox", { name: /ROOM SIZE/ }).selectOption("20");
    await host.getByRole("radio", { name: /Downtown/ }).click();
    await host.getByRole("button", { name: "CREATE CUSTOM ROOM" }).click();
    await host.getByRole("button", { name: "READY UP", exact: true }).waitFor();
    assert.equal(await host.locator(".player-slot").count(), 20);
    const invite = await host.getByLabel("Invite link", { exact: true }).inputValue();
    for (const [page, name] of [[blue, "Voice Blue"], [red, "Voice Red"]] as const) {
      await page.goto(invite);
      await page.getByLabel("CALLSIGN", { exact: true }).fill(name);
      await page.getByLabel("Join team", { exact: true }).selectOption("2");
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
    for (const page of pages) {
      await page.getByRole("button", { name: "VOICE OFF", exact: true }).waitFor({ timeout: 90_000 });
      assert.equal(await page.evaluate(() => (window as TestWindow).voiceStreams.length), 0, "Microphone is opt-in");
      await page.getByRole("button", { name: "VOICE OFF", exact: true }).click();
      await page.getByRole("button", { name: "JOIN VOICE", exact: true }).click();
      await page.getByRole("button", { name: "LEAVE VOICE", exact: true }).waitFor();
    }
    for (const page of pages) await waitUntil(() => page.evaluate(() => (window as TestWindow).voiceConnections.filter((pc) => pc.connectionState === "connected").length === 2), 45_000);
    assert.equal(await enabledTracks(host), 0, "Microphone starts silent");
    await host.bringToFront();
    await host.keyboard.down("n");
    await waitUntil(async () => await enabledTracks(host) === 1);
    await blue.getByText("Voice Host (team)", { exact: true }).waitFor();
    assert.equal(await red.getByText("Voice Host (team)", { exact: true }).count(), 0, "Opponents do not see Team transmissions");
    await waitUntil(async () => await receivedEnergy(blue) > 0);
    assert.equal(await receivedEnergy(red), 0, "Team audio is silent for opponents");
    await host.keyboard.up("n");
    assert.equal(await enabledTracks(host), 0);
    await host.getByLabel("Voice channel", { exact: true }).selectOption("all");
    await host.getByRole("button", { name: "Hold to talk", exact: true }).focus();
    await host.keyboard.down("n");
    await waitUntil(async () => await enabledTracks(host) === 2);
    await red.getByText("Voice Host (all)", { exact: true }).waitFor();
    await waitUntil(async () => await receivedEnergy(red) > 0);
    await host.keyboard.up("n");
    const talk = host.getByRole("button", { name: "Hold to talk", exact: true });
    const talkBounds = (await talk.boundingBox())!;
    await host.mouse.move(talkBounds.x + talkBounds.width / 2, talkBounds.y + talkBounds.height / 2);
    await host.mouse.down();
    await waitUntil(async () => await enabledTracks(host) === 2);
    await talk.dispatchEvent("pointercancel", { pointerId: 1 });
    await host.mouse.up();
    assert.equal(await enabledTracks(host), 0, "Cancelling touch releases transmission");
    await host.getByRole("button", { name: "Mute mic", exact: true }).click();
    await host.keyboard.down("n");
    assert.equal(await enabledTracks(host), 0, "Mic mute blocks push-to-talk");
    await host.keyboard.up("n");
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
    await host.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); }; });
    await host.getByRole("button", { name: "JOIN VOICE", exact: true }).click();
    await host.getByRole("alert").filter({ hasText: "Microphone permission was denied" }).waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["20-slot lobby", "Join team transfer", "open slot pointer and keyboard transfer", "readiness preserved", "uneven 2v1 start", "microphone opt-in", "three-way WebRTC audio packets", "Team routing", "All routing", "push-to-talk release", "touch cancel", "mic mute", "player mute", "microphone cleanup", "permission denied"] }));
  } catch (error) {
    for (const page of pages) console.error(await page.evaluate(() => (window as TestWindow).voiceConnections.map((pc) => ({ connection: pc.connectionState, ice: pc.iceConnectionState, signaling: pc.signalingState, local: pc.localDescription?.type, remote: pc.remoteDescription?.type }))));
    console.error(await host.locator("body").innerText());
    await host.screenshot({ path: "out/qa/voice-failure.png" }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
