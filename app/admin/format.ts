import { flagEmoji, type ClientInfo, type GeoInfo } from "@/game/shared/adminApi";
import { WEAPONS, type WeaponId } from "@/game/shared/weapons";

const nf = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const num = (n: number | null | undefined) => (n == null ? "—" : nf.format(n));
export const short = (n: number) => (Math.abs(n) >= 10_000 ? compact.format(n) : nf.format(Math.round(n)));
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
export const ratio = (a: number, b: number) => (b > 0 ? a / b : a);
export const kd = (k: number, d: number) => ratio(k, d).toFixed(2);

/** 1h 05m / 12m / 45s */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}


const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function ago(iso: string | number, now = Date.now()): string {
  const diff = (+new Date(iso) - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return dateOnly(iso);
}

const dt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const d = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
export const dateTime = (iso: string | number) => dt.format(new Date(iso));
export const dateOnly = (iso: string | number) => d.format(new Date(iso));
/** "2026-10-23" → "Oct 23" */
export const dayLabel = (day: string) => {
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
};

export function place(g: GeoInfo): string {
  if (g.country === "LAN") return "Local network";
  if (!g.country) return "Unknown";
  return [g.city, g.city ? g.country : g.countryName].filter(Boolean).join(", ");
}

export const flag = (g: Pick<GeoInfo, "country">) => (g.country === "LAN" ? "🏠" : flagEmoji(g.country) || "🌐");

export function device(c: ClientInfo): string {
  const kind = c.device === "mobile" ? "Phone" : c.device === "tablet" ? "Tablet" : c.device === "bot" ? "Bot" : c.device === "desktop" ? "Desktop" : "Unknown";
  return `${kind} · ${c.os} · ${c.browser}${c.browserVersion ? ` ${c.browserVersion.split(".")[0]}` : ""}`;
}

export const deviceIcon = (c: Pick<ClientInfo, "device">) => (c.device === "mobile" ? "📱" : c.device === "tablet" ? "📲" : c.device === "bot" ? "🤖" : "🖥️");

export function weaponName(id: string): string {
  if (id === "grenade") return "Grenade";
  if (id === "fall") return "Fall";
  return WEAPONS[id as WeaponId]?.name ?? id;
}

// Names only: importing game/shared/map/maps would bundle every map generator into the dashboard.
const MAP_NAMES: Record<string, string> = { village: "Village", downtown: "Downtown", industrial: "Freight Yard", outpost: "Outpost" };
export function mapName(id: string): string {
  return MAP_NAMES[id] ?? (id ? id[0].toUpperCase() + id.slice(1) : "—");
}

export const modeName = (m: string) => (m === "tdm" ? "Team Deathmatch" : m === "ffa" ? "Free for all" : m);
export const modeShort = (m: string) => m.toUpperCase();
export const teamName = (t: number) => (t === 1 ? "Blue" : t === 2 ? "Red" : "—");
