/** Header access that works for Fetch `Headers`, Node's IncomingHttpHeaders and plain records. */
export type HeaderSource = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

export function header(headers: HeaderSource | undefined, name: string): string {
  if (!headers) return "";
  const v = typeof (headers as { get?: unknown }).get === "function"
    ? (headers as { get(n: string): string | null }).get(name)
    : (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Strips IPv4-mapped IPv6 prefixes, ports and brackets. Returns "" for anything that is not an IP. */
export function normalizeIp(raw: string | undefined | null): string {
  let ip = (raw ?? "").trim();
  if (!ip) return "";
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]") > 0 ? ip.indexOf("]") : undefined);
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip)) ip = ip.slice(7);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split(".").every((n) => Number(n) <= 255) ? ip : "";
  if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(":") && ip.length <= 45) return ip.toLowerCase();
  return "";
}

/**
 * The player's address. nginx overwrites X-Real-IP with the peer address and appends it to
 * X-Forwarded-For, so X-Real-IP is trusted first, then the right-most (proxy-added) forwarded
 * hop, then the socket peer. The game server only listens on 127.0.0.1 in production, so these
 * headers can only come from nginx there.
 */
export function clientIp(headers: HeaderSource | undefined, remoteAddress?: string | null): string {
  const real = normalizeIp(header(headers, "x-real-ip").split(",")[0]);
  if (real) return real;
  const hops = header(headers, "x-forwarded-for").split(",").map((h) => normalizeIp(h)).filter(Boolean);
  if (hops.length) return hops[hops.length - 1];
  return normalizeIp(remoteAddress);
}

/** Loopback, RFC 1918, link-local, CGNAT and IPv6 ULA / link-local addresses. */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (ip.includes(":")) {
    return ip === "::1" || ip === "::" || /^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip);
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}
