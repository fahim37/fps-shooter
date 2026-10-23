import { describe, expect, it } from "vitest";
import { parseUserAgent } from "./ua";
import { clientIp, isPrivateIp, normalizeIp } from "./ip";
import { sanitizePlayerId } from "./recorder";
import { dayKey, dayKeys, safeTimeZone, startOfDay, weekHour } from "./stats";
import { flagEmoji } from "../../game/shared/adminApi";

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  opera: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0",
  headless: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
};

describe("user agent parsing", () => {
  it.each([
    ["chromeWin", "Chrome", "141.0", "Windows", "desktop"],
    ["edge", "Edge", "141.0", "Windows", "desktop"],
    ["safariIphone", "Safari", "18.5", "iOS", "mobile"],
    ["chromeAndroid", "Chrome", "141.0", "Android", "mobile"],
    ["androidTablet", "Chrome", "141.0", "Android", "tablet"],
    ["ipad", "Safari", "17.0", "iPadOS", "tablet"],
    ["firefoxMac", "Firefox", "131.0", "macOS", "desktop"],
    ["firefoxLinux", "Firefox", "131.0", "Linux", "desktop"],
    ["samsung", "Samsung Internet", "26.0", "Android", "mobile"],
    ["chromeIos", "Chrome", "141.0", "iOS", "mobile"],
    ["opera", "Opera", "124.0", "Windows", "desktop"],
    ["headless", "Headless Chrome", "141.0", "Linux", "bot"],
  ] as const)("%s", (key, browser, version, os, device) => {
    expect(parseUserAgent(UA[key])).toEqual({ browser, browserVersion: version, os, device });
  });

  it("copes with missing or junk input", () => {
    expect(parseUserAgent(undefined)).toEqual({ browser: "Unknown", browserVersion: "", os: "Unknown", device: "unknown" });
    expect(parseUserAgent("curl/8.4.0").device).toBe("desktop");
    expect(parseUserAgent(42).browser).toBe("Unknown");
  });
});

describe("client addresses", () => {
  it("prefers nginx's X-Real-IP, then the proxy-added forwarded hop, then the socket", () => {
    expect(clientIp({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1, 203.0.113.9" }, "127.0.0.1")).toBe("203.0.113.9");
    // A client-supplied first hop is ignored: nginx appends the real peer last.
    expect(clientIp({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" }, "127.0.0.1")).toBe("198.51.100.4");
    expect(clientIp({}, "::ffff:192.0.2.10")).toBe("192.0.2.10");
    expect(clientIp(new Headers({ "X-Real-IP": "2001:db8::1" }), undefined)).toBe("2001:db8::1");
    expect(clientIp({ "x-real-ip": "not-an-ip" }, "10.0.0.2")).toBe("10.0.0.2");
    expect(clientIp(undefined, undefined)).toBe("");
  });

  it("normalizes addresses", () => {
    expect(normalizeIp("::FFFF:8.8.8.8")).toBe("8.8.8.8");
    expect(normalizeIp("8.8.8.8:5555")).toBe("8.8.8.8");
    expect(normalizeIp("[2001:DB8::2]:443")).toBe("2001:db8::2");
    expect(normalizeIp("999.1.1.1")).toBe("");
    expect(normalizeIp("<script>")).toBe("");
  });

  it("recognizes private and loopback ranges", () => {
    for (const ip of ["127.0.0.1", "10.4.5.6", "172.20.1.1", "192.168.1.20", "169.254.0.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", ""]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "203.0.113.5", "2001:db8::1"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe("player ids", () => {
  it("keeps a well-formed client id and derives a stable one otherwise", () => {
    const conn = { ip: "192.168.1.5", ua: UA.chromeWin };
    expect(sanitizePlayerId("0b6f6c1e-8d1c-4c1a-9a55-6a2a8e5b2f10", conn)).toBe("0b6f6c1e-8d1c-4c1a-9a55-6a2a8e5b2f10");
    const derived = sanitizePlayerId("bad id!", conn);
    expect(derived).toMatch(/^anon-[0-9a-f]{20}$/);
    expect(sanitizePlayerId(undefined, conn)).toBe(derived);
    expect(sanitizePlayerId({ $ne: 1 }, { ...conn, ip: "192.168.1.6" })).not.toBe(derived);
  });
});

describe("time zones", () => {
  it("buckets days and hours in the viewer's zone", () => {
    const t = Date.UTC(2026, 9, 23, 2, 30); // 02:30 UTC Friday
    expect(dayKey(t, "UTC")).toBe("2026-10-23");
    expect(dayKey(t, "America/New_York")).toBe("2026-10-22");
    expect(dayKey(t, "Asia/Dhaka")).toBe("2026-10-23");
    expect(weekHour(t, "UTC")).toEqual([5, 2]);
    expect(weekHour(t, "Asia/Dhaka")).toEqual([5, 8]);
    expect(startOfDay(t, "UTC")).toBe(Date.UTC(2026, 9, 23));
    expect(startOfDay(t, "Asia/Dhaka")).toBe(Date.UTC(2026, 9, 22, 18));
    expect(startOfDay(t, "America/New_York")).toBe(Date.UTC(2026, 9, 22, 4));
    expect(dayKeys(t, 3, "UTC")).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(safeTimeZone("Not/AZone")).toBe("UTC");
    expect(safeTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("draws country flags", () => {
    expect(flagEmoji("BD")).toBe("🇧🇩");
    expect(flagEmoji("LAN")).toBe("");
    expect(flagEmoji("")).toBe("");
  });
});
