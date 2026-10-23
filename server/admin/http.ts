import type { Application, Request, Response } from "express";
import type { AdminStatus, LiveSnapshot, PlayerSort, StorageStatus } from "../../game/shared/adminApi";
import type { AnalyticsStore } from "../analytics/store";
import { clientIp, header, type HeaderSource } from "../analytics/ip";
import { safeTimeZone } from "../analytics/stats";
import {
  LoginLimiter, SESSION_COOKIE, checkCredentials, clearedCookie, parseCookies, sessionCookie, signSession, verifySession, type AdminConfig,
} from "./auth";

export interface AdminRequest {
  method: string;
  /** Path below the API mount, e.g. "/players/abc". */
  path: string;
  query: URLSearchParams;
  headers: HeaderSource;
  body: unknown;
  ip: string;
  /** The browser reached us over HTTPS (directly or through the proxy). */
  secure: boolean;
}

export interface AdminResponse { status: number; body: unknown; headers?: Record<string, string> }

export interface AdminDeps {
  config: AdminConfig;
  store: () => AnalyticsStore | null;
  storage: () => StorageStatus;
  live: () => LiveSnapshot;
  now?: () => number;
  limiter?: LoginLimiter;
}

const json = (status: number, body: unknown, headers?: Record<string, string>): AdminResponse => ({ status, body, headers });

/** Framework-free admin API: every route, auth and validation. `mountAdminApi` adapts it to Express. */
export function createAdminApi(deps: AdminDeps) {
  const { config } = deps;
  const now = deps.now ?? Date.now;
  const limiter = deps.limiter ?? new LoginLimiter();
  /** Logged-out tokens, until they would have expired anyway. */
  const revoked = new Map<string, number>();

  function session(req: AdminRequest) {
    const claims = verifySession(config.secret, parseCookies(header(req.headers, "cookie"))[SESSION_COOKIE], now());
    if (!claims || claims.sub !== config.username || revoked.has(claims.n)) return null;
    return claims;
  }

  async function db<T>(run: (s: AnalyticsStore) => Promise<T>): Promise<AdminResponse> {
    const store = deps.store();
    if (!store || deps.storage() !== "connected") return json(503, { error: "The analytics database is not available right now.", storage: deps.storage() });
    try {
      const out = await run(store);
      return out == null ? json(404, { error: "Not found" }) : json(200, out);
    } catch (e) {
      console.warn("[admin] query failed:", (e as Error).message);
      return json(503, { error: "The analytics database query failed. Try again shortly." });
    }
  }

  async function handle(req: AdminRequest): Promise<AdminResponse> {
    const path = req.path.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();
    if (method === "OPTIONS") return json(204, null);
    if (!config.enabled) {
      return json(503, { enabled: false, authenticated: false, storage: deps.storage(), error: "Admin is disabled: set ADMIN_USERNAME and ADMIN_PASSWORD_HASH on the game server." });
    }

    if (path === "/status" && method === "GET") {
      const s = session(req);
      return json(200, { enabled: true, authenticated: !!s, storage: deps.storage(), user: s?.sub } satisfies AdminStatus);
    }

    if (path === "/login" && method === "POST") {
      const wait = limiter.retryAfter(req.ip, now());
      if (wait > 0) {
        return json(429, { error: `Too many attempts. Try again in ${Math.ceil(wait / 60_000)} min.` }, { "Retry-After": String(Math.ceil(wait / 1000)) });
      }
      const b = (req.body ?? {}) as { username?: unknown; password?: unknown };
      if (typeof b.username !== "string" || typeof b.password !== "string") return json(400, { error: "Enter your email and password." });
      if (!(await checkCredentials(config, b.username, b.password))) {
        limiter.fail(req.ip, now());
        console.warn(`[admin] failed login from ${req.ip || "unknown address"}`);
        return json(401, { error: "Wrong email or password." });
      }
      limiter.succeed(req.ip);
      const { token } = signSession(config.secret, config.username, now());
      console.info(`[admin] login from ${req.ip || "unknown address"}`);
      return json(200, { enabled: true, authenticated: true, storage: deps.storage(), user: config.username } satisfies AdminStatus,
        { "Set-Cookie": sessionCookie(token, req.secure || config.secureCookie) });
    }

    if (path === "/logout" && method === "POST") {
      const s = session(req);
      if (s) {
        revoked.set(s.n, s.exp);
        for (const [n, exp] of revoked) if (exp <= now()) revoked.delete(n);
      }
      return json(200, { ok: true }, { "Set-Cookie": clearedCookie(req.secure || config.secureCookie) });
    }

    if (!session(req)) return json(401, { error: "Sign in to continue." });
    if (method !== "GET") return json(405, { error: "Method not allowed" });

    const q = req.query;
    const tz = safeTimeZone(q.get("tz"));
    if (path === "/live") return json(200, deps.live());
    if (path === "/overview") return db((s) => s.overview(now(), tz));
    if (path === "/analytics") {
      const days = Math.max(1, Math.min(180, Math.floor(Number(q.get("days"))) || 30));
      return db((s) => s.analytics(now(), days, tz));
    }
    if (path === "/players") {
      return db((s) => s.players({
        q: (q.get("q") ?? "").slice(0, 64), sort: (q.get("sort") ?? undefined) as PlayerSort | undefined,
        dir: q.get("dir") === "asc" ? 1 : -1, page: Number(q.get("page")), size: Number(q.get("size")),
      }));
    }
    const player = /^\/players\/([A-Za-z0-9_-]{1,80})$/.exec(path);
    if (player) return db((s) => s.player(player[1]));
    if (path === "/matches") {
      const word = (k: string) => { const v = q.get(k) ?? ""; return /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : undefined; };
      return db((s) => s.matches({ page: Number(q.get("page")), size: Number(q.get("size")), map: word("map"), mode: word("mode"), pid: word("pid") }));
    }
    const match = /^\/matches\/([A-Za-z0-9_-]{1,80})$/.exec(path);
    if (match) return db((s) => s.match(match[1]));
    return json(404, { error: "Not found" });
  }

  return { handle };
}

