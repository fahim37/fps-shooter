import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "hm_admin";
export const SESSION_TTL_MS = 12 * 3_600_000;

export interface AdminConfig {
  enabled: boolean;
  /** Login name (an email address), compared case-insensitively. */
  username: string;
  /** `scrypt$<saltHex>$<hashHex>`; preferred over the plaintext fallback. */
  passwordHash: string | null;
  password: string | null;
  secret: Buffer;
  /** Extra origins allowed to call the API with cookies (the page is normally same-origin). */
  allowedOrigins: string[];
  production: boolean;
  /** Force the Secure cookie flag even when the proxy does not say the request was HTTPS. */
  secureCookie: boolean;
}

export function adminConfigFromEnv(env: Record<string, string | undefined> = process.env): AdminConfig {
  const username = (env.ADMIN_USERNAME ?? "").trim().toLowerCase();
  const passwordHash = (env.ADMIN_PASSWORD_HASH ?? "").trim() || null;
  const password = passwordHash ? null : env.ADMIN_PASSWORD || null;
  const credential = passwordHash ?? password ?? "";
  // Without ADMIN_SECRET the key derives from the credentials: changing them signs everyone out.
  const secret = createHash("sha256").update(env.ADMIN_SECRET ? `secret|${env.ADMIN_SECRET}` : `derived|${username}|${credential}`).digest();
  return {
    enabled: !!username && !!credential,
    username, passwordHash, password, secret,
    allowedOrigins: (env.ADMIN_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
    production: env.NODE_ENV === "production",
    secureCookie: env.ADMIN_COOKIE_SECURE === "1" || env.ADMIN_COOKIE_SECURE === "true",
  };
}

/** Equal-time string comparison, also for strings of different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize("NFKC"), salt, KEYLEN, SCRYPT, (e, key) => (e ? reject(e) : resolve(key))));
}

/** `scrypt$<saltHex>$<hashHex>` for ADMIN_PASSWORD_HASH. */
export async function hashPassword(password: string, salt: Buffer = randomBytes(16)): Promise<string> {
  return `scrypt$${salt.toString("hex")}$${(await scryptAsync(password, salt)).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = /^scrypt\$([0-9a-f]{16,128})\$([0-9a-f]{32,256})$/i.exec(stored.trim());
  if (!m) return false;
  const expected = Buffer.from(m[2], "hex");
  const actual = await scryptAsync(password, Buffer.from(m[1], "hex"));
  return expected.length === KEYLEN && timingSafeEqual(actual, expected);
}

/** Both halves are always evaluated so a wrong username costs the same as a wrong password. */
export async function checkCredentials(cfg: AdminConfig, username: unknown, password: unknown): Promise<boolean> {
  if (!cfg.enabled || typeof username !== "string" || typeof password !== "string" || username.length > 254 || password.length > 1024) return false;
  const userOk = safeEqual(username.trim().toLowerCase(), cfg.username);
  const passOk = cfg.passwordHash ? await verifyPassword(password, cfg.passwordHash) : safeEqual(password, cfg.password ?? "");
  return userOk && passOk;
}

// ----- signed session tokens -----

export interface SessionClaims { sub: string; iat: number; exp: number; n: string }

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: Buffer, body: string) => createHmac("sha256", secret).update(body).digest();

export function signSession(secret: Buffer, sub: string, now = Date.now(), ttlMs = SESSION_TTL_MS): { token: string; claims: SessionClaims } {
  const claims: SessionClaims = { sub, iat: now, exp: now + ttlMs, n: randomBytes(9).toString("base64url") };
  const body = b64(JSON.stringify(claims));
  return { token: `${body}.${b64(mac(secret, body))}`, claims };
}

export function verifySession(secret: Buffer, token: unknown, now = Date.now()): SessionClaims | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = mac(secret, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionClaims;
    if (typeof c.sub !== "string" || typeof c.exp !== "number" || typeof c.n !== "string" || c.exp <= now) return null;
    return c;
  } catch {
    return null;
  }
}

// ----- login rate limiting -----

/** Per-address failure budget: `max` failures in `windowMs`, then locked out until the window passes. */
export class LoginLimiter {
  private fails = new Map<string, number[]>();
  constructor(private max = 5, private windowMs = 15 * 60_000, private globalMax = 50) {}

  private recent(key: string, now: number) {
    const list = (this.fails.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.fails.set(key, list); else this.fails.delete(key);
    return list;
  }

  /** Milliseconds until `ip` may try again, 0 when allowed. */
  retryAfter(ip: string, now = Date.now()): number {
    const mine = this.recent(ip, now);
    const all = this.recent("*", now);
    const blocked = mine.length >= this.max ? mine : all.length >= this.globalMax ? all : null;
    return blocked ? Math.max(1000, this.windowMs - (now - blocked[0])) : 0;
  }

  fail(ip: string, now = Date.now()) {
    for (const key of [ip, "*"]) this.fails.set(key, [...this.recent(key, now), now]);
    if (this.fails.size > 10_000) this.fails.clear();
  }

  succeed(ip: string) { this.fails.delete(ip); }
}

// ----- cookies -----

export function parseCookies(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed */ }
  }
  return out;
}

/**
 * No Path attribute: the browser scopes the cookie to the directory of the login URL
 * (`/fps/server/admin/api` in production, `/admin/api` in development), so it is never sent
 * to the rest of the site.
 */
export function sessionCookie(token: string, secure: boolean, maxAgeMs = SESSION_TTL_MS): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? "; Secure" : ""}`;
}

export function clearedCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}
