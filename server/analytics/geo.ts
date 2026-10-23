import { LOCAL_GEO, UNKNOWN_GEO, type GeoInfo } from "../../game/shared/adminApi";
import { isPrivateIp } from "./ip";

type Lookup = (ip: string) => { country: string; region: string; city: string; ll: [number, number]; timezone: string } | null;

let loader: Promise<Lookup | null> | null = null;
const cache = new Map<string, GeoInfo>();
const CACHE_MAX = 5000;

let regionNames: Intl.DisplayNames | null = null;
function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** geoip-lite reads ~100 MB of data into memory, so it is loaded on the first lookup only. */
function loadLookup(): Promise<Lookup | null> {
  loader ??= import("geoip-lite")
    .then((m) => {
      const mod = m as unknown as { lookup?: Lookup; default?: { lookup: Lookup } };
      return mod.lookup ?? mod.default?.lookup ?? null;
    })
    .catch((e) => {
      console.warn("[analytics] geoip-lite unavailable, locations will be unknown:", (e as Error).message);
      return null;
    });
  return loader;
}

/** Approximate location from the offline GeoLite database; never throws. */
export async function lookupGeo(ip: string): Promise<GeoInfo> {
  if (isPrivateIp(ip)) return LOCAL_GEO;
  const hit = cache.get(ip);
  if (hit) return hit;
  const lookup = await loadLookup();
  let geo: GeoInfo = UNKNOWN_GEO;
  try {
    const r = lookup?.(ip);
    if (r && r.country) {
      geo = {
        country: r.country, countryName: countryName(r.country), region: r.region || "", city: r.city || "",
        lat: Number.isFinite(r.ll?.[0]) ? r.ll[0] : null, lon: Number.isFinite(r.ll?.[1]) ? r.ll[1] : null, timezone: r.timezone || "",
      };
    }
  } catch {
    /* corrupt data file: unknown */
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(ip, geo);
  return geo;
}

/** "City, Region, CC" — the label stored in a player's location list. */
export function geoLabel(g: GeoInfo): string {
  if (g.country === "LAN") return "Local network";
  return [g.city, g.region, g.country].filter(Boolean).join(", ") || "Unknown";
}