/** Whether a cross-origin page may call the API with cookies. Production pages are same-origin. */
export function originAllowed(origin: string, host: string, config: AdminConfig): boolean {
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (url.host === host) return true;
  if (config.allowedOrigins.includes(url.origin)) return true;
  // Development: the Next page on :3000 talks to the game server on :2567 of the same host.
  return !config.production && url.hostname === host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
}

function readBody(req: Request, limit = 4096): Promise<unknown> {
  return new Promise((resolve) => {
    if (req.body !== undefined) { resolve(req.body); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) { resolve(undefined); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")); } catch { resolve(undefined); }
    });
    req.on("error", () => resolve(undefined));
  });
}

export const ADMIN_API_PREFIX = "/admin/api";

export function mountAdminApi(app: Application, api: ReturnType<typeof createAdminApi>, config: AdminConfig) {
  app.use(ADMIN_API_PREFIX, async (req: Request, res: Response) => {
    const origin = header(req.headers, "origin");
    const host = header(req.headers, "x-forwarded-host") || header(req.headers, "host");
    // Colyseus adds permissive CORS headers to every response; the admin API decides its own.
    for (const h of ["Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Max-Age"]) res.removeHeader(h);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const allowed = !origin || originAllowed(origin, host, config);
    if (origin && allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Vary", "Origin");
    }
    if (req.method !== "GET" && req.method !== "OPTIONS") {
      // Cookie-carrying writes only from our own pages, and only as JSON (which forces a CORS preflight).
      if (!allowed) { res.status(403).json({ error: "Forbidden origin" }); return; }
      if (!/^application\/json\b/i.test(header(req.headers, "content-type"))) { res.status(415).json({ error: "Send JSON" }); return; }
    }
    const url = new URL(req.originalUrl || req.url, "http://admin.local");
    const out = await api.handle({
      method: req.method,
      path: req.path,
      query: url.searchParams,
      headers: req.headers,
      body: req.method === "POST" ? await readBody(req) : undefined,
      ip: clientIp(req.headers, req.socket.remoteAddress),
      secure: header(req.headers, "x-forwarded-proto").split(",")[0].trim() === "https" || req.secure,
    });
    for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
    if (out.status === 204) { res.status(204).end(); return; }
    res.status(out.status).json(out.body);
  });
}
