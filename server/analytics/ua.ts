import type { ClientInfo, DeviceType } from "../../game/shared/adminApi";

const version = (ua: string, re: RegExp) => ua.match(re)?.[1]?.split(/[._]/).slice(0, 2).join(".") ?? "";

/** Small user-agent parser: browser, OS and device class. Good enough for analytics, not for feature detection. */
export function parseUserAgent(raw: unknown): ClientInfo {
  const ua = typeof raw === "string" ? raw.slice(0, 512) : "";
  if (!ua) return { browser: "Unknown", browserVersion: "", os: "Unknown", device: "unknown" };

  let browser = "Other", browserVersion = "";
  const pick = (name: string, re: RegExp) => { browser = name; browserVersion = version(ua, re); };
  if (/bot|crawler|spider|headless/i.test(ua)) pick(/headless/i.test(ua) ? "Headless Chrome" : "Bot", /HeadlessChrome\/([\d.]+)/);
  else if (/EdgA?\/|Edge\//.test(ua)) pick("Edge", /Edg[A-Za-z]*\/([\d.]+)/);
  else if (/OPR\/|Opera/.test(ua)) pick("Opera", /(?:OPR|Opera)\/([\d.]+)/);
  else if (/SamsungBrowser\//.test(ua)) pick("Samsung Internet", /SamsungBrowser\/([\d.]+)/);
  else if (/YaBrowser\//.test(ua)) pick("Yandex", /YaBrowser\/([\d.]+)/);
  else if (/Vivaldi\//.test(ua)) pick("Vivaldi", /Vivaldi\/([\d.]+)/);
  else if (/FxiOS\//.test(ua)) pick("Firefox", /FxiOS\/([\d.]+)/);
  else if (/Firefox\//.test(ua)) pick("Firefox", /Firefox\/([\d.]+)/);
  else if (/CriOS\//.test(ua)) pick("Chrome", /CriOS\/([\d.]+)/);
  else if (/Chrome\/|Chromium\//.test(ua)) pick(/Chromium\//.test(ua) ? "Chromium" : "Chrome", /Chrom(?:e|ium)\/([\d.]+)/);
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) pick("Safari", /Version\/([\d.]+)/);
  else if (/Node\.js|undici|node-fetch/i.test(ua)) pick("Node.js", /Node\.js\/([\d.]+)/);

  let os = "Other";
  if (/Windows NT/.test(ua)) os = "Windows";
  else if (/iPhone|iPod/.test(ua)) os = "iOS";
  else if (/iPad/.test(ua)) os = "iPadOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Linux|X11/.test(ua)) os = "Linux";

  let device: DeviceType = "desktop";
  if (browser === "Bot" || browser === "Headless Chrome" || browser === "Node.js") device = "bot";
  else if (/iPad|Tablet|PlayBook|Silk|Kindle/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) device = "tablet";
  else if (/Mobi|iPhone|iPod|Android|Windows Phone|Opera Mini/.test(ua)) device = "mobile";
  return { browser, browserVersion, os, device };
}
