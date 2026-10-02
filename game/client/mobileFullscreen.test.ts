import { afterEach, describe, expect, it, vi } from "vitest";
import { enterMobileFullscreen, exitMobileFullscreen } from "./mobileFullscreen";

afterEach(() => vi.unstubAllGlobals());

describe("mobile fullscreen", () => {
  it("requests fullscreen before locking landscape", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const lock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("document", { fullscreenElement: null });
    vi.stubGlobal("screen", { orientation: { lock } });
    expect(await enterMobileFullscreen({ requestFullscreen } as unknown as HTMLElement)).toBe("");
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect(lock).toHaveBeenCalledWith("landscape");
    expect(requestFullscreen.mock.invocationCallOrder[0]).toBeLessThan(lock.mock.invocationCallOrder[0]);
  });

  it("handles browsers without fullscreen and rejected requests", async () => {
    vi.stubGlobal("document", { fullscreenElement: null });
    const lock = vi.fn();
    vi.stubGlobal("screen", { orientation: { lock } });
    expect(await enterMobileFullscreen({} as HTMLElement)).toContain("unavailable");
    expect(await enterMobileFullscreen({ requestFullscreen: vi.fn().mockRejectedValue(new Error("denied")) } as unknown as HTMLElement)).toContain("blocked");
    expect(lock).not.toHaveBeenCalled();
  });

  it("keeps fullscreen usable when orientation locking fails", async () => {
    vi.stubGlobal("document", { fullscreenElement: {} });
    vi.stubGlobal("screen", { orientation: { lock: vi.fn().mockRejectedValue(new Error("unsupported")) } });
    expect(await enterMobileFullscreen({} as HTMLElement)).toContain("Rotate your phone");
  });

  it("supports prefixed fullscreen and releases orientation on exit", async () => {
    const webkitRequestFullscreen = vi.fn().mockResolvedValue(undefined);
    const webkitExitFullscreen = vi.fn();
    const unlock = vi.fn();
    const doc = { webkitFullscreenElement: null as object | null, webkitExitFullscreen };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("screen", { orientation: { unlock } });
    expect(await enterMobileFullscreen({ webkitRequestFullscreen } as unknown as HTMLElement)).toBe("");
    expect(webkitRequestFullscreen).toHaveBeenCalledOnce();
    doc.webkitFullscreenElement = {};
    await exitMobileFullscreen();
    expect(unlock).toHaveBeenCalledOnce();
    expect(webkitExitFullscreen).toHaveBeenCalledOnce();
  });
});
